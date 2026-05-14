use crate::{AppState, EnrichmentResult};
use crate::commands::conn_err;
use futures::future::join_all;
use rusqlite::params;
use scraper::{Html, Selector};
use tauri::{AppHandle, Emitter, Manager, State};

const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BATCH_SIZE: usize = 8;

fn company_slug(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

async fn fetch_importyeti(company_name: &str) -> (bool, Vec<String>, Vec<String>, Option<i32>) {
    let slug = company_slug(company_name);
    let url = format!("https://www.importyeti.com/company/{}", slug);

    let client = match reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return (false, vec![], vec![], None),
    };

    let html = match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => match resp.text().await {
            Ok(t) => t,
            Err(_) => return (false, vec![], vec![], None),
        },
        _ => return (false, vec![], vec![], None),
    };

    let doc = Html::parse_document(&html);

    let mut commodities: Vec<String> = vec![];
    let commodity_selectors = [
        "span.product-description",
        ".product-desc",
        "td.product",
        "[class*='product']",
        "[class*='commodity']",
        "[class*='description']",
    ];
    for sel_str in &commodity_selectors {
        if let Ok(sel) = Selector::parse(sel_str) {
            for el in doc.select(&sel).take(20) {
                let text = el.text().collect::<String>().trim().to_uppercase();
                if !text.is_empty() && text.len() < 100 && is_commodity_text(&text) {
                    if !commodities.contains(&text) {
                        commodities.push(text);
                    }
                }
            }
        }
    }

    if commodities.is_empty() {
        if let Ok(sel) = Selector::parse("td, li") {
            for el in doc.select(&sel).take(200) {
                let text = el.text().collect::<String>().trim().to_uppercase();
                if !text.is_empty() && text.len() < 80 && is_commodity_text(&text) {
                    if !commodities.contains(&text) {
                        commodities.push(text);
                    }
                    if commodities.len() >= 10 {
                        break;
                    }
                }
            }
        }
    }

    let mut suppliers: Vec<String> = vec![];
    let supplier_selectors = [
        "[class*='supplier']",
        "[class*='shipper']",
        "[class*='exporter']",
        "a[href*='/company/']",
    ];
    for sel_str in &supplier_selectors {
        if let Ok(sel) = Selector::parse(sel_str) {
            for el in doc.select(&sel).take(10) {
                let text = el.text().collect::<String>().trim().to_string();
                if !text.is_empty() && text.len() > 3 && text.len() < 60 {
                    if !suppliers.contains(&text) {
                        suppliers.push(text);
                    }
                }
            }
        }
    }

    let shipment_count = extract_shipment_count(&doc);
    let found = !commodities.is_empty() || !suppliers.is_empty() || shipment_count.is_some();
    (found, commodities, suppliers, shipment_count)
}

fn is_commodity_text(text: &str) -> bool {
    let keywords = [
        "PRODUCE", "FRUIT", "VEGETABLE", "FRESH", "FROZEN", "MEAT", "SEAFOOD",
        "BERRY", "BERRIES", "APPLE", "ORANGE", "GRAPE", "TOMATO", "PEPPER",
        "LETTUCE", "ONION", "GARLIC", "POTATO", "CITRUS", "MANGO", "AVOCADO",
        "BANANA", "STRAWBERRY", "BLUEBERRY", "CORN", "BROCCOLI", "SPINACH",
        "CARROT", "CELERY", "CUCUMBER", "SQUASH", "MELON", "PINEAPPLE",
        "FOOD", "AGRICULTURAL", "ORGANIC", "DRIED", "PACKAGED",
    ];
    keywords.iter().any(|k| text.contains(k))
}

fn extract_shipment_count(doc: &Html) -> Option<i32> {
    let selectors = [
        "[class*='shipment-count']",
        "[class*='total-shipments']",
        "[class*='record-count']",
    ];
    for sel_str in &selectors {
        if let Ok(sel) = Selector::parse(sel_str) {
            if let Some(el) = doc.select(&sel).next() {
                let text = el.text().collect::<String>();
                let digits: String = text.chars().filter(|c| c.is_ascii_digit()).collect();
                if let Ok(n) = digits.parse::<i32>() {
                    return Some(n);
                }
            }
        }
    }
    None
}

