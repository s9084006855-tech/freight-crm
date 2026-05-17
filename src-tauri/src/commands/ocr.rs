use crate::{ExtractedContact, OcrEngineStatus, OcrResult};
use serde_json::json;
use std::path::Path;
use std::process::Command;
use tauri::Manager;

const CONFIDENCE_THRESHOLD: f64 = 0.70;
const CLAUDE_MODEL: &str = "claude-sonnet-4-6";
const CLAUDE_API_URL: &str = "https://api.anthropic.com/v1/messages";
const CLAUDE_API_VERSION: &str = "2023-06-01";
const OCR_SYSTEM_PROMPT: &str = "You are extracting contact information from business cards, screenshots, photos, or document scans for a freight broker's CRM. Return ONLY a single JSON object (no markdown fences, no prose) with these exact keys:\n{\n  \"text\": \"all visible text, in reading order\",\n  \"company_name\": string or null,\n  \"contact_name\": string or null,\n  \"contact_title\": string or null,\n  \"phone\": \"primary phone in 10-digit format like 5551234567\" or null,\n  \"phones\": [\"every phone found\"],\n  \"email\": string or null,\n  \"emails\": [\"every email found\"],\n  \"website\": string or null,\n  \"address\": \"full street address\" or null,\n  \"city\": string or null,\n  \"state\": \"2-letter US state code\" or null,\n  \"zip\": string or null,\n  \"confidence\": number between 0 and 1\n}\nIf a field is not visible, use null (not empty string). For confidence, use 1.0 if text is crystal clear, 0.85 for clean printed text, 0.6 for messy/handwritten, 0.3 for barely legible.";

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
        extracted: None,
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
        extracted: None,
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

    let claude_vision_available = crate::commands::keychain::get_raw_api_key().is_some();

    Ok(OcrEngineStatus {
        apple_vision_available,
        tesseract_available,
        claude_vision_available,
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

/// OCR via Claude Vision API. Takes a base64-encoded image and its MIME type
/// (e.g., "image/png", "image/jpeg"). Returns OcrResult with structured contact fields.
#[tauri::command]
pub async fn ocr_image_claude(
    image_base64: String,
    media_type: String,
) -> Result<OcrResult, String> {
    let api_key = crate::commands::keychain::get_raw_api_key()
        .ok_or_else(|| "Anthropic API key not configured. Add it in Settings.".to_string())?;

    // Strip data URL prefix if present (e.g., "data:image/png;base64,...")
    let image_b64 = image_base64
        .split_once(",")
        .map(|(_, rest)| rest.to_string())
        .unwrap_or(image_base64);

    let normalized_mime = if media_type.is_empty() {
        "image/png".to_string()
    } else {
        media_type
    };

    let body = json!({
        "model": CLAUDE_MODEL,
        "max_tokens": 2048,
        "system": [{
            "type": "text",
            "text": OCR_SYSTEM_PROMPT,
            "cache_control": { "type": "ephemeral" }
        }],
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": normalized_mime,
                        "data": image_b64
                    }
                },
                {
                    "type": "text",
                    "text": "Extract the contact information from this image. Return JSON only."
                }
            ]
        }]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(CLAUDE_API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", CLAUDE_API_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Claude API request failed: {}", e))?;

    let status = resp.status();
    let resp_text = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("Claude API error ({}): {}", status, resp_text));
    }

    let resp_json: serde_json::Value =
        serde_json::from_str(&resp_text).map_err(|e| format!("Invalid API response: {}", e))?;

    let content_text = resp_json
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.iter().find(|b| b.get("type").and_then(|t| t.as_str()) == Some("text")))
        .and_then(|b| b.get("text"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| format!("No text content in Claude response: {}", resp_text))?;

    // Claude sometimes wraps JSON in code fences despite instructions — strip them
    let cleaned = strip_code_fences(content_text);

    let parsed: serde_json::Value = serde_json::from_str(cleaned).map_err(|e| {
        format!("Claude returned non-JSON response: {} (raw: {})", e, content_text)
    })?;

    let text = parsed
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let confidence = parsed
        .get("confidence")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.85);

    let extracted = ExtractedContact {
        company_name: get_str(&parsed, "company_name"),
        contact_name: get_str(&parsed, "contact_name"),
        contact_title: get_str(&parsed, "contact_title"),
        phone: get_str(&parsed, "phone"),
        phones: get_str_array(&parsed, "phones"),
        email: get_str(&parsed, "email"),
        emails: get_str_array(&parsed, "emails"),
        website: get_str(&parsed, "website"),
        address: get_str(&parsed, "address"),
        city: get_str(&parsed, "city"),
        state: get_str(&parsed, "state"),
        zip: get_str(&parsed, "zip"),
    };

    Ok(OcrResult {
        text,
        confidence,
        engine: "claude_vision".to_string(),
        low_confidence: confidence < CONFIDENCE_THRESHOLD,
        extracted: Some(extracted),
    })
}

