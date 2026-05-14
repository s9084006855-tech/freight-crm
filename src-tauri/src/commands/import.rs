use crate::{AppState, ImportAction, ImportResult, ImportSession, MappingTemplate, ParsedContact};
use crate::db::{last_insert_rowid, normalize_company, normalize_phone};
use sha2::{Digest, Sha256};
use tauri::State;

#[tauri::command]
pub async fn create_import_session(
    state: State<'_, AppState>,
    source_type: String,
    source_name: Option<String>,
) -> Result<i64, String> {
    let conn = state.conn()?;
    conn.execute(
        "INSERT INTO import_sessions (source_type, source_name, status) VALUES (?1, ?2, 'pending')",
        libsql::params![source_type, source_name],
    )
    .await
    .map_err(|e| e.to_string())?;
    last_insert_rowid(&conn).await
}

#[tauri::command]
pub async fn commit_import(
    state: State<'_, AppState>,
    session_id: i64,
    rows: Vec<serde_json::Value>,
    actions: Vec<ImportAction>,
) -> Result<ImportResult, String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();

    conn.execute("BEGIN", libsql::params![])
        .await
        .map_err(|e| e.to_string())?;

    let mut added = 0i64;
    let mut merged = 0i64;
    let mut discarded = 0i64;

    let result: Result<(), String> = async {
        for action in &actions {
            let row_val = rows
                .get(action.row_index as usize)
                .cloned()
                .unwrap_or(serde_json::Value::Null);

            let parsed: ParsedContact = serde_json::from_value(row_val.clone())
                .unwrap_or_else(|_| ParsedContact {
                    company_name: None, phone: None, fax: None, email: None,
                    website: None, street: None, city: None, state: None, zip: None,
                    roles: None, commodities: None, contact_name: None, contact_title: None,
                    contact_phone: None, contact_email: None, bbid: None, notes: None,
                });
            let parsed_json = serde_json::to_string(&parsed).unwrap_or_default();

            match action.action.as_str() {
                "discard" => {
                    let _ = conn.execute(
                        "INSERT INTO parsing_logs (session_id, row_index, raw_data, status)
                         VALUES (?1, ?2, ?3, 'discarded')",
                        libsql::params![session_id, action.row_index, row_val.to_string()],
                    )
                    .await;
                    discarded += 1;
                }
                "merge" => {
                    if let Some(contact_id) = action.merge_contact_id {
                        // Snapshot existing columns for rollback
                        let prev = snapshot_contact(&conn, contact_id).await.ok();

                        let _ = conn.execute(
                            "INSERT INTO import_session_contacts (session_id, contact_id, action, previous_data)
                             VALUES (?1, ?2, 'merged', ?3)",
                            libsql::params![session_id, contact_id, prev.map(|v| v.to_string())],
                        )
                        .await;

                        apply_merge(&conn, contact_id, &parsed, &action.merge_fields, now).await?;
                        merged += 1;
                    }
                }
                _ => {
                    let company = match &parsed.company_name {
                        Some(n) if !n.trim().is_empty() => n.clone(),
                        _ => continue,
                    };
                    let search = normalize_company(&company);
                    let phone_norm = parsed.phone.as_deref().map(normalize_phone);

                    conn.execute(
                        "INSERT INTO contacts
                             (bbid, company_name, company_name_search, phone, phone_normalized,
                              fax, email, website, street, city, state, zip, roles, commodities,
                              status, priority, source, notes, created_at, updated_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'active',0,'import',?15,?16,?16)",
                        libsql::params![
                            parsed.bbid, company, search,
                            parsed.phone, phone_norm, parsed.fax, parsed.email,
                            parsed.website, parsed.street, parsed.city, parsed.state,
                            parsed.zip, parsed.roles, parsed.commodities, parsed.notes, now,
                        ],
                    )
                    .await
                    .map_err(|e| e.to_string())?;

                    let contact_id = last_insert_rowid(&conn).await?;

                    if let Some(ref name) = parsed.contact_name {
                        if !name.trim().is_empty() {
                            let _ = conn.execute(
                                "INSERT INTO contact_people (contact_id, name, title, phone, email, is_primary)
                                 VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                                libsql::params![
                                    contact_id, name.clone(),
                                    parsed.contact_title.clone(),
                                    parsed.contact_phone.clone(),
                                    parsed.contact_email.clone(),
                                ],
                            )
                            .await;
                        }
                    }

                    let _ = conn.execute(
                        "INSERT INTO import_session_contacts (session_id, contact_id, action)
                         VALUES (?1, ?2, 'added')",
                        libsql::params![session_id, contact_id],
                    )
                    .await;

                    let _ = conn.execute(
                        "INSERT INTO parsing_logs (session_id, row_index, raw_data, parsed_data, status)
                         VALUES (?1, ?2, ?3, ?4, 'kept')",
                        libsql::params![
                            session_id, action.row_index,
                            row_val.to_string(), parsed_json,
                        ],
                    )
                    .await;

                    added += 1;
                }
            }
        }
        Ok(())
    }.await;

    if let Err(e) = result {
        let _ = conn.execute("ROLLBACK", libsql::params![]).await;
        return Err(e);
    }

    conn.execute(
        "UPDATE import_sessions SET status='completed', completed_at=?1,
         contacts_added=?2, contacts_merged=?3, contacts_discarded=?4
         WHERE id=?5",
        libsql::params![now, added, merged, discarded, session_id],
    )
    .await
    .map_err(|e| e.to_string())?;

    conn.execute("COMMIT", libsql::params![])
        .await
        .map_err(|e| e.to_string())?;

    Ok(ImportResult { session_id, added, merged, discarded })
}