fn generate_cold_call_script(
    company_name: &str,
    user_display_name: &str,
    commodities: &[String],
    suppliers: &[String],
    shipment_count: Option<i32>,
) -> String {
    let commodity_str = if commodities.is_empty() {
        "produce".to_string()
    } else {
        commodities[..commodities.len().min(3)]
            .iter()
            .map(|s| s.to_lowercase())
            .collect::<Vec<_>>()
            .join(", ")
    };

    let supplier_line = if !suppliers.is_empty() {
        format!(
            "\nI can see you work with suppliers like {}.",
            suppliers[..suppliers.len().min(2)].join(" and ")
        )
    } else {
        String::new()
    };

    let volume_line = match shipment_count {
        Some(n) if n > 50 => format!("\nWith {} shipments on record, you clearly move a lot of volume.", n),
        Some(n) if n > 10 => format!("\nI see you've got {} shipments on record.", n),
        _ => String::new(),
    };

    let first_name = user_display_name.split_whitespace().next().unwrap_or(user_display_name);

    format!(
        "OPENING\n\
        \"Hi, may I speak with someone in transportation or logistics?\"\n\
        [wait]\n\
        \"My name is {first_name} — I'm a produce freight broker specializing in {commodity_str} shipments.\"\n\
        \n\
        HOOK{supplier_line}{volume_line}\n\
        \"We help shippers like {company_name} secure competitive reefer rates on short notice — especially on produce lanes where timing is everything.\"\n\
        \n\
        QUALIFYING QUESTIONS\n\
        \"Are you currently using freight brokers for any of your loads?\"\n\
        [pause — let them talk]\n\
        \"What lanes are you running most often?\"\n\
        \"How far out are you typically booking?\"\n\
        \"Who's your main carrier right now?\"\n\
        \n\
        CLOSE\n\
        \"I'd love to put together some spot rates for you this week — no commitment, just want to show you what we can do.\"\n\
        \"What's the best email to send those to?\"",
        first_name = first_name,
        commodity_str = commodity_str,
        supplier_line = supplier_line,
        volume_line = volume_line,
        company_name = company_name,
    )
}

async fn enrich_one(
    contact_id: i64,
    company_name: String,
    user_display_name: String,
    db_path: String,
) -> EnrichmentResult {
    let (found, commodities, suppliers, shipment_count) =
        fetch_importyeti(&company_name).await;

    let script = generate_cold_call_script(
        &company_name,
        &user_display_name,
        &commodities,
        &suppliers,
        shipment_count,
    );

    let now = chrono::Utc::now().timestamp();
    let enrichment_data = serde_json::json!({
        "commodities": commodities,
        "suppliers": suppliers,
        "shipment_count": shipment_count,
        "cold_call_script": script,
        "found_on_importyeti": found,
        "enriched_at": now,
    });

    // Write back to DB directly using the path
    let write_result = (|| -> Result<(), String> {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE contacts SET enrichment_status='done', enrichment_data=?1, enriched_at=?2 WHERE id=?3",
            params![enrichment_data.to_string(), now, contact_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    })();

    EnrichmentResult {
        contact_id,
        company_name,
        found_on_importyeti: found,
        commodities,
        suppliers,
        shipment_count,
        phone_found: None,
        email_found: None,
        cold_call_script: script,
        error: write_result.err(),
    }
}

#[tauri::command]
pub async fn enrich_contact(
    state: State<'_, AppState>,
    contact_id: i64,
) -> Result<EnrichmentResult, String> {
    let (company_name, user_display_name, db_path) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.as_ref().ok_or_else(conn_err)?;
        let name: String = conn
            .query_row("SELECT company_name FROM contacts WHERE id=?1", params![contact_id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
        let user_name = cfg.active_user.clone()
            .map(|id| {
                crate::commands::users::all_users()
                    .into_iter()
                    .find(|u| u.id == id)
                    .map(|u| u.display_name)
                    .unwrap_or(id)
            })
            .unwrap_or_else(|| "Francisco".to_string());
        let path = cfg.db_path.clone();
        (name, user_name, path)
    };

    Ok(enrich_one(contact_id, company_name, user_display_name, db_path).await)
}

#[tauri::command]
pub async fn enrich_all_contacts(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<EnrichmentResult>, String> {
    let (contact_ids, user_display_name, db_path) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.as_ref().ok_or_else(conn_err)?;
        let mut stmt = conn.prepare(
            "SELECT id, company_name FROM contacts WHERE status != 'deleted' AND enrichment_status IS NULL ORDER BY id LIMIT 500"
        ).map_err(|e| e.to_string())?;
        let ids = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(|e| e.to_string())?;
        let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
        let user_name = cfg.active_user.clone()
            .map(|id| {
                crate::commands::users::all_users()
                    .into_iter()
                    .find(|u| u.id == id)
                    .map(|u| u.display_name)
                    .unwrap_or(id)
            })
            .unwrap_or_else(|| "Francisco".to_string());
        let path = cfg.db_path.clone();
        (ids, user_name, path)
    };

    let mut all_results: Vec<EnrichmentResult> = Vec::new();

    // Process in parallel batches of BATCH_SIZE
    for chunk in contact_ids.chunks(BATCH_SIZE) {
        let futures: Vec<_> = chunk.iter().map(|(id, name)| {
            enrich_one(*id, name.clone(), user_display_name.clone(), db_path.clone())
        }).collect();

        let batch_results = join_all(futures).await;

        for result in batch_results {
            // Mark failed contacts in DB
            if result.error.is_some() {
                if let Ok(db) = state.db.lock() {
                    if let Some(conn) = db.as_ref() {
                        let _ = conn.execute(
                            "UPDATE contacts SET enrichment_status='failed' WHERE id=?1",
                            params![result.contact_id],
                        );
                    }
                }
            }
            // Emit progress event so frontend updates in real-time
            let _ = app.emit("enrich-progress", &result);
            all_results.push(result);
        }

        // Short pause between batches to avoid rate limiting
        if contact_ids.len() > BATCH_SIZE {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
    }

    Ok(all_results)
}
