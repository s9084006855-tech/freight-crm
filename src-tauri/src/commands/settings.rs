use crate::AppState;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    let conn = state.conn()?;

    let mut stmt_rows = conn.query("SELECT key, value FROM app_settings", ())
        .await.map_err(|e| e.to_string())?;

    let mut map: HashMap<String, String> = HashMap::new();
    while let Some(row) = stmt_rows.next().await.map_err(|e| e.to_string())? {
        let k: String = row.get::<String>(0).map_err(|e| e.to_string())?;
        let v: String = row.get::<String>(1).map_err(|e| e.to_string())?;
        map.insert(k, v);
    }

    let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
    map.insert("device_id".into(),   cfg.device_id.clone());
    map.insert("device_name".into(), cfg.device_name.clone());
    map.insert("turso_url".into(),   cfg.turso_url.clone());
    map.insert("app_version".into(), env!("CARGO_PKG_VERSION").to_string());
    Ok(map)
}

#[tauri::command]
pub async fn update_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    if key == "device_name" {
        let mut cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
        cfg.device_name = value;
        let json = serde_json::to_string(&*cfg).map_err(|e| e.to_string())?;
        return std::fs::write(&state.local_cfg_path, json).map_err(|e| e.to_string());
    }

    let conn = state.conn()?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        libsql::params![key, value],
    ).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Connect to Turso — called from Settings when user enters URL + token
#[tauri::command]
pub async fn connect_turso(
    state: State<'_, AppState>,
    url: String,
    token: String,
) -> Result<(), String> {
    let url = url.trim().to_string();
    let token = token.trim().to_string();

    eprintln!("[connect_turso] step 1: validating inputs (url len={}, token len={})", url.len(), token.len());

    if url.is_empty() || token.is_empty() {
        return Err("URL and token are required".into());
    }

    eprintln!("[connect_turso] step 2: building remote DB connection to {}", url);

    let db = libsql::Builder::new_remote(url.clone(), token.clone())
        .build()
        .await
        .map_err(|e| {
            eprintln!("[connect_turso] step 2 FAILED: {}", e);
            format!("Failed to connect: {}", e)
        })?;

    eprintln!("[connect_turso] step 3: opening connection");
    let conn = db.connect().map_err(|e| {
        eprintln!("[connect_turso] step 3 FAILED: {}", e);
        e.to_string()
    })?;

    eprintln!("[connect_turso] step 4: initializing schema");
    crate::db::init_schema_async(&conn).await.map_err(|e| {
        eprintln!("[connect_turso] step 4 FAILED: {}", e);
        e.to_string()
    })?;

    eprintln!("[connect_turso] step 5: saving credentials to local config");
    // Save credentials to local config
    {
        let mut cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
        cfg.turso_url   = url;
        cfg.turso_token = token;
        let json = serde_json::to_string(&*cfg).map_err(|e| e.to_string())?;
        std::fs::write(&state.local_cfg_path, json).map_err(|e| e.to_string())?;
    }

    eprintln!("[connect_turso] step 6: swapping in new database");
    // Swap in the new database
    let mut guard = state.db.lock().map_err(|e| e.to_string())?;
    *guard = Some(db);
    eprintln!("[connect_turso] DONE");
    Ok(())
}

/// One-time migration: reads from local SQLite file → pushes to Turso
#[tauri::command]
pub async fn migrate_local_to_turso(
    state: State<'_, AppState>,
    sqlite_path: String,
) -> Result<String, String> {
    let local = rusqlite::Connection::open(&sqlite_path)
        .map_err(|e| format!("Cannot open local SQLite: {}", e))?;

    // Collect all rows synchronously before any .await (rusqlite types are not Send)
    type ContactRow = (
        Option<String>, String, String, Option<String>, Option<String>,
        Option<String>, Option<String>, Option<String>, Option<String>, Option<String>,
        Option<String>, Option<String>, Option<String>, Option<String>, Option<String>,
        String, i32, String, Option<String>, i64, i64, Option<i64>,
        Option<String>, Option<String>, Option<i64>,
    );
    type ActivityRow = (
        i64, String, Option<String>, Option<String>, Option<i64>,
        Option<i64>, i32, i64, Option<String>,
    );

    let contact_rows: Vec<ContactRow> = {
        let mut stmt = local.prepare(
            "SELECT bbid, company_name, company_name_search, phone, phone_normalized,
                    fax, email, website, street, city, state, zip, country, roles, commodities,
                    status, priority, source, notes, created_at, updated_at, last_contacted_at,
                    enrichment_status, enrichment_data, enriched_at
             FROM contacts WHERE status != 'deleted'"
        ).map_err(|e| e.to_string())?;
        stmt.query_map([], |r| Ok((
            r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
            r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?,
            r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?, r.get(14)?,
            r.get(15)?, r.get(16)?, r.get(17)?, r.get(18)?, r.get(19)?,
            r.get(20)?, r.get(21)?, r.get(22)?, r.get(23)?, r.get(24)?,
        )))
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        .map_err(|e| e.to_string())?
    };

    let activity_rows: Vec<ActivityRow> = {
        let mut stmt = local.prepare(
            "SELECT contact_id, type, outcome, notes, duration_sec,
                    follow_up_at, follow_up_done, created_at, user_id
             FROM activities"
        ).map_err(|e| e.to_string())?;
        stmt.query_map([], |r| Ok((
            r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
            r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?,
        )))
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        .map_err(|e| e.to_string())?
    };

    // All rusqlite work done — now do async Turso inserts
    let conn = state.conn()?;
    let mut contacts_migrated = 0i64;
    let mut activities_migrated = 0i64;

    for r in contact_rows {
        conn.execute(
            "INSERT OR IGNORE INTO contacts
             (bbid, company_name, company_name_search, phone, phone_normalized,
              fax, email, website, street, city, state, zip, country, roles, commodities,
              status, priority, source, notes, created_at, updated_at, last_contacted_at,
              enrichment_status, enrichment_data, enriched_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)",
            libsql::params![
                r.0, r.1, r.2, r.3, r.4, r.5, r.6, r.7, r.8, r.9,
                r.10, r.11, r.12, r.13, r.14, r.15, r.16 as i64, r.17, r.18,
                r.19, r.20, r.21, r.22, r.23, r.24,
            ],
        ).await.map_err(|e| e.to_string())?;
        contacts_migrated += 1;
    }

    for r in activity_rows {
        conn.execute(
            "INSERT OR IGNORE INTO activities
             (contact_id, type, outcome, notes, duration_sec, follow_up_at, follow_up_done, created_at, user_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            libsql::params![r.0, r.1, r.2, r.3, r.4, r.5, r.6 as i64, r.7, r.8],
        ).await.map_err(|e| e.to_string())?;
        activities_migrated += 1;
    }

    Ok(format!(
        "Migration complete: {} contacts, {} activities",
        contacts_migrated, activities_migrated
    ))
}
