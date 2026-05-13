use crate::{Activity, AppState, CreateActivityData, DashboardStats, FollowUpItem, StateCount};
use crate::commands::conn_err;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn log_activity(
    state: State<'_, AppState>,
    data: CreateActivityData,
) -> Result<Activity, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO activities (contact_id, type, outcome, notes, duration_sec, follow_up_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            data.contact_id,
            data.activity_type,
            data.outcome,
            data.notes,
            data.duration_sec,
            data.follow_up_at,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    // Update last_contacted_at on the contact
    if data.activity_type == "call" {
        conn.execute(
            "UPDATE contacts SET last_contacted_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now, data.contact_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let activity = conn
        .query_row(
            "SELECT id, contact_id, type, outcome, notes, duration_sec, follow_up_at,
                    follow_up_done, created_at
             FROM activities WHERE id = ?1",
            params![id],
            |row| {
                Ok(Activity {
                    id: row.get(0)?,
                    contact_id: row.get(1)?,
                    activity_type: row.get(2)?,
                    outcome: row.get(3)?,
                    notes: row.get(4)?,
                    duration_sec: row.get(5)?,
                    follow_up_at: row.get(6)?,
                    follow_up_done: row.get::<_, i32>(7)? != 0,
                    created_at: row.get(8)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    drop(db);
    state.touch_sync();
    Ok(activity)
}

#[tauri::command]
pub fn get_activities(
    state: State<'_, AppState>,
    contact_id: i64,
) -> Result<Vec<Activity>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, contact_id, type, outcome, notes, duration_sec,
                    follow_up_at, follow_up_done, created_at
             FROM activities WHERE contact_id = ?1
             ORDER BY created_at DESC LIMIT 200",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_map(params![contact_id], |row| {
        Ok(Activity {
            id: row.get(0)?,
            contact_id: row.get(1)?,
            activity_type: row.get(2)?,
            outcome: row.get(3)?,
            notes: row.get(4)?,
            duration_sec: row.get(5)?,
            follow_up_at: row.get(6)?,
            follow_up_done: row.get::<_, i32>(7)? != 0,
            created_at: row.get(8)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_follow_ups(state: State<'_, AppState>) -> Result<Vec<FollowUpItem>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    let now = chrono::Utc::now().timestamp();

    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.contact_id, c.company_name, c.phone, c.state,
                    a.follow_up_at, a.notes
             FROM activities a
             JOIN contacts c ON c.id = a.contact_id
             WHERE a.follow_up_done = 0 AND a.follow_up_at IS NOT NULL
               AND c.status != 'deleted'
             ORDER BY a.follow_up_at ASC
             LIMIT 100",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_map([], |row| {
        let follow_up_at: i64 = row.get(5)?;
        Ok(FollowUpItem {
            activity_id: row.get(0)?,
            contact_id: row.get(1)?,
            company_name: row.get(2)?,
            phone: row.get(3)?,
            state: row.get(4)?,
            follow_up_at,
            notes: row.get(6)?,
            overdue: follow_up_at < now,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_follow_up_done(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    conn.execute(
        "UPDATE activities SET follow_up_done = 1 WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    drop(db);
    state.touch_sync();
    Ok(())
}

#[tauri::command]
pub fn get_dashboard_stats(state: State<'_, AppState>) -> Result<DashboardStats, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    let now = chrono::Utc::now().timestamp();
    let today_start = now - (now % 86400);
    let week_start = now - 7 * 86400;

    let total_contacts: i64 = conn
        .query_row("SELECT COUNT(*) FROM contacts WHERE status != 'deleted'", [], |r| r.get(0))
        .unwrap_or(0);

    let calls_today: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM activities WHERE type='call' AND created_at >= ?1",
            params![today_start],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let calls_this_week: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM activities WHERE type='call' AND created_at >= ?1",
            params![week_start],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let follow_ups_due_today: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM activities WHERE follow_up_done=0 AND follow_up_at IS NOT NULL
             AND follow_up_at BETWEEN ?1 AND ?2",
            params![today_start, today_start + 86400],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let follow_ups_overdue: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM activities WHERE follow_up_done=0 AND follow_up_at IS NOT NULL
             AND follow_up_at < ?1",
            params![today_start],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let mut state_stmt = conn
        .prepare(
            "SELECT state, COUNT(*) as cnt FROM contacts
             WHERE status != 'deleted' AND state IS NOT NULL AND state != ''
             GROUP BY state ORDER BY cnt DESC LIMIT 20",
        )
        .map_err(|e| e.to_string())?;

    let contacts_by_state: Vec<StateCount> = state_stmt
        .query_map([], |row| {
            Ok(StateCount {
                state: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut act_stmt = conn
        .prepare(
            "SELECT id, contact_id, type, outcome, notes, duration_sec,
                    follow_up_at, follow_up_done, created_at
             FROM activities ORDER BY created_at DESC LIMIT 10",
        )
        .map_err(|e| e.to_string())?;

    let recent_activities: Vec<Activity> = act_stmt
        .query_map([], |row| {
            Ok(Activity {
                id: row.get(0)?,
                contact_id: row.get(1)?,
                activity_type: row.get(2)?,
                outcome: row.get(3)?,
                notes: row.get(4)?,
                duration_sec: row.get(5)?,
                follow_up_at: row.get(6)?,
                follow_up_done: row.get::<_, i32>(7)? != 0,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(DashboardStats {
        total_contacts,
        calls_today,
        calls_this_week,
        follow_ups_due_today,
        follow_ups_overdue,
        contacts_by_state,
        recent_activities,
    })
}