async fn snapshot_contact(
    conn: &libsql::Connection,
    contact_id: i64,
) -> Result<serde_json::Value, String> {
    let mut rows = conn.query(
        "SELECT phone, fax, email, website, street, city, state, zip,
                roles, commodities, notes, updated_at
         FROM contacts WHERE id=?1",
        libsql::params![contact_id],
    )
    .await
    .map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        let obj = serde_json::json!({
            "phone":       row.get::<Option<String>>(0).ok().flatten(),
            "fax":         row.get::<Option<String>>(1).ok().flatten(),
            "email":       row.get::<Option<String>>(2).ok().flatten(),
            "website":     row.get::<Option<String>>(3).ok().flatten(),
            "street":      row.get::<Option<String>>(4).ok().flatten(),
            "city":        row.get::<Option<String>>(5).ok().flatten(),
            "state":       row.get::<Option<String>>(6).ok().flatten(),
            "zip":         row.get::<Option<String>>(7).ok().flatten(),
            "roles":       row.get::<Option<String>>(8).ok().flatten(),
            "commodities": row.get::<Option<String>>(9).ok().flatten(),
            "notes":       row.get::<Option<String>>(10).ok().flatten(),
            "updated_at":  row.get::<i64>(11).ok(),
        });
        Ok(obj)
    } else {
        Err("Contact not found".to_string())
    }
}

