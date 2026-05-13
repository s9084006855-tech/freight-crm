use crate::{AppState, SyncStatus};
use crate::commands::conn_err;
use rusqlite::params;
use std::path::Path;
use tauri::State;

const LOCK_FILE: &str = ".freight_crm.lock";
const BACKUP_DIR: &str = "backups";
const LOCK_STALE_SECS: i64 = 900; // 15 minutes

#[tauri::command]
pub fn get_sync_status(state: State<'_, AppState>) -> Result<SyncStatus, String> {
    let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
    let sync_path = Path::new(&cfg.db_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let icloud_accessible = Path::new(&cfg.db_path).parent().map(|p| p.exists()).unwrap_or(false);

    let lock_path = Path::new(&sync_path).join(LOCK_FILE);
    let (is_locked, lock_device) = read_lock_file(&lock_path, &cfg.device_id);

    let (last_device_id, last_device_name, last_write_time) =
        if let Ok(db_guard) = state.db.lock() {
            if let Some(conn) = db_guard.as_ref() {
                (
                    read_meta(conn, "last_device_id"),
                    read_meta(conn, "last_device_name"),
                    read_meta(conn, "last_write_time").and_then(|v| v.parse::<i64>().ok()),
                )
            } else {
                (None, None, None)
            }
        } else {
            (None, None, None)
        };

    let status = determine_status(
        &last_device_id,
        &cfg.device_id,
        last_write_time,
        cfg.last_seen_write_time,
        icloud_accessible,
        is_locked,
    );

    Ok(SyncStatus {
        status,
        last_device_id,
        last_device_name,
        last_write_time,
        this_device_id: cfg.device_id.clone(),
        this_device_name: cfg.device_name.clone(),
        sync_path,
        is_locked,
        lock_device,
        icloud_accessible,
    })
}

fn determine_status(
    last_device_id: &Option<String>,
    this_device_id: &str,
    last_write_time: Option<i64>,
    last_seen: i64,
    icloud_accessible: bool,
    is_locked: bool,
) -> String {
    if !icloud_accessible {
        return "red".to_string();
    }
    if is_locked {
        return "yellow".to_string();
    }
    if let (Some(ref dev), Some(wt)) = (last_device_id, last_write_time) {
        if dev == this_device_id {
            return "green".to_string();
        }
        if wt > last_seen {
            return "yellow".to_string();
        }
    }
    "green".to_string()
}

#[tauri::command]
pub fn refresh_from_sync(state: State<'_, AppState>) -> Result<(), String> {
    let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?.clone();
    let db_path = cfg.db_path.clone();

    // Backup current DB before refresh
    backup_db(&db_path)?;

    // Reopen the DB connection to get the latest iCloud version
    let new_conn = crate::db::open_and_init(&db_path).map_err(|e| e.to_string())?;

    let new_write_time: i64 = new_conn
        .query_row(
            "SELECT CAST(value AS INTEGER) FROM sync_metadata WHERE key='last_write_time'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let mut db_guard = state.db.lock().map_err(|e| e.to_string())?;
    *db_guard = Some(new_conn);
    drop(db_guard);

    // Update last_seen_write_time in local config
    let mut cfg_guard = state.local_cfg.lock().map_err(|e| e.to_string())?;
    cfg_guard.last_seen_write_time = new_write_time;
    let cfg_json = serde_json::to_string(&*cfg_guard).map_err(|e| e.to_string())?;
    std::fs::write(&state.local_cfg_path, cfg_json).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn write_sync_lock(state: State<'_, AppState>) -> Result<(), String> {
    let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
    let sync_dir = Path::new(&cfg.db_path)
        .parent()
        .ok_or("Invalid DB path")?
        .to_path_buf();

    if !sync_dir.exists() {
        return Ok(()); // iCloud not accessible yet
    }

    let lock_path = sync_dir.join(LOCK_FILE);
    let now = chrono::Utc::now().timestamp();
    let content = serde_json::json!({
        "device_id": cfg.device_id,
        "device_name": cfg.device_name,
        "locked_at": now,
    });
    std::fs::write(&lock_path, content.to_string()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn force_unlock(state: State<'_, AppState>) -> Result<(), String> {
    let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
    let sync_dir = Path::new(&cfg.db_path)
        .parent()
        .ok_or("Invalid DB path")?
        .to_path_buf();
    let lock_path = sync_dir.join(LOCK_FILE);
    if lock_path.exists() {
        std::fs::remove_file(&lock_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn backup_db(db_path: &str) -> Result<(), String> {
    let db_file = Path::new(db_path);
    if !db_file.exists() {
        return Ok(());
    }

    let backup_dir = db_file
        .parent()
        .ok_or("Invalid path")?
        .join(BACKUP_DIR);
    std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    let ts = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let backup_path = backup_dir.join(format!("freight_crm_{}.sqlite", ts));
    std::fs::copy(db_path, &backup_path).map_err(|e| e.to_string())?;

    // Keep only last 10 backups
    if let Ok(mut entries) = std::fs::read_dir(&backup_dir) {
        let mut files: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|x| x == "sqlite").unwrap_or(false))
            .collect();
        files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
        if files.len() > 10 {
            for old in files.iter().take(files.len() - 10) {
                std::fs::remove_file(old.path()).ok();
            }
        }
    }
    Ok(())
}

fn read_lock_file(lock_path: &Path, this_device_id: &str) -> (bool, Option<String>) {
    if !lock_path.exists() {
        return (false, None);
    }
    let content = std::fs::read_to_string(lock_path).unwrap_or_default();
    let json: serde_json::Value = serde_json::from_str(&content).unwrap_or(serde_json::Value::Null);
    let device_id = json.get("device_id").and_then(|v| v.as_str()).unwrap_or("");
    let device_name = json.get("device_name").and_then(|v| v.as_str()).map(|s| s.to_string());
    let locked_at = json.get("locked_at").and_then(|v| v.as_i64()).unwrap_or(0);
    let now = chrono::Utc::now().timestamp();

    // Stale lock (older than 15 min) or our own lock — not blocking
    if now - locked_at > LOCK_STALE_SECS || device_id == this_device_id {
        (false, None)
    } else {
        (true, device_name)
    }
}

fn read_meta(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM sync_metadata WHERE key = ?1",
        params![key],
        |r| r.get(0),
    )
    .ok()
}
