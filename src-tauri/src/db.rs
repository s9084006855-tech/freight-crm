pub async fn init_schema_async(conn: &libsql::Connection) -> Result<(), libsql::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL DEFAULT (unixepoch())
         );",
    ).await?;

    let current: i64 = {
        let mut rows = conn.query(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations", ()
        ).await?;
        rows.next().await?.and_then(|r| r.get::<i64>(0).ok()).unwrap_or(0)
    };

    if current < 1 {
        apply_v1(conn).await?;
        conn.execute("INSERT INTO schema_migrations (version) VALUES (1)", ()).await?;
    }

    if current < 2 {
        apply_v2(conn).await?;
        conn.execute("INSERT INTO schema_migrations (version) VALUES (2)", ()).await?;
    }

    Ok(())
}

async fn apply_v1(conn: &libsql::Connection) -> Result<(), libsql::Error> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS contacts (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            bbid                  TEXT UNIQUE,
            company_name          TEXT NOT NULL,
            company_name_search   TEXT NOT NULL,
            website               TEXT,
            phone                 TEXT,
            phone_normalized      TEXT,
            fax                   TEXT,
            email                 TEXT,
            street                TEXT,
            city                  TEXT,
            state                 TEXT,
            zip                   TEXT,
            country               TEXT DEFAULT 'USA',
            roles                 TEXT,
            commodities           TEXT,
            status                TEXT NOT NULL DEFAULT 'active',
            priority              INTEGER NOT NULL DEFAULT 0,
            source                TEXT NOT NULL DEFAULT 'manual',
            notes                 TEXT,
            created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at            INTEGER NOT NULL DEFAULT (unixepoch()),
            last_contacted_at     INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_c_search   ON contacts(company_name_search);
        CREATE INDEX IF NOT EXISTS idx_c_state    ON contacts(state);
        CREATE INDEX IF NOT EXISTS idx_c_status   ON contacts(status);
        CREATE INDEX IF NOT EXISTS idx_c_priority ON contacts(priority);
        CREATE INDEX IF NOT EXISTS idx_c_phone    ON contacts(phone_normalized);
        CREATE INDEX IF NOT EXISTS idx_c_touched  ON contacts(last_contacted_at);

        CREATE TABLE IF NOT EXISTS contact_people (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            contact_id   INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            name         TEXT NOT NULL,
            title        TEXT,
            phone        TEXT,
            mobile       TEXT,
            email        TEXT,
            is_primary   INTEGER NOT NULL DEFAULT 0,
            notes        TEXT,
            created_at   INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_ppl_contact ON contact_people(contact_id);

        CREATE TABLE IF NOT EXISTS activities (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            contact_id       INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            type             TEXT NOT NULL,
            outcome          TEXT,
            notes            TEXT,
            duration_sec     INTEGER,
            follow_up_at     INTEGER,
            follow_up_done   INTEGER NOT NULL DEFAULT 0,
            created_at       INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_act_contact  ON activities(contact_id);
        CREATE INDEX IF NOT EXISTS idx_act_type     ON activities(type);
        CREATE INDEX IF NOT EXISTS idx_act_created  ON activities(created_at);

        CREATE TABLE IF NOT EXISTS tags (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            name  TEXT UNIQUE NOT NULL,
            color TEXT NOT NULL DEFAULT '#6366f1'
        );
        CREATE TABLE IF NOT EXISTS contact_tags (
            contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            tag_id     INTEGER NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
            PRIMARY KEY (contact_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS import_sessions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            source_type         TEXT NOT NULL,
            source_name         TEXT,
            template_id         INTEGER,
            started_at          INTEGER NOT NULL DEFAULT (unixepoch()),
            completed_at        INTEGER,
            contacts_added      INTEGER NOT NULL DEFAULT 0,
            contacts_merged     INTEGER NOT NULL DEFAULT 0,
            contacts_discarded  INTEGER NOT NULL DEFAULT 0,
            status              TEXT NOT NULL DEFAULT 'pending',
            notes               TEXT
        );

        CREATE TABLE IF NOT EXISTS import_session_contacts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id      INTEGER NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
            contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            action          TEXT NOT NULL,
            previous_data   TEXT,
            created_at      INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS column_mapping_templates (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            name                 TEXT NOT NULL UNIQUE,
            source_type          TEXT NOT NULL,
            mapping_json         TEXT NOT NULL,
            header_fingerprint   TEXT,
            sample_headers       TEXT,
            created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at           INTEGER NOT NULL DEFAULT (unixepoch()),
            last_used_at         INTEGER
        );

        CREATE TABLE IF NOT EXISTS parsing_logs (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id   INTEGER NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
            row_index    INTEGER,
            raw_data     TEXT,
            parsed_data  TEXT,
            issues       TEXT,
            confidence   REAL,
            status       TEXT NOT NULL DEFAULT 'pending'
        );

        CREATE TABLE IF NOT EXISTS sync_metadata (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS error_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            level      TEXT NOT NULL,
            context    TEXT,
            message    TEXT NOT NULL,
            stack      TEXT,
            device_id  TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    ").await.map(|_| ())
}

async fn apply_v2(conn: &libsql::Connection) -> Result<(), libsql::Error> {
    // Ignore errors — columns may already exist
    let _ = conn.execute("ALTER TABLE activities ADD COLUMN user_id TEXT", ()).await;
    let _ = conn.execute("ALTER TABLE contacts ADD COLUMN enrichment_status TEXT", ()).await;
    let _ = conn.execute("ALTER TABLE contacts ADD COLUMN enrichment_data TEXT", ()).await;
    let _ = conn.execute("ALTER TABLE contacts ADD COLUMN enriched_at INTEGER", ()).await;
    Ok(())
}

pub fn normalize_company(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn normalize_phone(phone: &str) -> String {
    phone.chars().filter(|c| c.is_ascii_digit()).collect()
}

pub async fn last_insert_rowid(conn: &libsql::Connection) -> Result<i64, String> {
    let mut rows = conn.query("SELECT last_insert_rowid()", ())
        .await.map_err(|e| e.to_string())?;
    let row = rows.next().await.map_err(|e| e.to_string())?
        .ok_or("no rowid")?;
    row.get::<i64>(0).map_err(|e| e.to_string())
}