async fn apply_merge(
    conn: &libsql::Connection,
    contact_id: i64,
    parsed: &ParsedContact,
    merge_fields: &Option<serde_json::Value>,
    now: i64,
) -> Result<(), String> {
    let use_all = merge_fields.is_none();

    macro_rules! merge_field {
        ($val:expr, $col:literal, $key:literal) => {
            if let Some(ref v) = $val {
                let should_update = use_all
                    || merge_fields
                        .as_ref()
                        .and_then(|f| f.get($key))
                        .and_then(|b| b.as_bool())
                        .unwrap_or(false);
                if should_update {
                    conn.execute(
                        &format!("UPDATE contacts SET {} = ?1, updated_at = ?2 WHERE id = ?3", $col),
                        libsql::params![v.clone(), now, contact_id],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                }
            }
        };
    }

    merge_field!(parsed.phone, "phone", "phone");
    merge_field!(parsed.fax, "fax", "fax");
    merge_field!(parsed.email, "email", "email");
    merge_field!(parsed.website, "website", "website");
    merge_field!(parsed.street, "street", "street");
    merge_field!(parsed.city, "city", "city");
    merge_field!(parsed.state, "state", "state");
    merge_field!(parsed.zip, "zip", "zip");
    merge_field!(parsed.roles, "roles", "roles");
    merge_field!(parsed.commodities, "commodities", "commodities");
    merge_field!(parsed.notes, "notes", "notes");

    if let Some(ref p) = parsed.phone {
        let norm = normalize_phone(p);
        conn.execute(
            "UPDATE contacts SET phone_normalized=?1 WHERE id=?2",
            libsql::params![norm, contact_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn rollback_import(state: State<'_, AppState>, session_id: i64) -> Result<(), String> {
    let conn = state.conn()?;

    // Collect entries to rollback
    let mut rows = conn.query(
        "SELECT contact_id, action, previous_data
         FROM import_session_contacts WHERE session_id = ?1",
        libsql::params![session_id],
    )
    .await
    .map_err(|e| e.to_string())?;

    let mut entries: Vec<(i64, String, Option<String>)> = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        entries.push((
            row.get::<i64>(0).map_err(|e| e.to_string())?,
            row.get::<String>(1).map_err(|e| e.to_string())?,
            row.get::<Option<String>>(2).map_err(|e| e.to_string())?,
        ));
    }

    for (contact_id, action, prev_data) in entries {
        match action.as_str() {
            "added" => {
                let _ = conn.execute(
                    "DELETE FROM contacts WHERE id = ?1",
                    libsql::params![contact_id],
                )
                .await;
            }
            "merged" => {
                if let Some(json) = prev_data {
                    if let Ok(map) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&json) {
                        let get_str = |key: &str| -> Option<String> {
                            map.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
                        };
                        let _ = conn.execute(
                            "UPDATE contacts SET phone=?1, fax=?2, email=?3, website=?4, street=?5,
                                                city=?6, state=?7, zip=?8, roles=?9, commodities=?10,
                                                notes=?11, updated_at=?12
                             WHERE id=?13",
                            libsql::params![
                                get_str("phone"), get_str("fax"), get_str("email"),
                                get_str("website"), get_str("street"), get_str("city"),
                                get_str("state"), get_str("zip"), get_str("roles"),
                                get_str("commodities"), get_str("notes"),
                                chrono::Utc::now().timestamp(), contact_id,
                            ],
                        )
                        .await;
                    }
                }
            }
            _ => {}
        }
    }

    conn.execute(
        "UPDATE import_sessions SET status='rolled_back' WHERE id=?1",
        libsql::params![session_id],
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_import_sessions(state: State<'_, AppState>) -> Result<Vec<ImportSession>, String> {
    let conn = state.conn()?;
    let mut rows = conn.query(
        "SELECT id, source_type, source_name, started_at, completed_at,
                contacts_added, contacts_merged, contacts_discarded, status, notes
         FROM import_sessions ORDER BY started_at DESC LIMIT 100",
        libsql::params![],
    )
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        result.push(ImportSession {
            id:                 row.get::<i64>(0).map_err(|e| e.to_string())?,
            source_type:        row.get::<String>(1).map_err(|e| e.to_string())?,
            source_name:        row.get::<Option<String>>(2).map_err(|e| e.to_string())?,
            started_at:         row.get::<i64>(3).map_err(|e| e.to_string())?,
            completed_at:       row.get::<Option<i64>>(4).map_err(|e| e.to_string())?,
            contacts_added:     row.get::<i64>(5).map_err(|e| e.to_string())?,
            contacts_merged:    row.get::<i64>(6).map_err(|e| e.to_string())?,
            contacts_discarded: row.get::<i64>(7).map_err(|e| e.to_string())?,
            status:             row.get::<String>(8).map_err(|e| e.to_string())?,
            notes:              row.get::<Option<String>>(9).map_err(|e| e.to_string())?,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_mapping_templates(
    state: State<'_, AppState>,
) -> Result<Vec<MappingTemplate>, String> {
    let conn = state.conn()?;
    let mut rows = conn.query(
        "SELECT id, name, source_type, mapping_json, header_fingerprint,
                sample_headers, created_at, last_used_at
         FROM column_mapping_templates ORDER BY last_used_at DESC NULLS LAST, name",
        libsql::params![],
    )
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        let mapping_str = row.get::<String>(3).map_err(|e| e.to_string())?;
        let headers_str = row.get::<Option<String>>(5).map_err(|e| e.to_string())?;
        result.push(MappingTemplate {
            id:                  row.get::<i64>(0).map_err(|e| e.to_string())?,
            name:                row.get::<String>(1).map_err(|e| e.to_string())?,
            source_type:         row.get::<String>(2).map_err(|e| e.to_string())?,
            mapping_json:        serde_json::from_str(&mapping_str)
                                    .unwrap_or(serde_json::Value::Object(Default::default())),
            header_fingerprint:  row.get::<Option<String>>(4).map_err(|e| e.to_string())?,
            sample_headers:      headers_str
                                    .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok()),
            created_at:          row.get::<i64>(6).map_err(|e| e.to_string())?,
            last_used_at:        row.get::<Option<i64>>(7).map_err(|e| e.to_string())?,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn save_mapping_template(
    state: State<'_, AppState>,
    name: String,
    source_type: String,
    mapping: serde_json::Value,
    headers: Vec<String>,
) -> Result<MappingTemplate, String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();

    let mut sorted = headers.clone();
    sorted.sort();
    let fingerprint = format!("{:x}", Sha256::digest(sorted.join("|").as_bytes()));
    let mapping_str = serde_json::to_string(&mapping).map_err(|e| e.to_string())?;
    let headers_str = serde_json::to_string(&headers).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO column_mapping_templates
             (name, source_type, mapping_json, header_fingerprint, sample_headers, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(name) DO UPDATE SET
             mapping_json=excluded.mapping_json,
             header_fingerprint=excluded.header_fingerprint,
             sample_headers=excluded.sample_headers,
             updated_at=excluded.updated_at",
        libsql::params![name.clone(), source_type.clone(), mapping_str, fingerprint.clone(), headers_str, now],
    )
    .await
    .map_err(|e| e.to_string())?;

    let id = last_insert_rowid(&conn).await?;

    Ok(MappingTemplate {
        id,
        name,
        source_type,
        mapping_json: mapping,
        header_fingerprint: Some(fingerprint),
        sample_headers: Some(headers),
        created_at: now,
        last_used_at: None,
    })
}

#[tauri::command]
pub async fn delete_mapping_template(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "DELETE FROM column_mapping_templates WHERE id=?1",
        libsql::params![id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn find_matching_template(
    state: State<'_, AppState>,
    headers: Vec<String>,
) -> Result<Option<MappingTemplate>, String> {
    let mut sorted = headers.clone();
    sorted.sort();
    let fingerprint = format!("{:x}", Sha256::digest(sorted.join("|").as_bytes()));

    let conn = state.conn()?;
    let mut rows = conn.query(
        "SELECT id, name, source_type, mapping_json, header_fingerprint,
                sample_headers, created_at, last_used_at
         FROM column_mapping_templates WHERE header_fingerprint = ?1",
        libsql::params![fingerprint],
    )
    .await
    .map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        let mapping_str = row.get::<String>(3).map_err(|e| e.to_string())?;
        let headers_str = row.get::<Option<String>>(5).map_err(|e| e.to_string())?;
        Ok(Some(MappingTemplate {
            id:                 row.get::<i64>(0).map_err(|e| e.to_string())?,
            name:               row.get::<String>(1).map_err(|e| e.to_string())?,
            source_type:        row.get::<String>(2).map_err(|e| e.to_string())?,
            mapping_json:       serde_json::from_str(&mapping_str)
                                   .unwrap_or(serde_json::Value::Object(Default::default())),
            header_fingerprint: row.get::<Option<String>>(4).map_err(|e| e.to_string())?,
            sample_headers:     headers_str
                                   .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok()),
            created_at:         row.get::<i64>(6).map_err(|e| e.to_string())?,
            last_used_at:       row.get::<Option<i64>>(7).map_err(|e| e.to_string())?,
        }))
    } else {
        Ok(None)
    }
}
