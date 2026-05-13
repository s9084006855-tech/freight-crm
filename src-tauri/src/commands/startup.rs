use crate::{AppState, StartupCheck, StartupCheckResult};
use std::path::Path;
use tauri::State;

#[tauri::command]
pub fn run_startup_check(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<StartupCheckResult, String> {
    let mut checks: Vec<StartupCheck> = vec![];

    // 1. DB file exists and is accessible
    let db_path = state
        .local_cfg
        .lock()
        .map(|c| c.db_path.clone())
        .unwrap_or_default();

    let db_exists = !db_path.is_empty() && Path::new(&db_path).exists();
    checks.push(StartupCheck {
        name: "Database file".to_string(),
        passed: db_exists,
        message: if db_exists {
            format!("Found at {}", db_path)
        } else {
            format!("Not found at {}", db_path)
        },
        can_auto_repair: true,
        repair_key: Some("init_db".to_string()),
    });

    // 2. DB connection initialized
    let db_connected = state.db.lock().map(|g| g.is_some()).unwrap_or(false);
    checks.push(StartupCheck {
        name: "Database connection".to_string(),
        passed: db_connected,
        message: if db_connected {
            "Connected".to_string()
        } else {
            "Not connected — will attempt to reconnect".to_string()
        },
        can_auto_repair: true,
        repair_key: Some("init_db".to_string()),
    });

    // 3. Schema version
    let schema_ok = if db_connected {
        let db = state.db.lock().unwrap();
        if let Some(conn) = db.as_ref() {
            conn.query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version >= 1",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .unwrap_or(false)
        } else {
            false
        }
    } else {
        false
    };
    checks.push(StartupCheck {
        name: "Database schema".to_string(),
        passed: schema_ok,
        message: if schema_ok {
            "Schema up to date".to_string()
        } else {
            "Schema missing or outdated".to_string()
        },
        can_auto_repair: true,
        repair_key: Some("init_db".to_string()),
    });

    // 4. Sync folder accessible
    let sync_dir = Path::new(&db_path).parent().map(|p| p.exists()).unwrap_or(false);
    checks.push(StartupCheck {
        name: "Sync folder".to_string(),
        passed: sync_dir,
        message: if sync_dir {
            "Accessible".to_string()
        } else {
            "Sync folder not found. iCloud Drive may not be set up, or sync path has changed.".to_string()
        },
        can_auto_repair: false,
        repair_key: None,
    });

    // 5. Tesseract self-test
    let tess_check = crate::commands::ocr::test_ocr_engines(app);
    let (tess_ok, tess_msg) = match tess_check {
        Ok(ref s) => (
            s.tesseract_available || s.apple_vision_available,
            if s.apple_vision_available {
                "Apple Vision OCR: available".to_string()
            } else if s.tesseract_available {
                "Bundled Tesseract: available".to_string()
            } else {
                "No OCR engine available. Run scripts/bundle_tesseract.sh to enable image import.".to_string()
            },
        ),
        Err(ref e) => (false, format!("OCR check failed: {}", e)),
    };
    checks.push(StartupCheck {
        name: "OCR engine".to_string(),
        passed: tess_ok,
        message: tess_msg,
        can_auto_repair: false,
        repair_key: None,
    });

    let all_passed = checks.iter().all(|c| c.passed);
    Ok(StartupCheckResult { all_passed, checks })
}

#[tauri::command]
pub fn auto_repair(
    state: State<'_, AppState>,
    repair_key: String,
) -> Result<String, String> {
    match repair_key.as_str() {
        "init_db" => {
            crate::commands::settings::initialize_db(state, None)
                .map(|_| "Database initialized successfully.".to_string())
        }
        _ => Err(format!("Unknown repair key: {}", repair_key)),
    }
}
