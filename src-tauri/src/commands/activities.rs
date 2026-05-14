use crate::{Activity, AppState, CreateActivityData, DashboardStats, FollowUpItem, StateCount};
use crate::db::last_insert_rowid;
use tauri::State;

#[tauri::command]
pub async fn log_activity(
    state: State<'_, AppState>,
    data: CreateActivityData,
) -> Result<Activity, String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();
    let is_call = data.activity_type == "call";
    let contact_id = data.contact_id;

    conn.execute(
        "INSERT INTO activities (contact_id, type, outcome, notes, duration_sec, follow_up_at, created_at, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        libsql::params![
            data.contact_id, data.activity_type, data.outcome, data.notes,
            data.duration_sec, data.follow_up_at, now, data.user_id,
        ],
    ).await.map_err(|e| e.to_string())?;

    let id = last_insert_rowid(&conn).await?;

    if is_call {
        conn.execute(
            "UPDATE contacts SET last_contacted_at = ?1, updated_at = ?1 WHERE id = ?2",
            libsql::params![now, contact_id],
        ).await.map_err(|e| e.to_string())?;
    }

    let mut rows = conn.query(
        "SELECT id, contact_id, type, outcome, notes, duration_sec, follow_up_at,
                follow_up_done, created_at, user_id
         FROM activities WHERE id = ?1",
        libsql::params![id],
    ).await.map_err(|e| e.to_string())?;

    let row = rows.next().await.map_err(|e| e.to_string())?.ok_or("not found")?;
    Ok(row_to_activity(&row)?)
}

#[tauri::command]
pub async fn get_activities(
    state: State<'_, AppState>,
    contact_id: i64,
) -> Result<Vec<Activity>, String> {
    let conn = state.conn()?;
    let mut rows = conn.query(
        "SELECT id, contact_id, type, outcome, notes, duration_sec,
                follow_up_at, follow_up_done, created_at, user_id
         FROM activities WHERE contact_id = ?1
         ORDER BY created_at DESC LIMIT 200",
        libsql::params![contact_id],
    ).await.map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        result.push(row_to_activity(&row)?);
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_follow_ups(state: State<'_, AppState>) -> Result<Vec<FollowUpItem>, String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();

    let mut rows = conn.query(
        "SELECT a.id, a.contact_id, c.company_name, c.phone, c.state,
                a.follow_up_at, a.notes
         FROM activities a
         JOIN contacts c ON c.id = a.contact_id
         WHERE a.follow_up_done = 0 AND a.follow_up_at IS NOT NULL
           AND c.status != 'deleted'
         ORDER BY a.follow_up_at ASC LIMIT 100",
        (),
    ).await.map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        let follow_up_at: i64 = row.get::<i64>(5).map_err(|e| e.to_string())?;
        result.push(FollowUpItem {
            activity_id:  row.get::<i64>(0).map_err(|e| e.to_string())?,
            contact_id:   row.get::<i64>(1).map_err(|e| e.to_string())?,
            company_name: row.get::<String>(2).map_err(|e| e.to_string())?,
            phone:        row.get::<Option<String>>(3).map_err(|e| e.to_string())?,
            state:        row.get::<Option<String>>(4).map_err(|e| e.to_string())?,
            follow_up_at,
            notes:        row.get::<Option<String>>(6).map_err(|e| e.to_string())?,
            overdue:      follow_up_at < now,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn mark_follow_up_done(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute("UPDATE activities SET follow_up_done = 1 WHERE id = ?1", libsql::params![id])
        .await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_dashboard_stats(state: State<'_, AppState>) -> Result<DashboardStats, String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();
    let today_start = now - (now % 86400);
    let week_start  = now - 7 * 86400;

    let total_contacts = scalar_i64(&conn, "SELECT COUNT(*) FROM contacts WHERE status != 'deleted'", ()).await?;
    let calls_today    = scalar_i64(&conn, "SELECT COUNT(*) FROM activities WHERE type='call' AND created_at >= ?1", libsql::params![today_start]).await?;
    let calls_week     = scalar_i64(&conn, "SELECT COUNT(*) FROM activities WHERE type='call' AND created_at >= ?1", libsql::params![week_start]).await?;
    let fu_due         = scalar_i64(&conn,
        "SELECT COUNT(*) FROM activities WHERE follow_up_done=0 AND follow_up_at IS NOT NULL AND follow_up_at BETWEEN ?1 AND ?2",
        libsql::params![today_start, today_start + 86400]).await?;
    let fu_overdue     = scalar_i64(&conn,
        "SELECT COUNT(*) FROM activities WHERE follow_up_done=0 AND follow_up_at IS NOT NULL AND follow_up_at < ?1",
        libsql::params![today_start]).await?;

    let mut sc_rows = conn.query(
        "SELECT state, COUNT(*) as cnt FROM contacts
         WHERE status != 'deleted' AND state IS NOT NULL AND state != ''
         GROUP BY state ORDER BY cnt DESC LIMIT 20",
        (),
    ).await.map_err(|e| e.to_string())?;

    let mut contacts_by_state = Vec::new();
    while let Some(row) = sc_rows.next().await.map_err(|e| e.to_string())? {
        contacts_by_state.push(StateCount {
            state: row.get::<String>(0).map_err(|e| e.to_string())?,
            count: row.get::<i64>(1).map_err(|e| e.to_string())?,
        });
    }

    let mut act_rows = conn.query(
        "SELECT id, contact_id, type, outcome, notes, duration_sec,
                follow_up_at, follow_up_done, created_at, user_id
         FROM activities ORDER BY created_at DESC LIMIT 10",
        (),
    ).await.map_err(|e| e.to_string())?;

    let mut recent_activities = Vec::new();
    while let Some(row) = act_rows.next().await.map_err(|e| e.to_string())? {
        recent_activities.push(row_to_activity(&row)?);
    }

    Ok(DashboardStats {
        total_contacts,
        calls_today,
        calls_this_week: calls_week,
        follow_ups_due_today: fu_due,
        follow_ups_overdue: fu_overdue,
        contacts_by_state,
        recent_activities,
    })
}

fn row_to_activity(row: &libsql::Row) -> Result<Activity, String> {
    Ok(Activity {
        id:            row.get::<i64>(0).map_err(|e| e.to_string())?,
        contact_id:    row.get::<i64>(1).map_err(|e| e.to_string())?,
        activity_type: row.get::<String>(2).map_err(|e| e.to_string())?,
        outcome:       row.get::<Option<String>>(3).map_err(|e| e.to_string())?,
        notes:         row.get::<Option<String>>(4).map_err(|e| e.to_string())?,
        duration_sec:  row.get::<Option<i64>>(5).map_err(|e| e.to_string())?,
        follow_up_at:  row.get::<Option<i64>>(6).map_err(|e| e.to_string())?,
        follow_up_done: row.get::<i64>(7).map_err(|e| e.to_string())? != 0,
        created_at:    row.get::<i64>(8).map_err(|e| e.to_string())?,
        user_id:       row.get::<Option<String>>(9).ok().flatten(),
    })
}

async fn scalar_i64(conn: &libsql::Connection, sql: &str, params: impl libsql::params::IntoParams) -> Result<i64, String> {
    let mut rows = conn.query(sql, params).await.map_err(|e| e.to_string())?;
    let row = rows.next().await.map_err(|e| e.to_string())?;
    Ok(row.and_then(|r| r.get::<i64>(0).ok()).unwrap_or(0))
}
