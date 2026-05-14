use std::path::PathBuf;
use std::sync::Mutex;
use rusqlite::Connection;
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
    pub db_path: String,
    pub last_seen_write_time: i64,
    #[serde(default)]
    pub active_user: Option<String>,
}

pub struct AppState {
    pub db: Mutex<Option<Connection>>,
    pub local_cfg: Mutex<LocalConfig>,
    pub local_cfg_path: PathBuf,
}

impl AppState {
    pub fn touch_sync(&self) {
        if let Ok(db_guard) = self.db.lock() {
            if let Some(conn) = db_guard.as_ref() {
                if let Ok(cfg) = self.local_cfg.lock() {
                    let _ = db::touch_sync_metadata(conn, &cfg.device_id, &cfg.device_name);
                    let _ = self.save_local_config_write_time(conn);
                }
            }
        }
    }

    fn save_local_config_write_time(&self, conn: &Connection) -> Result<(), String> {
        let write_time: i64 = conn
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM sync_metadata WHERE key='last_write_time'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        if let Ok(mut cfg) = self.local_cfg.lock() {
            cfg.last_seen_write_time = write_time;
            let json = serde_json::to_string(&*cfg).map_err(|e| e.to_string())?;
            std::fs::write(&self.local_cfg_path, json).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data).ok();

            let cfg_path = app_data.join("local_config.json");
            let local_cfg = load_or_create_local_config(&cfg_path);

            let conn = db::open_and_init(&local_cfg.db_path).ok();

            let state = AppState {
                db: Mutex::new(conn),
                local_cfg: Mutex::new(local_cfg),
                local_cfg_path: cfg_path,
            };
            app.manage(state);
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
            commands::ocr::test_ocr_engines,
            commands::sync::get_sync_status,
            commands::sync::refresh_from_sync,
            commands::sync::force_unlock,
            commands::sync::write_sync_lock,
            commands::diagnostics::run_integrity_check,
            commands::diagnostics::vacuum_db,
            commands::diagnostics::get_error_log,
            commands::diagnostics::log_error,
            commands::diagnostics::export_backup,
            commands::diagnostics::get_app_info,
            commands::settings::get_settings,
            commands::settings::update_setting,
            commands::settings::initialize_db,
            commands::keychain::store_api_key,
            commands::keychain::get_api_key_masked,
            commands::keychain::has_api_key,
            commands::keychain::delete_api_key,
            commands::startup::run_startup_check,
            commands::startup::auto_repair,
            commands::users::get_users,
            commands::users::get_active_user,
            commands::users::set_active_user,
            commands::enrich::enrich_contact,
            commands::enrich::enrich_all_contacts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
        .unwrap_or_else(|_| "My Mac".to_string());

    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    let icloud = home
        .join("Library/Mobile Documents/com~apple~CloudDocs/FreightCRM");
    let db_path = icloud.join("freight_crm.sqlite");

    let cfg = LocalConfig {
        device_id,
        device_name,
        db_path: db_path.to_string_lossy().to_string(),
        last_seen_write_time: 0,
        active_user: None,
    };

    if let Ok(json) = serde_json::to_string_pretty(&cfg) {
        let _ = std::fs::write(path, json);
    }
    cfg
}
