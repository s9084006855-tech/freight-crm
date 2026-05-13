use rusqlite::{Connection, Result, params};
use std::fs;
use std::path::Path;

pub const SCHEMA_VERSION: i64 = 1;

pub fn open_and_init(path: &str) -> Result<Connection> {
    if let Some(parent) = Path::new(path).parent() {
        fs::create_dir_all(parent).ok();
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         PRAGMA synchronous=NORMAL;
         PRAGMA busy_timeout=5000;",
    )?;
    init_schema(&conn)?;
    Ok(conn)
}

pub fn touch_sync_metadata(conn: &Connection, device_id: &str, device_name: &str) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    for (key, value) in [
        ("last_device_id", device_id.to_string()),
        ("last_device_name", device_name.to_string()),
        ("last_write_time", now.to_string()),
    ] {
        conn.execute(
            "INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![key, value, now],
        )?;
    }
    Ok(())
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL DEFAULT (unixepoch())
         );",
    )?;

    let current: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if current < 1 {
        apply_v1(conn)?;
        conn.execute(
            "INSERT INTO schema_migrations (version) VALUES (1)",
            [],
        )?;
    }

    // Write schema version to sync_metadata
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) VALUES ('schema_version', ?1, ?2)",
        params![SCHEMA_VERSION.to_string(), now],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) VALUES ('app_version', ?1, ?2)",
        params![env!("CARGO_PKG_VERSION"), now],
    )?;

    Ok(())
}

fn apply_v1(conn: &Connection) -> Result<()> {
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
        CREATE INDEX IF NOT EXISTS idx_act_followup ON activities(follow_up_at)
            WHERE follow_up_done = 0 AND follow_up_at IS NOT NULL;

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
            template_id         INTEGER REFERENCES column_mapping_templates(id),
            started_at          INTEGER NOT NULL DEFAULT (unixepoch()),
            completed_at        INTEGER,
            contacts_added      INTEGER NOT NULL DEFAULT 0,
            contacts_merged     INTEGER NOT NULL DEFAULT 0,
            contacts_discarded  INTEGER NOT NULL DEFAULT 0,
            status              TEXT NOT NULL DEFAULT 'pending',
            notes               TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_is_status  ON import_sessions(status);
        CREATE INDEX IF NOT EXISTS idx_is_started ON import_sessions(started_at);

        CREATE TABLE IF NOT EXISTS import_session_contacts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id      INTEGER NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
            contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            action          TEXT NOT NULL,
            previous_data   TEXT,
            created_at      INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_isc_session ON import_session_contacts(session_id);
        CREATE INDEX IF NOT EXISTS idx_isc_contact ON import_session_contacts(contact_id);

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
        CREATE INDEX IF NOT EXISTS idx_pl_session ON parsing_logs(session_id);

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
    ")
}
