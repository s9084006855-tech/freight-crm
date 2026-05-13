use crate::OcrEngineStatus;
use crate::OcrResult;
use std::path::Path;
use std::process::Command;
use tauri::Manager;

const CONFIDENCE_THRESHOLD: f64 = 0.70;

#[tauri::command]
pub fn ocr_image(app: tauri::AppHandle, image_path: String) -> Result<OcrResult, String> {
    // Try Apple Vision first
    if let Ok(result) = try_apple_vision(&app, &image_path) {
        if result.confidence >= CONFIDENCE_THRESHOLD || !tesseract_available(&app) {
            return Ok(result);
        }
        // Low confidence and Tesseract is available — try Tesseract too, return best
        if let Ok(tess_result) = try_tesseract(&app, &image_path) {
            return Ok(if tess_result.confidence > result.confidence {
                tess_result
            } else {
                result
            });
        }
        return Ok(result);
    }

    // Apple Vision unavailable or failed — fall back to Tesseract
    try_tesseract(&app, &image_path)
        .map_err(|e| format!("All OCR engines failed. Last error: {}", e))
}

fn try_apple_vision(app: &tauri::AppHandle, image_path: &str) -> Result<OcrResult, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;
    let helper = resource_dir.join("vision_ocr");

    if !helper.exists() {
        return Err("Vision helper binary not found".to_string());
    }

    let output = Command::new(&helper)
        .args(["image", image_path])
        .output()
        .map_err(|e| format!("Failed to run vision_ocr: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "vision_ocr exited with {}",
            output.status
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value =
        serde_json::from_str(stdout.trim()).map_err(|e| format!("Invalid JSON from vision_ocr: {}", e))?;

    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        if !err.is_empty() {
            return Err(err.to_string());
        }
    }

    let text = json
        .get("fullText")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let confidence = json
        .get("averageConfidence")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    Ok(OcrResult {
        text,
        confidence,
        engine: "apple_vision".to_string(),
        low_confidence: confidence < CONFIDENCE_THRESHOLD,
    })
}

fn try_tesseract(app: &tauri::AppHandle, image_path: &str) -> Result<OcrResult, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;
    let tess_bin = resource_dir.join("tesseract/tesseract");
    let tessdata = resource_dir.join("tesseract/tessdata");
    let lib_dir = resource_dir.join("tesseract/lib");

    if !tess_bin.exists() {
        return Err("Bundled Tesseract binary not found. Run scripts/bundle_tesseract.sh.".to_string());
    }

    let output = Command::new(&tess_bin)
        .env("TESSDATA_PREFIX", &tessdata)
        .env("DYLD_LIBRARY_PATH", &lib_dir)
        .args([image_path, "stdout", "-l", "eng", "--psm", "3"])
        .output()
        .map_err(|e| format!("Failed to run Tesseract: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Tesseract error: {}", stderr));
    }

    let text = String::from_utf8_lossy(&output.stdout).to_string();

    // Tesseract doesn't provide a direct overall confidence in stdout mode.
    // Use a heuristic: ratio of alpha+digit chars to total non-whitespace chars.
    let total: usize = text.chars().filter(|c| !c.is_whitespace()).count();
    let useful: usize = text.chars().filter(|c| c.is_alphanumeric() || ".,@:-/()".contains(*c)).count();
    let confidence = if total > 0 { useful as f64 / total as f64 } else { 0.0 };

    Ok(OcrResult {
        text,
        confidence,
        engine: "tesseract".to_string(),
        low_confidence: confidence < CONFIDENCE_THRESHOLD,
    })
}

fn tesseract_available(app: &tauri::AppHandle) -> bool {
    app.path()
        .resource_dir()
        .map(|d| d.join("tesseract/tesseract").exists())
        .unwrap_or(false)
}

#[tauri::command]
pub fn test_ocr_engines(app: tauri::AppHandle) -> Result<OcrEngineStatus, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;

    let vision_path = resource_dir.join("vision_ocr");
    let tess_path = resource_dir.join("tesseract/tesseract");
    let tessdata = resource_dir.join("tesseract/tessdata");
    let lib_dir = resource_dir.join("tesseract/lib");

    let apple_vision_available = vision_path.exists() && {
        Command::new(&vision_path)
            .args(["image", "/dev/null"])
            .output()
            .map(|o| {
                let s = String::from_utf8_lossy(&o.stdout);
                s.contains("error") || s.contains("fullText") // helper ran
            })
            .unwrap_or(false)
    };

    let mut last_test: Option<String> = None;
    let tesseract_available = tess_path.exists() && {
        // Run with bundled test asset
        let test_img = resource_dir.join("tesseract/test_asset.png");
        let path = if test_img.exists() { test_img } else { Path::new("/dev/null").to_path_buf() };
        let result = Command::new(&tess_path)
            .env("TESSDATA_PREFIX", &tessdata)
            .env("DYLD_LIBRARY_PATH", &lib_dir)
            .args([path.to_str().unwrap_or(""), "stdout", "-l", "eng"])
            .output();
        match result {
            Ok(o) if o.status.success() => {
                last_test = Some("Tesseract self-test passed".to_string());
                true
            }
            Ok(o) => {
                last_test = Some(format!(
                    "Tesseract self-test failed: {}",
                    String::from_utf8_lossy(&o.stderr)
                ));
                false
            }
            Err(e) => {
                last_test = Some(format!("Tesseract not runnable: {}", e));
                false
            }
        }
    };

    Ok(OcrEngineStatus {
        apple_vision_available,
        tesseract_available,
        tesseract_path: if tess_path.exists() {
            Some(tess_path.to_string_lossy().to_string())
        } else {
            None
        },
        vision_helper_path: if vision_path.exists() {
            Some(vision_path.to_string_lossy().to_string())
        } else {
            None
        },
        last_test_result: last_test,
    })
}

/// Render a PDF page to a PNG and return the temp file path (used internally)
pub fn render_pdf_page(app: &tauri::AppHandle, pdf_path: &str, page: usize) -> Result<String, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let helper = resource_dir.join("vision_ocr");
    if !helper.exists() {
        return Err("Vision helper not available for PDF rendering".to_string());
    }

    let tmp = std::env::temp_dir().join(format!("freight_crm_pdf_{}.png", page));
    let output = Command::new(&helper)
        .args([
            "pdf-page",
            pdf_path,
            &page.to_string(),
            tmp.to_str().unwrap_or(""),
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if output.stdout.starts_with(b"ok") {
        Ok(tmp.to_string_lossy().to_string())
    } else {
        Err(format!(
            "PDF render failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}
