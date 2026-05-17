use std::path::PathBuf;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::Manager;

mod db;
mod models;
pub mod commands;

pub use models::*;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalConfig {
    pub device_id: String,
    pub device_name: String,
    #[serde(default)]
    pub turso_url: String,
    #[serde(default)]
    pub turso_token: String,
    #[serde(default)]
    pub active_user: Option<String>,
    // Kept for one-time migration from local SQLite
    #[serde(default)]
    pub db_path: String,
}

pub struct AppState {
    pub db: Mutex<Option<libsql::Database>>,
    pub local_cfg: Mutex<LocalConfig>,
    pub local_cfg_path: PathBuf,
}

impl AppState {
    pub fn conn(&self) -> Result<libsql::Connection, String> {
        let guard = self.db.lock().map_err(|e| e.to_string())?;
        let db = guard.as_ref()
            .ok_or_else(|| "Not connected to Turso. Enter your database URL and token in Settings.".to_string())?;
        db.connect().map_err(|e| e.to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data).ok();

            let cfg_path = app_data.join("local_config.json");
            let local_cfg = load_or_create_local_config(&cfg_path);

            let saved_url = local_cfg.turso_url.clone();
            let saved_token = local_cfg.turso_token.clone();
            let needs_reconnect = !saved_url.is_empty() && !saved_token.is_empty();

            let state = AppState {
                db: Mutex::new(None),
                local_cfg: Mutex::new(local_cfg),
                local_cfg_path: cfg_path,
            };
            app.manage(state);

            if needs_reconnect {
                let app_handle = app.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    eprintln!("[startup] auto-reconnecting to Turso at {}", saved_url);
                    match libsql::Builder::new_remote(saved_url, saved_token)
                        .build()
                        .await
                    {
                        Ok(db) => match install_db(&app_handle, db) {
                            Ok(_) => eprintln!("[startup] auto-reconnect successful"),
                            Err(e) => eprintln!("[startup] failed to install db: {}", e),
                        },
                        Err(e) => eprintln!("[startup] auto-reconnect failed: {}", e),
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::contacts::get_contacts,
            commands::contacts::get_contact,
            commands::contacts::create_contact,
            commands::contacts::update_contact,
            commands::contacts::delete_contact,
            commands::contacts::search_contacts,
            commands::activities::log_activity,
            commands::activities::get_activities,
            commands::activities::get_follow_ups,
            commands::activities::mark_follow_up_done,
            commands::activities::get_dashboard_stats,
            commands::import::create_import_session,
            commands::import::commit_import,
            commands::import::rollback_import,
            commands::import::get_import_sessions,
            commands::import::get_mapping_templates,
            commands::import::save_mapping_template,
            commands::import::delete_mapping_template,
            commands::import::find_matching_template,
            commands::ocr::ocr_image,
            commands::ocr::ocr_image_claude,
            commands::ocr::ocr_pdf_claude,
            commands::ocr::test_ocr_engines,
            commands::sync::get_sync_status,
            commands::diagnostics::get_error_log,
            commands::diagnostics::log_error,
            commands::diagnostics::export_backup,
            commands::diagnostics::get_app_info,
            commands::settings::get_settings,
            commands::settings::update_setting,
            commands::settings::connect_turso,
            commands::settings::migrate_local_to_turso,
            commands::keychain::store_api_key,
            commands::keychain::get_api_key_masked,
            commands::keychain::has_api_key,
            commands::keychain::delete_api_key,
            commands::startup::run_startup_check,
            commands::users::get_users,
            commands::users::get_active_user,
            commands::users::set_active_user,
            commands::enrich::enrich_contact,
            commands::enrich::enrich_all_contacts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn install_db(handle: &tauri::AppHandle, db: libsql::Database) -> Result<(), String> {
    let state = handle.state::<AppState>();
    let mut guard = state.db.lock().map_err(|e| e.to_string())?;
    *guard = Some(db);
    Ok(())
}

fn load_or_create_local_config(path: &PathBuf) -> LocalConfig {
    if path.exists() {
        if let Ok(json) = std::fs::read_to_string(path) {
            if let Ok(cfg) = serde_json::from_str::<LocalConfig>(&json) {
                return cfg;
            }
        }
    }

    let device_id = uuid::Uuid::new_v4().to_string();
    let device_name = std::process::Command::new("hostname")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "My Device".to_string());

    let cfg = LocalConfig {
        device_id,
        device_name,
        turso_url: String::new(),
        turso_token: String::new(),
        active_user: None,
        db_path: String::new(),
    };

    if let Ok(json) = serde_json::to_string_pretty(&cfg) {
        let _ = std::fs::write(path, json);
    }
    cfg
}
