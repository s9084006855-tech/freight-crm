use crate::{AppState, EnrichmentResult};
use crate::commands::conn_err;
use crate::commands::keychain::get_raw_api_key;
use futures::future::join_all;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

const CLAUDE_API: &str = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL: &str = "claude-haiku-4-5-20251001";
const PARALLEL: usize = 5;   // concurrent web searches
const MAX_TOOL_TURNS: usize = 8;

#[derive(Clone)]
struct ContactRow {
    id: i64,
    company_name: String,
    city: Option<String>,
    state: Option<String>,
    roles: Option<String>,
    commodities: Option<String>,
}

// ── Claude web-search research ────────────────────────────────────────

async fn research_company(
    api_key: &str,
    contact: &ContactRow,
    broker_first_name: &str,
) -> EnrichmentResult {
    let location = match (&contact.city, &contact.state) {
        (Some(c), Some(s)) => format!("{}, {}", c, s),
        (None, Some(s)) => s.clone(),
        (Some(c), None) => c.clone(),
        _ => String::new(),
    };

    let known_role = contact.roles.as_deref().unwrap_or("");
    let known_commodity = contact.commodities.as_deref().unwrap_or("");

    let prompt = format!(
        "Research the company \"{name}\"{loc_part} for a produce freight broker named {broker}.\n\
        Use web search to find as much as possible:\n\
        - What commodities/produce they ship or handle\n\
        - Their role in the supply chain (shipper, receiver, distributor, grower, cold storage, etc.)\n\
        - Common shipping lanes or origin/destination regions\n\
        - Key contact titles in their logistics/traffic department\n\
        - Website and approximate size/volume\n\
        - Any import or shipping history from public records\n\
        {known}\n\
        After researching, respond with ONLY this JSON (no markdown, no extra text):\n\
        {{\n\
          \"commodities\": [\"item1\", \"item2\"],\n\
          \"role\": \"their supply chain role\",\n\
          \"shipping_lanes\": [\"e.g. California to Texas\"],\n\
          \"key_contact_title\": \"e.g. Traffic Manager\",\n\
          \"website\": \"url or null\",\n\
          \"annual_volume_estimate\": \"e.g. 50-100 loads/week or null\",\n\
          \"profile_notes\": \"2-3 sentences of useful context for the cold call\",\n\
          \"cold_call_script\": \"full personalized script {broker} can read verbatim\"\n\
        }}",
        name = contact.company_name,
        loc_part = if location.is_empty() { String::new() } else { format!(" in {}", location) },
        broker = broker_first_name,
        known = if known_role.is_empty() && known_commodity.is_empty() {
            String::new()
        } else {
            format!("We already know: role={}, commodities={}.", known_role, known_commodity)
        },
    );

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
    {
        Ok(c) => c,
        Err(e) => return error_result(contact, &e.to_string()),
    };

    match call_claude_with_web_search(&client, api_key, &prompt).await {
        Ok(text) => parse_profile_response(contact, &text, broker_first_name),
        Err(e) => error_result(contact, &e),
    }
}

