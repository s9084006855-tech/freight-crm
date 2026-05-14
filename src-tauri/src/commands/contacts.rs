use crate::{AppState, ContactDetail, ContactFilter, ContactPerson, ContactSummary, CreateContactData, UpdateContactData};
use crate::db::{normalize_company, normalize_phone, last_insert_rowid};
use libsql::Value;
use tauri::State;

#[tauri::command]
pub async fn get_contacts(
    state: State<'_, AppState>,
    filter: ContactFilter,
) -> Result<Vec<ContactSummary>, String> {
    let conn = state.conn()?;

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
        } else { "" },
        state_f  = if filter.state.is_some()    { "AND c.state = ?"    } else { "" },
        status_f = if filter.status.is_some()   { "AND c.status = ?"   } else { "" },
        priority_f = if filter.priority.is_some() { "AND c.priority = ?" } else { "" },
        role_f   = if role_pat.is_some()        { "AND c.roles LIKE ?" } else { "" },
        sort = sort_col,
        dir  = dir,
    );

    let limit  = filter.limit.unwrap_or(200) as i64;
    let offset = filter.offset.unwrap_or(0)  as i64;

    let mut params: Vec<Value> = vec![];
    if let Some(ref p) = search_pat {
        params.push(Value::Text(p.clone()));
        params.push(Value::Text(p.clone()));
        params.push(Value::Text(p.clone()));
    }
    if let Some(ref s) = filter.state    { params.push(Value::Text(s.clone())); }
    if let Some(ref s) = filter.status   { params.push(Value::Text(s.clone())); }
    if let Some(p)     = filter.priority { params.push(Value::Integer(p as i64)); }
    if let Some(ref r) = role_pat        { params.push(Value::Text(r.clone())); }
    params.push(Value::Integer(limit));
    params.push(Value::Integer(offset));

    let mut rows = conn.query(&sql, params).await.map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        result.push(ContactSummary {
            id:               row.get::<i64>(0).map_err(|e| e.to_string())?,
            company_name:     row.get::<String>(1).map_err(|e| e.to_string())?,
            phone:            row.get::<Option<String>>(2).map_err(|e| e.to_string())?,
            email:            row.get::<Option<String>>(3).map_err(|e| e.to_string())?,
            city:             row.get::<Option<String>>(4).map_err(|e| e.to_string())?,
            state:            row.get::<Option<String>>(5).map_err(|e| e.to_string())?,
            roles:            row.get::<Option<String>>(6).map_err(|e| e.to_string())?,
            status:           row.get::<String>(7).map_err(|e| e.to_string())?,
            priority:         row.get::<i64>(8).map_err(|e| e.to_string())? as i32,
            last_contacted_at: row.get::<Option<i64>>(9).map_err(|e| e.to_string())?,
            has_follow_up:    row.get::<i64>(10).map_err(|e| e.to_string())? != 0,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_contact(state: State<'_, AppState>, id: i64) -> Result<ContactDetail, String> {
    let conn = state.conn()?;

    let mut rows = conn.query(
        "SELECT id, bbid, company_name, phone, fax, email, website, street, city, state,
                zip, country, roles, commodities, status, priority, source, notes,
                created_at, updated_at, last_contacted_at
         FROM contacts WHERE id = ?1",
        libsql::params![id],
    ).await.map_err(|e| e.to_string())?;

    let row = rows.next().await.map_err(|e| e.to_string())?.ok_or("Contact not found")?;
    let mut detail = ContactDetail {
        id:               row.get::<i64>(0).map_err(|e| e.to_string())?,
        bbid:             row.get::<Option<String>>(1).map_err(|e| e.to_string())?,
        company_name:     row.get::<String>(2).map_err(|e| e.to_string())?,
        phone:            row.get::<Option<String>>(3).map_err(|e| e.to_string())?,
        fax:              row.get::<Option<String>>(4).map_err(|e| e.to_string())?,
        email:            row.get::<Option<String>>(5).map_err(|e| e.to_string())?,
        website:          row.get::<Option<String>>(6).map_err(|e| e.to_string())?,
        street:           row.get::<Option<String>>(7).map_err(|e| e.to_string())?,
        city:             row.get::<Option<String>>(8).map_err(|e| e.to_string())?,
        state:            row.get::<Option<String>>(9).map_err(|e| e.to_string())?,
        zip:              row.get::<Option<String>>(10).map_err(|e| e.to_string())?,
        country:          row.get::<Option<String>>(11).map_err(|e| e.to_string())?,
        roles:            row.get::<Option<String>>(12).map_err(|e| e.to_string())?,
        commodities:      row.get::<Option<String>>(13).map_err(|e| e.to_string())?,
        status:           row.get::<String>(14).map_err(|e| e.to_string())?,
        priority:         row.get::<i64>(15).map_err(|e| e.to_string())? as i32,
        source:           row.get::<Option<String>>(16).map_err(|e| e.to_string())?.unwrap_or_default(),
        notes:            row.get::<Option<String>>(17).map_err(|e| e.to_string())?,
        created_at:       row.get::<i64>(18).map_err(|e| e.to_string())?,
        updated_at:       row.get::<i64>(19).map_err(|e| e.to_string())?,
        last_contacted_at: row.get::<Option<i64>>(20).map_err(|e| e.to_string())?,
        people: vec![],
    };

    let mut prows = conn.query(
        "SELECT id, contact_id, name, title, phone, mobile, email, is_primary, notes
         FROM contact_people WHERE contact_id = ?1 ORDER BY is_primary DESC, name",
        libsql::params![id],
    ).await.map_err(|e| e.to_string())?;

    while let Some(pr) = prows.next().await.map_err(|e| e.to_string())? {
        detail.people.push(ContactPerson {
            id:         pr.get::<i64>(0).map_err(|e| e.to_string())?,
            contact_id: pr.get::<i64>(1).map_err(|e| e.to_string())?,
            name:       pr.get::<String>(2).map_err(|e| e.to_string())?,
            title:      pr.get::<Option<String>>(3).map_err(|e| e.to_string())?,
            phone:      pr.get::<Option<String>>(4).map_err(|e| e.to_string())?,
            mobile:     pr.get::<Option<String>>(5).map_err(|e| e.to_string())?,
            email:      pr.get::<Option<String>>(6).map_err(|e| e.to_string())?,
            is_primary: pr.get::<i64>(7).map_err(|e| e.to_string())? != 0,
            notes:      pr.get::<Option<String>>(8).map_err(|e| e.to_string())?,
        });
    }
    Ok(detail)
}

#[tauri::command]
pub async fn create_contact(
    state: State<'_, AppState>,
    data: CreateContactData,
) -> Result<ContactSummary, String> {
    let conn = state.conn()?;
    let search = normalize_company(&data.company_name);
    let phone_norm = data.phone.as_deref().map(normalize_phone);
    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO contacts (bbid, company_name, company_name_search, phone, phone_normalized,
                               fax, email, website, street, city, state, zip, country,
                               roles, commodities, status, priority, source, notes,
                               created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?20)",
        libsql::params![
            data.bbid, data.company_name, search, data.phone, phone_norm,
            data.fax, data.email, data.website, data.street, data.city,
            data.state, data.zip,
            data.country.as_deref().unwrap_or("USA"),
            data.roles, data.commodities,
            data.status.as_deref().unwrap_or("active"),
            data.priority.unwrap_or(0),
            data.source.as_deref().unwrap_or("manual"),
            data.notes, now,
        ],
    ).await.map_err(|e| e.to_string())?;

    let id = last_insert_rowid(&conn).await?;
    fetch_summary(&conn, id).await
}

#[tauri::command]
pub async fn update_contact(
    state: State<'_, AppState>,
    id: i64,
    data: UpdateContactData,
) -> Result<ContactSummary, String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();

    if let Some(ref name) = data.company_name {
        let search = normalize_company(name);
        conn.execute(
            "UPDATE contacts SET company_name=?1, company_name_search=?2, updated_at=?3 WHERE id=?4",
            libsql::params![name.clone(), search, now, id],
        ).await.map_err(|e| e.to_string())?;
    }

    macro_rules! upd {
        ($field:expr, $col:literal, $val:expr) => {
            if $field.is_some() {
                conn.execute(
                    &format!("UPDATE contacts SET {} = ?1, updated_at = ?2 WHERE id = ?3", $col),
                    libsql::params![$val, now, id],
                ).await.map_err(|e| e.to_string())?;
            }
        };
    }

    if let Some(ref p) = data.phone {
        let norm = normalize_phone(p);
        conn.execute(
            "UPDATE contacts SET phone=?1, phone_normalized=?2, updated_at=?3 WHERE id=?4",
            libsql::params![p.clone(), norm, now, id],
        ).await.map_err(|e| e.to_string())?;
    }
    upd!(data.fax,         "fax",         data.fax.as_deref().unwrap_or(""));
    upd!(data.email,       "email",       data.email.as_deref().unwrap_or(""));
    upd!(data.website,     "website",     data.website.as_deref().unwrap_or(""));
    upd!(data.street,      "street",      data.street.as_deref().unwrap_or(""));
    upd!(data.city,        "city",        data.city.as_deref().unwrap_or(""));
    upd!(data.state,       "state",       data.state.as_deref().unwrap_or(""));
    upd!(data.zip,         "zip",         data.zip.as_deref().unwrap_or(""));
    upd!(data.roles,       "roles",       data.roles.as_deref().unwrap_or(""));
    upd!(data.commodities, "commodities", data.commodities.as_deref().unwrap_or(""));
    upd!(data.status,      "status",      data.status.as_deref().unwrap_or(""));
    upd!(data.notes,       "notes",       data.notes.as_deref().unwrap_or(""));
    if let Some(p) = data.priority {
        conn.execute(
            "UPDATE contacts SET priority=?1, updated_at=?2 WHERE id=?3",
            libsql::params![p, now, id],
        ).await.map_err(|e| e.to_string())?;
    }

    fetch_summary(&conn, id).await
}

