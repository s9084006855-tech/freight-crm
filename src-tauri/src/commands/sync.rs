use crate::{AppState, SyncStatus};
use tauri::State;

#[tauri::command]
pub async fn get_sync_status(state: State<'_, AppState>) -> Result<SyncStatus, String> {
    let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
    let connected = state.db.lock().map_err(|e| e.to_string())?.is_some();

    let status = if cfg.turso_url.is_empty() {
        "setup_required".to_string()
    } else if connected {
        "green".to_string()
    } else {
        "red".to_string()
    };

    Ok(SyncStatus {
        status,
        last_device_name: None,
        this_device_id: cfg.device_id.clone(),
        this_device_name: cfg.device_name.clone(),
        sync_path: cfg.turso_url.clone(),
    })
}