async fn call_claude_with_web_search(
    client: &reqwest::Client,
    api_key: &str,
    initial_prompt: &str,
) -> Result<String, String> {
    let tools = json!([{
        "type": "web_search_20250305",
        "name": "web_search"
    }]);

    let mut messages: Vec<Value> = vec![
        json!({"role": "user", "content": initial_prompt})
    ];

    for _ in 0..MAX_TOOL_TURNS {
        let body = json!({
            "model": CLAUDE_MODEL,
            "max_tokens": 2048,
            "tools": tools,
            "messages": messages
        });

        let resp = client
            .post(CLAUDE_API)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let resp_json: Value = resp.json().await.map_err(|e| e.to_string())?;

        // Check for API errors
        if let Some(err) = resp_json.get("error") {
            return Err(err["message"].as_str().unwrap_or("API error").to_string());
        }

        let stop_reason = resp_json["stop_reason"].as_str().unwrap_or("");
        let content = resp_json["content"].as_array().cloned().unwrap_or_default();

        // Extract any text blocks from this turn
        let text_so_far: String = content.iter()
            .filter_map(|b| {
                if b["type"].as_str() == Some("text") {
                    b["text"].as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("");

        if stop_reason == "end_turn" {
            return Ok(text_so_far);
        }

        if stop_reason == "tool_use" {
            // Add assistant's turn to message history
            messages.push(json!({"role": "assistant", "content": content.clone()}));

            // Build tool results for any tool_use blocks
            let mut tool_results: Vec<Value> = vec![];
            for block in &content {
                if block["type"].as_str() == Some("tool_use") {
                    let tool_id = block["id"].as_str().unwrap_or("").to_string();
                    // For server-side web_search, Anthropic handles execution.
                    // If we get here it means we need to return a stub result
                    // so Claude can continue its reasoning.
                    tool_results.push(json!({
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": "Search results processed."
                    }));
                }
            }

            if !tool_results.is_empty() {
                messages.push(json!({"role": "user", "content": tool_results}));
            } else if !text_so_far.is_empty() {
                return Ok(text_so_far);
            }
            continue;
        }

        // Any other stop reason — return what we have
        if !text_so_far.is_empty() {
            return Ok(text_so_far);
        }
    }

    Err("Max tool turns exceeded".to_string())
}

fn parse_profile_response(
    contact: &ContactRow,
    text: &str,
    broker_first_name: &str,
) -> EnrichmentResult {
    // Extract JSON from response (Claude may wrap in markdown)
    let json_text = if let (Some(s), Some(e)) = (text.find('{'), text.rfind('}')) {
        &text[s..=e]
    } else {
        // No JSON found — generate a basic script without web data
        return EnrichmentResult {
            contact_id: contact.id,
            company_name: contact.company_name.clone(),
            commodities: parse_csv(&contact.commodities),
            role: contact.roles.clone(),
            shipping_lanes: vec![],
            key_contact_title: None,
            website: None,
            annual_volume_estimate: None,
            profile_notes: None,
            cold_call_script: fallback_script(&contact.company_name, broker_first_name),
            web_searched: true,
            error: None,
        };
    };

    let v: Value = match serde_json::from_str(json_text) {
        Ok(v) => v,
        Err(_) => return EnrichmentResult {
            contact_id: contact.id,
            company_name: contact.company_name.clone(),
            commodities: parse_csv(&contact.commodities),
            role: contact.roles.clone(),
            shipping_lanes: vec![],
            key_contact_title: None,
            website: None,
            annual_volume_estimate: None,
            profile_notes: None,
            cold_call_script: fallback_script(&contact.company_name, broker_first_name),
            web_searched: true,
            error: None,
        },
    };

    let commodities = v["commodities"].as_array()
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_else(|| parse_csv(&contact.commodities));

    let shipping_lanes = v["shipping_lanes"].as_array()
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();

    let script = v["cold_call_script"].as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or("")
        .to_string();
    let script = if script.is_empty() {
        fallback_script(&contact.company_name, broker_first_name)
    } else {
        script
    };

    EnrichmentResult {
        contact_id: contact.id,
        company_name: contact.company_name.clone(),
        commodities,
        role: v["role"].as_str().map(|s| s.to_string()),
        shipping_lanes,
        key_contact_title: v["key_contact_title"].as_str().map(|s| s.to_string()),
        website: v["website"].as_str().filter(|s| *s != "null").map(|s| s.to_string()),
        annual_volume_estimate: v["annual_volume_estimate"].as_str()
            .filter(|s| *s != "null").map(|s| s.to_string()),
        profile_notes: v["profile_notes"].as_str().map(|s| s.to_string()),
        cold_call_script: script,
        web_searched: true,
        error: None,
    }
}

// ── Helpers ───────────────────────────────────────────────────────────

fn fallback_script(company_name: &str, broker: &str) -> String {
    format!(
        "OPENING\n\"Hi, may I speak with whoever handles freight or transportation?\"\n\
        \"This is {} — I'm a produce freight broker specializing in reefer lanes.\"\n\n\
        HOOK\n\"We help shippers like {} lock in competitive rates fast, especially on time-sensitive produce loads.\"\n\n\
        QUALIFYING\n\"Are you using freight brokers currently?\"\n\
        \"What lanes are you running most?\"\n\"How far out do you book?\"\n\n\
        CLOSE\n\"I'd love to send you some spot rates — what email should I use?\"",
        broker, company_name
    )
}

fn parse_csv(val: &Option<String>) -> Vec<String> {
    val.as_ref()
        .map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect())
        .unwrap_or_default()
}

fn error_result(contact: &ContactRow, err: &str) -> EnrichmentResult {
    EnrichmentResult {
        contact_id: contact.id,
        company_name: contact.company_name.clone(),
        commodities: vec![],
        role: None,
        shipping_lanes: vec![],
        key_contact_title: None,
        website: None,
        annual_volume_estimate: None,
        profile_notes: None,
        cold_call_script: String::new(),
        web_searched: false,
        error: Some(err.to_string()),
    }
}

fn write_to_db(db_path: &str, result: &EnrichmentResult) {
    let now = chrono::Utc::now().timestamp();
    let data = serde_json::json!({
        "commodities": result.commodities,
        "role": result.role,
        "shipping_lanes": result.shipping_lanes,
        "key_contact_title": result.key_contact_title,
        "website": result.website,
        "annual_volume_estimate": result.annual_volume_estimate,
        "profile_notes": result.profile_notes,
        "cold_call_script": result.cold_call_script,
        "web_searched": result.web_searched,
        "enriched_at": now,
    });
    if let Ok(conn) = rusqlite::Connection::open(db_path) {
        let status = if result.error.is_some() { "failed" } else { "done" };
        let _ = conn.execute(
            "UPDATE contacts SET enrichment_status=?1, enrichment_data=?2, enriched_at=?3 WHERE id=?4",
            params![status, data.to_string(), now, result.contact_id],
        );
    }
}

// ── Tauri commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn enrich_contact(
    state: State<'_, AppState>,
    contact_id: i64,
) -> Result<EnrichmentResult, String> {
    let (row, broker, db_path) = load_one(&state, contact_id)?;
    let api_key = get_raw_api_key().ok_or("No API key set — add it in Settings")?;
    let result = research_company(&api_key, &row, &broker).await;
    write_to_db(&db_path, &result);
    Ok(result)
}

#[tauri::command]
pub async fn enrich_all_contacts(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<EnrichmentResult>, String> {
    let (rows, broker, db_path) = load_unenriched(&state)?;

    if rows.is_empty() {
        return Ok(vec![]);
    }

    let api_key = match get_raw_api_key() {
        Some(k) => k,
        None => return Err("No API key set — add it in Settings".to_string()),
    };

    let mut all: Vec<EnrichmentResult> = Vec::with_capacity(rows.len());

    // Process PARALLEL contacts at a time
    for chunk in rows.chunks(PARALLEL) {
        let futures: Vec<_> = chunk.iter().map(|row| {
            let key = api_key.clone();
            let row = row.clone();
            let broker = broker.clone();
            async move { research_company(&key, &row, &broker).await }
        }).collect();

        let results = join_all(futures).await;

        for result in results {
            write_to_db(&db_path, &result);
            let _ = app.emit("enrich-progress", &result);
            all.push(result);
        }
    }

    Ok(all)
}

// ── DB loaders ────────────────────────────────────────────────────────

fn load_one(state: &AppState, id: i64) -> Result<(ContactRow, String, String), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    let row = conn.query_row(
        "SELECT id, company_name, city, state, roles, commodities FROM contacts WHERE id=?1",
        params![id],
        |r| Ok(ContactRow {
            id: r.get(0)?, company_name: r.get(1)?,
            city: r.get(2)?, state: r.get(3)?,
            roles: r.get(4)?, commodities: r.get(5)?,
        }),
    ).map_err(|e| e.to_string())?;
    let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
    let broker = broker_first_name(&cfg);
    Ok((row, broker, cfg.db_path.clone()))
}

fn load_unenriched(state: &AppState) -> Result<(Vec<ContactRow>, String, String), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    let mut stmt = conn.prepare(
        "SELECT id, company_name, city, state, roles, commodities \
         FROM contacts WHERE status != 'deleted' AND enrichment_status IS NULL \
         ORDER BY company_name LIMIT 500",
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(ContactRow {
        id: r.get(0)?, company_name: r.get(1)?,
        city: r.get(2)?, state: r.get(3)?,
        roles: r.get(4)?, commodities: r.get(5)?,
    }))
    .and_then(|r| r.collect::<Result<Vec<_>, _>>())
    .map_err(|e| e.to_string())?;
    let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
    let broker = broker_first_name(&cfg);
    Ok((rows, broker, cfg.db_path.clone()))
}

fn broker_first_name(cfg: &crate::LocalConfig) -> String {
    cfg.active_user.as_ref()
        .and_then(|id| {
            crate::commands::users::all_users()
                .into_iter()
                .find(|u| &u.id == id)
                .map(|u| u.display_name.split_whitespace().next().unwrap_or(&u.display_name).to_string())
        })
        .unwrap_or_else(|| "Francisco".to_string())
}
