use crate::AppState;
use crate::commands::conn_err;
use rusqlite::params;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT key, value FROM app_settings")
        .map_err(|e| e.to_string())?;

    let mut map: HashMap<String, String> = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Inject machine-specific values
    map.insert("device_id".to_string(), cfg.device_id.clone());
    map.insert("device_name".to_string(), cfg.device_name.clone());
    map.insert("db_path".to_string(), cfg.db_path.clone());
    map.insert("app_version".to_string(), env!("CARGO_PKG_VERSION").to_string());

    Ok(map)
}

#[tauri::command]
pub fn update_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    // Device name is machine-local — update local config, not DB
    if key == "device_name" {
        let mut cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
        cfg.device_name = value;
        let json = serde_json::to_string(&*cfg).map_err(|e| e.to_string())?;
        return std::fs::write(&state.local_cfg_path, json).map_err(|e| e.to_string());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    drop(db);
    state.touch_sync();
    Ok(())
}

#[tauri::command]
pub fn initialize_db(
    state: State<'_, AppState>,
    sync_path: Option<String>,
) -> Result<(), String> {
    // Expand leading ~ in sync_path to the home directory
    let sync_path_expanded = sync_path.map(|p| {
        if p.starts_with("~/") {
            dirs::home_dir()
                .map(|h| h.join(&p[2..]).to_string_lossy().to_string())
                .unwrap_or(p)
        } else {
            p
        }
    });

    // Determine the DB path: use provided sync_path or existing config
    let new_db_path = if let Some(ref path) = sync_path_expanded {
        let dir = std::path::Path::new(path);
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        dir.join("freight_crm.sqlite")
            .to_string_lossy()
            .to_string()
    } else {
        state
            .local_cfg
            .lock()
            .map_err(|e| e.to_string())?
            .db_path
            .clone()
    };

    let conn = crate::db::open_and_init(&new_db_path).map_err(|e| e.to_string())?;

    let mut db_guard = state.db.lock().map_err(|e| e.to_string())?;
    *db_guard = Some(conn);
    drop(db_guard);

    // Update local config with new path
    {
        let mut cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
        cfg.db_path = new_db_path.clone();
        let json = serde_json::to_string(&*cfg).map_err(|e| e.to_string())?;
        std::fs::write(&state.local_cfg_path, json).map_err(|e| e.to_string())?;
    }

    // Persist expanded sync_path to app_settings in DB if provided
    if let Some(path) = sync_path_expanded {
        let db2 = state.db.lock().map_err(|e| e.to_string())?;
        if let Some(conn2) = db2.as_ref() {
            conn2.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('sync_path', ?1)",
                params![path],
            ).ok();
        }
    }

    Ok(())
}