const PDF_SYSTEM_PROMPT: &str = "You are extracting freight broker contacts from a PDF document for a CRM. Each contact represents a company or person to add to a contacts database. Return ONLY a single JSON object (no markdown fences, no prose). The object must have these exact keys:\n{\n  \"contacts\": [\n    {\n      \"company_name\": string or null,\n      \"contact_name\": string or null,\n      \"contact_title\": string or null,\n      \"phone\": \"primary phone as 10 digits like 5551234567\" or null,\n      \"phones\": [\"every phone found\"],\n      \"email\": string or null,\n      \"emails\": [\"every email found\"],\n      \"website\": string or null,\n      \"address\": \"full street address\" or null,\n      \"city\": string or null,\n      \"state\": \"2-letter US state code\" or null,\n      \"zip\": string or null\n    }\n  ],\n  \"returned_count\": number,\n  \"returned_range_start\": number,\n  \"returned_range_end\": number,\n  \"has_more\": boolean,\n  \"total_estimated\": number\n}\nIf a field is not visible, use null (not empty string). Be conservative — only create a contact entry when you see clear contact data (at least one of: company name, phone, or email). Do not invent or hallucinate contacts.";

/// Bulk-extract contacts from a PDF via Claude Vision API. Chunks internally so
/// large documents (hundreds of contacts) work despite output token limits.
/// Uses prompt caching on the PDF content block to keep cost low across iterations.
#[tauri::command]
pub async fn ocr_pdf_claude(
    app: tauri::AppHandle,
    pdf_base64: String,
    chunk_size: Option<usize>,
) -> Result<Vec<ExtractedContact>, String> {
    use tauri::Emitter;

    let api_key = crate::commands::keychain::get_raw_api_key()
        .ok_or_else(|| "Anthropic API key not configured. Add it in Settings.".to_string())?;

    let pdf_b64 = pdf_base64
        .split_once(",")
        .map(|(_, rest)| rest.to_string())
        .unwrap_or(pdf_base64);

    let batch: usize = chunk_size.unwrap_or(40).clamp(5, 100);
    const MAX_ITERATIONS: usize = 60; // safety cap — 60 * 40 = 2400 contact ceiling
    const STALL_LIMIT: usize = 2; // bail if two iterations in a row return 0 new contacts

    let client = reqwest::Client::new();
    let mut all_contacts: Vec<ExtractedContact> = Vec::new();
    let mut offset: usize = 0;
    let mut total_estimated: Option<usize> = None;
    let mut stall_count: usize = 0;

    let _ = app.emit(
        "ocr-pdf-progress",
        serde_json::json!({
            "phase": "started",
            "extracted": 0,
            "estimated": serde_json::Value::Null
        }),
    );

    for iter in 0..MAX_ITERATIONS {
        let instruction = format!(
            "Extract freight broker contacts from this PDF starting at contact #{}. \
             Return up to {} contacts in document order. \
             Set has_more=true if there are more contacts beyond this batch, false if these are the last. \
             Set returned_range_start={} and returned_range_end to the last contact number in this batch. \
             Set total_estimated to your best estimate of the total contacts in the entire PDF. \
             Return JSON only.",
            offset + 1,
            batch,
            offset + 1,
        );

        let body = json!({
            "model": CLAUDE_MODEL,
            "max_tokens": 8192,
            "system": [{
                "type": "text",
                "text": PDF_SYSTEM_PROMPT,
                "cache_control": { "type": "ephemeral" }
            }],
            "messages": [{
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64
                        },
                        "cache_control": { "type": "ephemeral" }
                    },
                    {
                        "type": "text",
                        "text": instruction
                    }
                ]
            }]
        });

        eprintln!("[ocr_pdf_claude] iter={} offset={} batch={}", iter, offset, batch);

        let resp = client
            .post(CLAUDE_API_URL)
            .header("x-api-key", &api_key)
            .header("anthropic-version", CLAUDE_API_VERSION)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Claude API request failed (iter {}): {}", iter, e))?;

        let status = resp.status();
        let resp_text = resp.text().await.map_err(|e| e.to_string())?;

        if !status.is_success() {
            return Err(format!("Claude API error ({}, iter {}): {}", status, iter, resp_text));
        }

        let resp_json: serde_json::Value =
            serde_json::from_str(&resp_text).map_err(|e| format!("Invalid API response: {}", e))?;

        let content_text = resp_json
            .get("content")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.iter().find(|b| b.get("type").and_then(|t| t.as_str()) == Some("text")))
            .and_then(|b| b.get("text"))
            .and_then(|t| t.as_str())
            .ok_or_else(|| format!("No text content in Claude response: {}", resp_text))?;

        let cleaned = strip_code_fences(content_text);
        let parsed: serde_json::Value = serde_json::from_str(cleaned).map_err(|e| {
            format!("Claude returned non-JSON response (iter {}): {} — raw: {}", iter, e, content_text)
        })?;

        let contacts_arr = parsed
            .get("contacts")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let new_count = contacts_arr.len();
        for c in contacts_arr {
            all_contacts.push(ExtractedContact {
                company_name: get_str(&c, "company_name"),
                contact_name: get_str(&c, "contact_name"),
                contact_title: get_str(&c, "contact_title"),
                phone: get_str(&c, "phone"),
                phones: get_str_array(&c, "phones"),
                email: get_str(&c, "email"),
                emails: get_str_array(&c, "emails"),
                website: get_str(&c, "website"),
                address: get_str(&c, "address"),
                city: get_str(&c, "city"),
                state: get_str(&c, "state"),
                zip: get_str(&c, "zip"),
            });
        }

        if total_estimated.is_none() {
            total_estimated = parsed
                .get("total_estimated")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize);
        }

        let has_more = parsed
            .get("has_more")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let _ = app.emit(
            "ocr-pdf-progress",
            serde_json::json!({
                "phase": "chunk_done",
                "extracted": all_contacts.len(),
                "estimated": total_estimated,
                "iteration": iter + 1,
                "new_in_batch": new_count,
                "has_more": has_more,
            }),
        );

        if new_count == 0 {
            stall_count += 1;
            if stall_count >= STALL_LIMIT {
                eprintln!("[ocr_pdf_claude] stalled — bailing at offset {}", offset);
                break;
            }
        } else {
            stall_count = 0;
        }

        offset += new_count.max(1); // always advance, even on empty, to avoid infinite loops
        if !has_more {
            break;
        }
    }

    let _ = app.emit(
        "ocr-pdf-progress",
        serde_json::json!({
            "phase": "done",
            "extracted": all_contacts.len(),
            "estimated": total_estimated,
        }),
    );

    Ok(all_contacts)
}

fn strip_code_fences(s: &str) -> &str {
    let trimmed = s.trim();
    let without_open = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed);
    without_open.strip_suffix("```").unwrap_or(without_open).trim()
}

fn get_str(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn get_str_array(v: &serde_json::Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
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
