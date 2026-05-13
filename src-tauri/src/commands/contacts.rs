use crate::{AppState, ContactDetail, ContactFilter, ContactPerson, ContactSummary, CreateContactData, UpdateContactData};
use crate::commands::{conn_err, normalize_company, normalize_phone};
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn get_contacts(
    state: State<'_, AppState>,
    filter: ContactFilter,
) -> Result<Vec<ContactSummary>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;

    let search_pat = filter.search.as_ref().map(|s| format!("%{}%", s.to_lowercase()));
    let role_pat = filter.role.as_ref().map(|r| format!("%{}%", r));

    let sort_col = match filter.sort_by.as_deref() {
        Some("last_contacted") => "c.last_contacted_at",
        Some("state") => "c.state",
        Some("priority") => "c.priority DESC, c.company_name_search",
        _ => "c.company_name_search",
    };
    let dir = if filter.sort_desc.unwrap_or(false) { "DESC" } else { "ASC" };

    let sql = format!(
        "SELECT c.id, c.company_name, c.phone, c.email, c.city, c.state,
                c.roles, c.status, c.priority, c.last_contacted_at,
                EXISTS(
                    SELECT 1 FROM activities a
                    WHERE a.contact_id = c.id
                      AND a.follow_up_done = 0
                      AND a.follow_up_at IS NOT NULL
                ) AS has_follow_up
         FROM contacts c
         WHERE c.status != 'deleted'
         {search}
         {state_f}
         {status_f}
         {priority_f}
         {role_f}
         ORDER BY {sort} {dir}
         LIMIT ? OFFSET ?",
        search = if search_pat.is_some() {
            "AND (c.company_name_search LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)"
        } else {
            ""
        },
        state_f = if filter.state.is_some() { "AND c.state = ?" } else { "" },
        status_f = if filter.status.is_some() { "AND c.status = ?" } else { "" },
        priority_f = if filter.priority.is_some() { "AND c.priority = ?" } else { "" },
        role_f = if role_pat.is_some() { "AND c.roles LIKE ?" } else { "" },
        sort = sort_col,
        dir = dir,
    );

    let limit = filter.limit.unwrap_or(200);
    let offset = filter.offset.unwrap_or(0);

    let mut params_dyn: Vec<Box<dyn rusqlite::types::ToSql>> = vec![];
    if let Some(ref p) = search_pat {
        params_dyn.push(Box::new(p.clone()));
        params_dyn.push(Box::new(p.clone()));
        params_dyn.push(Box::new(p.clone()));
    }
    if let Some(ref s) = filter.state { params_dyn.push(Box::new(s.clone())); }
    if let Some(ref s) = filter.status { params_dyn.push(Box::new(s.clone())); }
    if let Some(p) = filter.priority { params_dyn.push(Box::new(p)); }
    if let Some(ref r) = role_pat { params_dyn.push(Box::new(r.clone())); }
    params_dyn.push(Box::new(limit));
    params_dyn.push(Box::new(offset));

    let params_slice: Vec<&dyn rusqlite::types::ToSql> =
        params_dyn.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_slice.as_slice(), |row| {
            Ok(ContactSummary {
                id: row.get(0)?,
                company_name: row.get(1)?,
                phone: row.get(2)?,
                email: row.get(3)?,
                city: row.get(4)?,
                state: row.get(5)?,
                roles: row.get(6)?,
                status: row.get(7)?,
                priority: row.get(8)?,
                last_contacted_at: row.get(9)?,
                has_follow_up: row.get::<_, i32>(10)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_contact(
    state: State<'_, AppState>,
    id: i64,
) -> Result<ContactDetail, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;

    let detail = conn
        .query_row(
            "SELECT id, bbid, company_name, phone, fax, email, website, street, city, state,
                    zip, country, roles, commodities, status, priority, source, notes,
                    created_at, updated_at, last_contacted_at
             FROM contacts WHERE id = ?1",
            params![id],
            |row| {
                Ok(ContactDetail {
                    id: row.get(0)?,
                    bbid: row.get(1)?,
                    company_name: row.get(2)?,
                    phone: row.get(3)?,
                    fax: row.get(4)?,
                    email: row.get(5)?,
                    website: row.get(6)?,
                    street: row.get(7)?,
                    city: row.get(8)?,
                    state: row.get(9)?,
                    zip: row.get(10)?,
                    country: row.get(11)?,
                    roles: row.get(12)?,
                    commodities: row.get(13)?,
                    status: row.get(14)?,
                    priority: row.get(15)?,
                    source: row.get(16)?,
                    notes: row.get(17)?,
                    created_at: row.get(18)?,
                    updated_at: row.get(19)?,
                    last_contacted_at: row.get(20)?,
                    people: vec![],
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, contact_id, name, title, phone, mobile, email, is_primary, notes
             FROM contact_people WHERE contact_id = ?1 ORDER BY is_primary DESC, name",
        )
        .map_err(|e| e.to_string())?;

    let people: Vec<ContactPerson> = stmt
        .query_map(params![id], |row| {
            Ok(ContactPerson {
                id: row.get(0)?,
                contact_id: row.get(1)?,
                name: row.get(2)?,
                title: row.get(3)?,
                phone: row.get(4)?,
                mobile: row.get(5)?,
                email: row.get(6)?,
                is_primary: row.get::<_, i32>(7)? != 0,
                notes: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(ContactDetail { people, ..detail })
}

#[tauri::command]
pub fn create_contact(
    state: State<'_, AppState>,
    data: CreateContactData,
) -> Result<ContactSummary, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;

    let search = normalize_company(&data.company_name);
    let phone_norm = data.phone.as_deref().map(normalize_phone);
    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO contacts (bbid, company_name, company_name_search, phone, phone_normalized,
                               fax, email, website, street, city, state, zip, country,
                               roles, commodities, status, priority, source, notes,
                               created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?20)",
        params![
            data.bbid,
            data.company_name,
            search,
            data.phone,
            phone_norm,
            data.fax,
            data.email,
            data.website,
            data.street,
            data.city,
            data.state,
            data.zip,
            data.country.as_deref().unwrap_or("USA"),
            data.roles,
            data.commodities,
            data.status.as_deref().unwrap_or("active"),
            data.priority.unwrap_or(0),
            data.source.as_deref().unwrap_or("manual"),
            data.notes,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    drop(db);
    state.touch_sync();

    let db2 = state.db.lock().map_err(|e| e.to_string())?;
    let conn2 = db2.as_ref().ok_or_else(conn_err)?;
    conn2.query_row(
        "SELECT id, company_name, phone, email, city, state, roles, status, priority,
                last_contacted_at,
                EXISTS(SELECT 1 FROM activities a WHERE a.contact_id = id AND a.follow_up_done=0 AND a.follow_up_at IS NOT NULL)
         FROM contacts WHERE id = ?1",
        params![id],
        |row| Ok(ContactSummary {
            id: row.get(0)?,
            company_name: row.get(1)?,
            phone: row.get(2)?,
            email: row.get(3)?,
            city: row.get(4)?,
            state: row.get(5)?,
            roles: row.get(6)?,
            status: row.get(7)?,
            priority: row.get(8)?,
            last_contacted_at: row.get(9)?,
            has_follow_up: row.get::<_, i32>(10)? != 0,
        }),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_contact(
    state: State<'_, AppState>,
    id: i64,
    data: UpdateContactData,
) -> Result<ContactSummary, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    let now = chrono::Utc::now().timestamp();

    if let Some(ref name) = data.company_name {
        let search = normalize_company(name);
        conn.execute(
            "UPDATE contacts SET company_name=?1, company_name_search=?2, updated_at=?3 WHERE id=?4",
            params![name, search, now, id],
        ).map_err(|e| e.to_string())?;
    }

    macro_rules! update_field {
        ($field:expr, $col:literal) => {
            if let Some(ref v) = $field {
                conn.execute(
                    &format!("UPDATE contacts SET {} = ?1, updated_at = ?2 WHERE id = ?3", $col),
                    params![v, now, id],
                ).map_err(|e| e.to_string())?;
            }
        };
    }

    update_field!(data.phone, "phone");
    if let Some(ref p) = data.phone {
        let norm = normalize_phone(p);
        conn.execute("UPDATE contacts SET phone_normalized=?1, updated_at=?2 WHERE id=?3",
            params![norm, now, id]).map_err(|e| e.to_string())?;
    }
    update_field!(data.fax, "fax");
    update_field!(data.email, "email");
    update_field!(data.website, "website");
    update_field!(data.street, "street");
    update_field!(data.city, "city");
    update_field!(data.state, "state");
    update_field!(data.zip, "zip");
    update_field!(data.roles, "roles");
    update_field!(data.commodities, "commodities");
    update_field!(data.status, "status");
    update_field!(data.notes, "notes");
    if let Some(p) = data.priority {
        conn.execute("UPDATE contacts SET priority=?1, updated_at=?2 WHERE id=?3",
            params![p, now, id]).map_err(|e| e.to_string())?;
    }

    drop(db);
    state.touch_sync();

    let db2 = state.db.lock().map_err(|e| e.to_string())?;
    let conn2 = db2.as_ref().ok_or_else(conn_err)?;
    conn2.query_row(
        "SELECT id, company_name, phone, email, city, state, roles, status, priority,
                last_contacted_at,
                EXISTS(SELECT 1 FROM activities a WHERE a.contact_id=id AND a.follow_up_done=0 AND a.follow_up_at IS NOT NULL)
         FROM contacts WHERE id=?1",
        params![id],
        |row| Ok(ContactSummary {
            id: row.get(0)?, company_name: row.get(1)?, phone: row.get(2)?,
            email: row.get(3)?, city: row.get(4)?, state: row.get(5)?,
            roles: row.get(6)?, status: row.get(7)?, priority: row.get(8)?,
            last_contacted_at: row.get(9)?,
            has_follow_up: row.get::<_, i32>(10)? != 0,
        }),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_contact(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or_else(conn_err)?;
    conn.execute("DELETE FROM contacts WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    drop(db);
    state.touch_sync();
    Ok(())
}

#[tauri::command]
pub fn search_contacts(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<ContactSummary>, String> {
    get_contacts(
        state,
        ContactFilter {
            search: Some(query),
            state: None, status: Some("active".into()),
            priority: None, role: None,
            limit, offset: None,
            sort_by: Some("name".into()), sort_desc: None,
        },
    )
}
