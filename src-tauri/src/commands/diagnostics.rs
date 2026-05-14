use crate::{AppInfo, AppState, ErrorEntry};
use tauri::{Manager, State};

#[tauri::command]
pub async fn get_error_log(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<ErrorEntry>, String> {
    let conn = state.conn()?;
    let n = limit.unwrap_or(50);
    let mut rows = conn.query(
        "SELECT id, level, context, message, device_id, created_at
         FROM error_log ORDER BY created_at DESC LIMIT ?1",
        libsql::params![n],
    ).await.map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        result.push(ErrorEntry {
            id:         row.get::<i64>(0).map_err(|e| e.to_string())?,
            level:      row.get::<String>(1).map_err(|e| e.to_string())?,
            context:    row.get::<Option<String>>(2).map_err(|e| e.to_string())?,
            message:    row.get::<String>(3).map_err(|e| e.to_string())?,
            device_id:  row.get::<Option<String>>(4).map_err(|e| e.to_string())?,
            created_at: row.get::<i64>(5).map_err(|e| e.to_string())?,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn log_error(
    state: State<'_, AppState>,
    level: String,
    context: Option<String>,
    message: String,
    stack: Option<String>,
) -> Result<(), String> {
    let device_id = state.local_cfg.lock()
        .map(|c| c.device_id.clone())
        .unwrap_or_default();
    let conn = state.conn()?;
    conn.execute(
        "INSERT INTO error_log (level, context, message, stack, device_id) VALUES (?1,?2,?3,?4,?5)",
        libsql::params![level, context, message, stack, device_id],
    ).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn export_backup(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let conn = state.conn()?;
    let export_dir = app.path().desktop_dir()
        .map_err(|e| e.to_string())?
        .join("FreightCRM_Backup");
    std::fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;

    let ts = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let csv_path = export_dir.join(format!("contacts_{}.csv", ts));

    let mut rows = conn.query(
        "SELECT company_name, phone, fax, email, website, city, state, zip,
                roles, commodities, status, notes
         FROM contacts WHERE status != 'deleted' ORDER BY company_name_search",
        (),
    ).await.map_err(|e| e.to_string())?;

    let mut lines = vec![
        "Company,Phone,Fax,Email,Website,City,State,ZIP,Roles,Commodities,Status,Notes\n".to_string(),
    ];
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        let fields: Vec<String> = (0..12).map(|i| {
            let v = row.get::<Option<String>>(i).unwrap_or(None).unwrap_or_default();
            if v.contains(',') || v.contains('"') {
                format!("\"{}\"", v.replace('"', "\"\""))
            } else { v }
        }).collect();
        lines.push(fields.join(",") + "\n");
    }
    std::fs::write(&csv_path, lines.join("")).map_err(|e| e.to_string())?;
    Ok(export_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_app_info(state: State<'_, AppState>) -> Result<AppInfo, String> {
    let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?.clone();

    let schema_version = match state.conn() {
        Ok(conn) => {
            conn.query("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", ())
                .await.ok()
                .and_then(|mut r| {
                    futures::executor::block_on(r.next()).ok().flatten()
                        .and_then(|row| row.get::<i64>(0).ok())
                })
                .unwrap_or(0)
        }
        Err(_) => 0,
    };

    Ok(AppInfo {
        app_version:    env!("CARGO_PKG_VERSION").to_string(),
        schema_version,
        device_id:      cfg.device_id,
        device_name:    cfg.device_name,
        turso_url:      cfg.turso_url,
    })
}
