use crate::{AppInfo, AppState, ErrorEntry};
use crate::commands::conn_err;
use rusqlite::params;
use std::collections::HashMap;
use tauri::{Manager, State};

#[tauri::command]
pub fn run_integrity_check(state: State<'_, AppState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;

    let mut stmt = conn
        .prepare("PRAGMA integrity_check")
        .map_err(|e| e.to_string())?;
    let results: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        .map_err(|e| e.to_string())?;

    Ok(results.join("\n"))
}

#[tauri::command]
pub fn vacuum_db(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    conn.execute_batch("PRAGMA wal_checkpoint(FULL); VACUUM;")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_error_log(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<ErrorEntry>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    let n = limit.unwrap_or(50);

    let mut stmt = conn
        .prepare(
            "SELECT id, level, context, message, device_id, created_at
             FROM error_log ORDER BY created_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_map(params![n], |row| {
        Ok(ErrorEntry {
            id: row.get(0)?,
            level: row.get(1)?,
            context: row.get(2)?,
            message: row.get(3)?,
            device_id: row.get(4)?,
            created_at: row.get(5)?,
        })
    })
    .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn log_error(
    state: State<'_, AppState>,
    level: String,
    context: Option<String>,
    message: String,
    stack: Option<String>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    let device_id = state
        .local_cfg
        .lock()
        .map(|c| c.device_id.clone())
        .unwrap_or_default();
    conn.execute(
        "INSERT INTO error_log (level, context, message, stack, device_id) VALUES (?1,?2,?3,?4,?5)",
        params![level, context, message, stack, device_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn export_backup(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?.clone();
    let db_path = &cfg.db_path;

    let export_dir = app
        .path()
        .desktop_dir()
        .map_err(|e| e.to_string())?
        .join("FreightCRM_Backup");
    std::fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;

    let ts = chrono::Utc::now().format("%Y%m%d_%H%M%S");

    // Copy SQLite file
    let sqlite_dest = export_dir.join(format!("freight_crm_{}.sqlite", ts));
    std::fs::copy(db_path, &sqlite_dest).map_err(|e| e.to_string())?;

    // Export contacts as CSV
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        if let Some(conn) = db.as_ref() {
            let csv_path = export_dir.join(format!("contacts_{}.csv", ts));
            export_contacts_csv(conn, &csv_path.to_string_lossy())?;
        }
    }

    Ok(export_dir.to_string_lossy().to_string())
}

fn export_contacts_csv(conn: &rusqlite::Connection, path: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT company_name, phone, fax, email, website, city, state, zip,
                    roles, commodities, status, notes
             FROM contacts WHERE status != 'deleted' ORDER BY company_name_search",
        )
        .map_err(|e| e.to_string())?;

    let mut output = vec![
        "Company,Phone,Fax,Email,Website,City,State,ZIP,Roles,Commodities,Status,Notes\n"
            .to_string(),
    ];

    let rows = stmt
        .query_map([], |row| {
            let fields: Vec<String> = (0..12)
                .map(|i| {
                    row.get::<_, Option<String>>(i)
                        .unwrap_or(None)
                        .unwrap_or_default()
                })
                .map(|v| {
                    if v.contains(',') || v.contains('"') {
                        format!("\"{}\"", v.replace('"', "\"\""))
                    } else {
                        v
                    }
                })
                .collect();
            Ok(fields.join(",") + "\n")
        })
        .map_err(|e| e.to_string())?;

    for row in rows.filter_map(|r| r.ok()) {
        output.push(row);
    }

    std::fs::write(path, output.join("")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_app_info(state: State<'_, AppState>) -> Result<AppInfo, String> {
    let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?.clone();

    let schema_version = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        if let Some(conn) = db.as_ref() {
            conn.query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
        } else {
            0
        }
    };

    let sync_provider = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        if let Some(conn) = db.as_ref() {
            conn.query_row(
                "SELECT value FROM app_settings WHERE key='sync_provider'",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap_or_else(|_| "icloud".to_string())
        } else {
            "icloud".to_string()
        }
    };

    Ok(AppInfo {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        schema_version,
        device_id: cfg.device_id,
        device_name: cfg.device_name,
        db_path: cfg.db_path,
        sync_provider,
    })
}
