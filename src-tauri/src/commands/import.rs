use crate::{AppState, ImportAction, ImportResult, ImportSession, MappingTemplate, ParsedContact};
use crate::commands::{conn_err, normalize_company, normalize_phone};
use rusqlite::params;
use sha2::{Digest, Sha256};
use tauri::State;

#[tauri::command]
pub fn create_import_session(
    state: State<'_, AppState>,
    source_type: String,
    source_name: Option<String>,
) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    conn.execute(
        "INSERT INTO import_sessions (source_type, source_name, status) VALUES (?1, ?2, 'pending')",
        params![source_type, source_name],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn commit_import(
    state: State<'_, AppState>,
    session_id: i64,
    rows: Vec<serde_json::Value>,
    actions: Vec<ImportAction>,
) -> Result<ImportResult, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    let now = chrono::Utc::now().timestamp();

    let mut added = 0i64;
    let mut merged = 0i64;
    let mut discarded = 0i64;

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

        match action.action.as_str() {
            "discard" => {
                conn.execute(
                    "INSERT INTO parsing_logs (session_id, row_index, raw_data, status)
                     VALUES (?1, ?2, ?3, 'discarded')",
                    params![session_id, action.row_index, row_val.to_string()],
                )
                .ok();
                discarded += 1;
            }
            "merge" => {
                if let Some(contact_id) = action.merge_contact_id {
                    // Snapshot existing for rollback
                    let prev = conn
                        .query_row(
                            "SELECT * FROM contacts WHERE id=?1",
                            params![contact_id],
                            |row| {
                                let count = row.as_ref().column_count();
                                let mut map = serde_json::Map::new();
                                for i in 0..count {
                                    let name = row.as_ref().column_name(i).unwrap_or("").to_string();
                                    let val: serde_json::Value = match row.get_ref(i) {
                                        Ok(rusqlite::types::ValueRef::Text(s)) => {
                                            serde_json::Value::String(String::from_utf8_lossy(s).to_string())
                                        }
                                        Ok(rusqlite::types::ValueRef::Integer(n)) => {
                                            serde_json::Value::Number(n.into())
                                        }
                                        _ => serde_json::Value::Null,
                                    };
                                    map.insert(name, val);
                                }
                                Ok(serde_json::Value::Object(map))
                            },
                        )
                        .ok();

                    conn.execute(
                        "INSERT INTO import_session_contacts (session_id, contact_id, action, previous_data)
                         VALUES (?1, ?2, 'merged', ?3)",
                        params![session_id, contact_id, prev.map(|v| v.to_string())],
                    )
                    .ok();

                    // Apply merge: update fields specified or use all parsed fields
                    apply_merge(conn, contact_id, &parsed, &action.merge_fields, now)
                        .map_err(|e| e.to_string())?;
                    merged += 1;
                }
            }
            "keep" | _ => {
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
                    params![
                        parsed.bbid, company, search,
                        parsed.phone, phone_norm, parsed.fax, parsed.email,
                        parsed.website, parsed.street, parsed.city, parsed.state,
                        parsed.zip, parsed.roles, parsed.commodities, parsed.notes, now,
                    ],
                )
                .map_err(|e| e.to_string())?;

                let contact_id = conn.last_insert_rowid();

                // Insert named contact person if present
                if let Some(ref name) = parsed.contact_name {
                    if !name.trim().is_empty() {
                        conn.execute(
                            "INSERT INTO contact_people (contact_id, name, title, phone, email, is_primary)
                             VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                            params![
                                contact_id, name, parsed.contact_title,
                                parsed.contact_phone, parsed.contact_email,
                            ],
                        )
                        .ok();
                    }
                }

                conn.execute(
                    "INSERT INTO import_session_contacts (session_id, contact_id, action)
                     VALUES (?1, ?2, 'added')",
                    params![session_id, contact_id],
                )
                .ok();

                conn.execute(
                    "INSERT INTO parsing_logs (session_id, row_index, raw_data, parsed_data, status)
                     VALUES (?1, ?2, ?3, ?4, 'kept')",
                    params![
                        session_id, action.row_index,
                        row_val.to_string(),
                        serde_json::to_string(&parsed).unwrap_or_default(),
                    ],
                )
                .ok();

                added += 1;
            }
        }
    }

    conn.execute(
        "UPDATE import_sessions SET status='completed', completed_at=?1,
         contacts_added=?2, contacts_merged=?3, contacts_discarded=?4
         WHERE id=?5",
        params![now, added, merged, discarded, session_id],
    )
    .map_err(|e| e.to_string())?;

    drop(db);
    state.touch_sync();

    Ok(ImportResult { session_id, added, merged, discarded })
}

