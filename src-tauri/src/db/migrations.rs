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
    // v2 (Phase 2): tool messages, change history, command approvals,
    // project metadata. SQLite cannot alter a CHECK constraint, so the
    // messages table is rebuilt.
    r#"
    CREATE TABLE messages_v2 (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
        content          TEXT NOT NULL,
        thinking         TEXT,
        status           TEXT NOT NULL DEFAULT 'complete'
                         CHECK (status IN ('complete', 'interrupted', 'error')),
        model            TEXT,
        error            TEXT,
        tool_calls       TEXT,
        tool_name        TEXT,
        created_at       INTEGER NOT NULL
    );
    INSERT INTO messages_v2 (id, conversation_id, role, content, thinking, status, model, error, created_at)
        SELECT id, conversation_id, role, content, thinking, status, model, error, created_at FROM messages;
    DROP TABLE messages;
    ALTER TABLE messages_v2 RENAME TO messages;
    CREATE INDEX idx_messages_conversation ON messages(conversation_id, id);

    CREATE TABLE changes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace       TEXT NOT NULL,
        task_id         TEXT,
        source          TEXT NOT NULL CHECK (source IN ('user', 'assistant')),
        kind            TEXT NOT NULL CHECK (kind IN ('create', 'modify', 'delete', 'move')),
        path            TEXT NOT NULL,
        new_path        TEXT,
        description     TEXT,
        before_content  BLOB,
        after_content   BLOB,
        before_hash     TEXT,
        after_hash      TEXT,
        additions       INTEGER NOT NULL DEFAULT 0,
        deletions       INTEGER NOT NULL DEFAULT 0,
        status          TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'reverted')),
        created_at      INTEGER NOT NULL,
        reverted_at     INTEGER
    );
    CREATE INDEX idx_changes_workspace ON changes(workspace, id DESC);
    CREATE INDEX idx_changes_task ON changes(workspace, task_id);

    CREATE TABLE command_allowlist (
        workspace   TEXT NOT NULL,
        command     TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (workspace, command)
    );

    CREATE TABLE project_metadata (
        workspace    TEXT PRIMARY KEY NOT NULL,
        data         TEXT NOT NULL,
        analyzed_at  INTEGER NOT NULL
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

    #[test]
    fn v2_preserves_existing_messages() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        conn.execute_batch(
            "INSERT INTO conversations VALUES ('c1', 'Old', NULL, 1, 1);
             INSERT INTO messages (conversation_id, role, content, status, created_at)
                VALUES ('c1', 'user', 'hello', 'complete', 1),
                       ('c1', 'assistant', 'hi', 'interrupted', 2);",
        )
        .unwrap();
        run(&mut conn).unwrap();
        let rows: Vec<(i64, String, String)> = conn
            .prepare("SELECT id, role, status FROM messages ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![
                (1, "user".into(), "complete".into()),
                (2, "assistant".into(), "interrupted".into())
            ]
        );
        conn.execute(
            "INSERT INTO messages (conversation_id, role, content, tool_name, created_at)
             VALUES ('c1', 'tool', '{}', 'read_file', 3)",
            [],
        )
        .unwrap();
    }
}