#[tauri::command]
pub async fn delete_contact(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute("DELETE FROM contacts WHERE id = ?1", libsql::params![id])
        .await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn search_contacts(
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
            limit: limit.map(|l| l as i64), offset: None,
            sort_by: Some("name".into()), sort_desc: None,
        },
    ).await
}

async fn fetch_summary(conn: &libsql::Connection, id: i64) -> Result<ContactSummary, String> {
    let mut rows = conn.query(
        "SELECT id, company_name, phone, email, city, state, roles, status, priority,
                last_contacted_at,
                EXISTS(SELECT 1 FROM activities a WHERE a.contact_id=id AND a.follow_up_done=0 AND a.follow_up_at IS NOT NULL)
         FROM contacts WHERE id = ?1",
        libsql::params![id],
    ).await.map_err(|e| e.to_string())?;
    let row = rows.next().await.map_err(|e| e.to_string())?.ok_or("Contact not found")?;
    Ok(ContactSummary {
        id:               row.get::<i64>(0).map_err(|e| e.to_string())?,
        company_name:     row.get::<String>(1).map_err(|e| e.to_string())?,
        phone:            row.get::<Option<String>>(2).map_err(|e| e.to_string())?,
        email:            row.get::<Option<String>>(3).map_err(|e| e.to_string())?,
        city:             row.get::<Option<String>>(4).map_err(|e| e.to_string())?,
        state:            row.get::<Option<String>>(5).map_err(|e| e.to_string())?,
        roles:            row.get::<Option<String>>(6).map_err(|e| e.to_string())?,
        status:           row.get::<String>(7).map_err(|e| e.to_string())?,
        priority:         row.get::<i64>(8).map_err(|e| e.to_string())? as i32,
        last_contacted_at: row.get::<Option<i64>>(9).map_err(|e| e.to_string())?,
        has_follow_up:    row.get::<i64>(10).map_err(|e| e.to_string())? != 0,
    })
}