fn apply_merge(
    conn: &rusqlite::Connection,
    contact_id: i64,
    parsed: &ParsedContact,
    merge_fields: &Option<serde_json::Value>,
    now: i64,
) -> rusqlite::Result<()> {
    // If merge_fields is specified, only update those fields. Otherwise merge all non-None fields.
    let use_all = merge_fields.is_none();

    macro_rules! merge_field {
        ($val:expr, $col:literal, $key:literal) => {
            if let Some(ref v) = $val {
                let should_update = use_all || merge_fields
                    .as_ref()
                    .and_then(|f| f.get($key))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if should_update {
                    conn.execute(
                        &format!("UPDATE contacts SET {} = ?1, updated_at = ?2 WHERE id = ?3", $col),
                        params![v, now, contact_id],
                    )?;
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
        conn.execute("UPDATE contacts SET phone_normalized=?1 WHERE id=?2", params![norm, contact_id])?;
    }

    Ok(())
}

#[tauri::command]
pub fn rollback_import(state: State<'_, AppState>, session_id: i64) -> Result<(), String> {
    // Scope all DB work so the MutexGuard is released before touch_sync re-acquires it
    (|| -> Result<(), String> {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.as_ref().ok_or_else(conn_err)?;

        let entries: Vec<(i64, String, Option<String>)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT contact_id, action, previous_data
                     FROM import_session_contacts WHERE session_id = ?1",
                )
                .map_err(|e| e.to_string())?;
            stmt.query_map(params![session_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map(|rows| rows.filter_map(|r| r.ok()).collect::<Vec<_>>())
            .map_err(|e| e.to_string())?
        }; // stmt dropped here

        for (contact_id, action, prev_data) in entries {
            match action.as_str() {
                "added" => {
                    conn.execute("DELETE FROM contacts WHERE id = ?1", params![contact_id]).ok();
                }
                "merged" => {
                    if let Some(json) = prev_data {
                        if let Ok(map) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&json) {
                            restore_contact_from_snapshot(conn, contact_id, &map).ok();
                        }
                    }
                }
                _ => {}
            }
        }

        conn.execute(
            "UPDATE import_sessions SET status='rolled_back' WHERE id=?1",
            params![session_id],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
        // db (MutexGuard) and conn released here
    })()?;

    state.touch_sync();
    Ok(())
}

fn restore_contact_from_snapshot(
    conn: &rusqlite::Connection,
    contact_id: i64,
    snap: &serde_json::Map<String, serde_json::Value>,
) -> rusqlite::Result<()> {
    let get_str = |key: &str| -> Option<String> {
        snap.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
    };
    let get_i64 = |key: &str| -> Option<i64> {
        snap.get(key).and_then(|v| v.as_i64())
    };

    conn.execute(
        "UPDATE contacts SET phone=?1, fax=?2, email=?3, website=?4, street=?5,
                            city=?6, state=?7, zip=?8, roles=?9, commodities=?10,
                            notes=?11, updated_at=?12
         WHERE id=?13",
        params![
            get_str("phone"), get_str("fax"), get_str("email"), get_str("website"),
            get_str("street"), get_str("city"), get_str("state"), get_str("zip"),
            get_str("roles"), get_str("commodities"), get_str("notes"),
            chrono::Utc::now().timestamp(), contact_id,
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_import_sessions(state: State<'_, AppState>) -> Result<Vec<ImportSession>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, source_type, source_name, started_at, completed_at,
                    contacts_added, contacts_merged, contacts_discarded, status, notes
             FROM import_sessions ORDER BY started_at DESC LIMIT 100",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_map([], |row| {
        Ok(ImportSession {
            id: row.get(0)?,
            source_type: row.get(1)?,
            source_name: row.get(2)?,
            started_at: row.get(3)?,
            completed_at: row.get(4)?,
            contacts_added: row.get(5)?,
            contacts_merged: row.get(6)?,
            contacts_discarded: row.get(7)?,
            status: row.get(8)?,
            notes: row.get(9)?,
        })
    })
    .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_mapping_templates(state: State<'_, AppState>) -> Result<Vec<MappingTemplate>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, source_type, mapping_json, header_fingerprint,
                    sample_headers, created_at, last_used_at
             FROM column_mapping_templates ORDER BY last_used_at DESC NULLS LAST, name",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_map([], |row| {
        let mapping_str: String = row.get(3)?;
        let headers_str: Option<String> = row.get(5)?;
        Ok(MappingTemplate {
            id: row.get(0)?,
            name: row.get(1)?,
            source_type: row.get(2)?,
            mapping_json: serde_json::from_str(&mapping_str)
                .unwrap_or(serde_json::Value::Object(Default::default())),
            header_fingerprint: row.get(4)?,
            sample_headers: headers_str
                .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok()),
            created_at: row.get(6)?,
            last_used_at: row.get(7)?,
        })
    })
    .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_mapping_template(
    state: State<'_, AppState>,
    name: String,
    source_type: String,
    mapping: serde_json::Value,
    headers: Vec<String>,
) -> Result<MappingTemplate, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
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
        params![name, source_type, mapping_str, fingerprint, headers_str, now],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    drop(db);
    state.touch_sync();

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
pub fn delete_mapping_template(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    conn.execute("DELETE FROM column_mapping_templates WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    drop(db);
    state.touch_sync();
    Ok(())
}

#[tauri::command]
pub fn find_matching_template(
    state: State<'_, AppState>,
    headers: Vec<String>,
) -> Result<Option<MappingTemplate>, String> {
    let mut sorted = headers.clone();
    sorted.sort();
    let fingerprint = format!("{:x}", Sha256::digest(sorted.join("|").as_bytes()));

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;

    let result = conn.query_row(
        "SELECT id, name, source_type, mapping_json, header_fingerprint,
                sample_headers, created_at, last_used_at
         FROM column_mapping_templates WHERE header_fingerprint = ?1",
        params![fingerprint],
        |row| {
            let mapping_str: String = row.get(3)?;
            let headers_str: Option<String> = row.get(5)?;
            Ok(MappingTemplate {
                id: row.get(0)?,
                name: row.get(1)?,
                source_type: row.get(2)?,
                mapping_json: serde_json::from_str(&mapping_str)
                    .unwrap_or(serde_json::Value::Object(Default::default())),
                header_fingerprint: row.get(4)?,
                sample_headers: headers_str
                    .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok()),
                created_at: row.get(6)?,
                last_used_at: row.get(7)?,
            })
        },
    );

    match result {
        Ok(t) => Ok(Some(t)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
