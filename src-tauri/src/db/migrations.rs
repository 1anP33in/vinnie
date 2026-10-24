//! Forward-only schema migrations tracked with `PRAGMA user_version`.

use rusqlite::Connection;

use crate::error::AppResult;

/// Each entry upgrades the schema by one version. Never edit a released
/// migration; append a new one instead.
const MIGRATIONS: &[&str] = &[
    // v1: conversations, messages, settings
    r#"
    CREATE TABLE conversations (
        id          TEXT PRIMARY KEY NOT NULL,
        title       TEXT NOT NULL,
        model       TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
    );
    CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);

    CREATE TABLE messages (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content          TEXT NOT NULL,
        thinking         TEXT,
        status           TEXT NOT NULL DEFAULT 'complete'
                         CHECK (status IN ('complete', 'interrupted', 'error')),
        model            TEXT,
        error            TEXT,
        created_at       INTEGER NOT NULL
    );
    CREATE INDEX idx_messages_conversation ON messages(conversation_id, id);

    CREATE TABLE settings (
        key    TEXT PRIMARY KEY NOT NULL,
        value  TEXT NOT NULL
    );
    "#,
];

pub fn run(conn: &mut Connection) -> AppResult<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let current = usize::try_from(current).unwrap_or(0);

    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let version = index + 1;
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version as i64)?;
        tx.commit()?;
        log::info!("database migrated to schema v{version}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();
        run(&mut conn).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version as usize, MIGRATIONS.len());
    }
}
