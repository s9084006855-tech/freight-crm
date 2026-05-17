use crate::{AppState, StartupCheck, StartupCheckResult};
use tauri::State;

#[tauri::command]
pub async fn run_startup_check(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<StartupCheckResult, String> {
    let mut checks: Vec<StartupCheck> = vec![];

    // 1. Turso configured
    let has_creds = {
        let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
        !cfg.turso_url.is_empty() && !cfg.turso_token.is_empty()
    };
    checks.push(StartupCheck {
        name: "Turso credentials".to_string(),
        passed: has_creds,
        message: if has_creds { "Configured".into() } else { "Not configured — enter URL and token in Settings".into() },
        can_auto_repair: false,
        repair_key: None,
    });

    // 2. DB connected
    let connected = state.db.lock().map_err(|e| e.to_string())?.is_some();
    checks.push(StartupCheck {
        name: "Database connection".to_string(),
        passed: connected,
        message: if connected { "Connected to Turso".into() } else { "Not connected".into() },
        can_auto_repair: false,
        repair_key: None,
    });

    // 3. Schema
    let schema_ok = if connected {
        match state.conn() {
            Ok(conn) => match conn
                .query("SELECT COUNT(*) FROM schema_migrations WHERE version >= 1", ())
                .await
            {
                Ok(mut rows) => match rows.next().await {
                    Ok(Some(row)) => row.get::<i64>(0).map(|n| n > 0).unwrap_or(false),
                    _ => false,
                },
                Err(_) => false,
            },
            Err(_) => false,
        }
    } else { false };
    checks.push(StartupCheck {
        name: "Database schema".to_string(),
        passed: schema_ok,
        message: if schema_ok { "Up to date".into() } else { "Schema missing".into() },
        can_auto_repair: false,
        repair_key: None,
    });

    // 4. OCR
    let (tess_ok, tess_msg) = match crate::commands::ocr::test_ocr_engines(app) {
        Ok(ref s) => (
            s.tesseract_available || s.apple_vision_available || s.claude_vision_available,
            if s.apple_vision_available { "Apple Vision OCR: available".into() }
            else if s.claude_vision_available { "Claude Vision: available (uses Anthropic API)".into() }
            else if s.tesseract_available { "Bundled Tesseract: available".into() }
            else { "No OCR engine — add Anthropic API key in Settings or bundle Tesseract".into() },
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
