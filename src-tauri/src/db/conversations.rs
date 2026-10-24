//! Conversation and message repository.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use super::now_ms;
use crate::error::{AppError, AppResult};

pub const MAX_TITLE_CHARS: usize = 120;
pub const MAX_MESSAGE_BYTES: usize = 2 * 1024 * 1024;
const SEARCH_LIMIT: i64 = 200;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub model: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_count: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
    System,
}

impl Role {
    fn as_str(self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::System => "system",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "user" => Some(Role::User),
            "assistant" => Some(Role::Assistant),
            "system" => Some(Role::System),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum MessageStatus {
    #[default]
    Complete,
    /// Generation was stopped or cut off; content is partial.
    Interrupted,
    /// Generation failed; `error` describes why.
    Error,
}

impl MessageStatus {
    fn as_str(self) -> &'static str {
        match self {
            MessageStatus::Complete => "complete",
            MessageStatus::Interrupted => "interrupted",
            MessageStatus::Error => "error",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "complete" => Some(MessageStatus::Complete),
            "interrupted" => Some(MessageStatus::Interrupted),
            "error" => Some(MessageStatus::Error),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: i64,
    pub conversation_id: String,
    pub role: Role,
    pub content: String,
    pub thinking: Option<String>,
    pub status: MessageStatus,
    pub model: Option<String>,
    pub error: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMessage {
    pub conversation_id: String,
    pub role: Role,
    pub content: String,
    #[serde(default)]
    pub thinking: Option<String>,
    #[serde(default)]
    pub status: MessageStatus,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

/// Collapse whitespace and enforce length limits on a user-visible title.
pub fn sanitize_title(raw: &str) -> AppResult<String> {
    let collapsed = raw
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>();
    if collapsed.is_empty() {
        return Err(AppError::validation(
            "A conversation title cannot be empty.",
        ));
    }
    Ok(collapsed.chars().take(MAX_TITLE_CHARS).collect())
}

fn validate_id(id: &str) -> AppResult<()> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if ok {
        Ok(())
    } else {
        Err(AppError::validation("Invalid conversation id."))
    }
}

fn map_conversation(row: &Row<'_>) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: row.get("id")?,
        title: row.get("title")?,
        model: row.get("model")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        message_count: row.get("message_count")?,
    })
}

fn map_message(row: &Row<'_>) -> rusqlite::Result<Message> {
    let role: String = row.get("role")?;
    let status: String = row.get("status")?;
    Ok(Message {
        id: row.get("id")?,
        conversation_id: row.get("conversation_id")?,
        role: Role::parse(&role).unwrap_or(Role::User),
        content: row.get("content")?,
        thinking: row.get("thinking")?,
        status: MessageStatus::parse(&status).unwrap_or_default(),
        model: row.get("model")?,
        error: row.get("error")?,
        created_at: row.get("created_at")?,
    })
}

const CONVERSATION_COLUMNS: &str = "c.id, c.title, c.model, c.created_at, c.updated_at,
    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count";

pub fn create(conn: &Connection, title: &str, model: Option<&str>) -> AppResult<Conversation> {
    let title = sanitize_title(title)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    conn.execute(
        "INSERT INTO conversations (id, title, model, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, title, model, now],
    )?;
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Conversation> {
    validate_id(id)?;
    conn.query_row(
        &format!("SELECT {CONVERSATION_COLUMNS} FROM conversations c WHERE c.id = ?1"),
        params![id],
        map_conversation,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("That conversation no longer exists."))
}

pub fn exists(conn: &Connection, id: &str) -> AppResult<bool> {
    if validate_id(id).is_err() {
        return Ok(false);
    }
    Ok(conn
        .query_row(
            "SELECT 1 FROM conversations WHERE id = ?1",
            params![id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

/// All conversations, most recently updated first.
pub fn list(conn: &Connection) -> AppResult<Vec<Conversation>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {CONVERSATION_COLUMNS} FROM conversations c
         ORDER BY c.updated_at DESC, c.rowid DESC"
    ))?;
    let rows = stmt.query_map([], map_conversation)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn escape_like(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Case-insensitive (ASCII) search over titles and message content.
pub fn search(conn: &Connection, query: &str) -> AppResult<Vec<Conversation>> {
    let query = query.trim();
    if query.is_empty() {
        return list(conn);
    }
    if query.chars().count() > 200 {
        return Err(AppError::validation("Search text is too long."));
    }
    let pattern = format!("%{}%", escape_like(query));
    let mut stmt = conn.prepare(&format!(
        "SELECT {CONVERSATION_COLUMNS} FROM conversations c
         WHERE c.title LIKE ?1 ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM messages m
                       WHERE m.conversation_id = c.id AND m.content LIKE ?1 ESCAPE '\\')
         ORDER BY c.updated_at DESC, c.rowid DESC
         LIMIT ?2"
    ))?;
    let rows = stmt.query_map(params![pattern, SEARCH_LIMIT], map_conversation)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn rename(conn: &Connection, id: &str, title: &str) -> AppResult<Conversation> {
    validate_id(id)?;
    let title = sanitize_title(title)?;
    let changed = conn.execute(
        "UPDATE conversations SET title = ?2, updated_at = MAX(updated_at, ?3) WHERE id = ?1",
        params![id, title, now_ms()],
    )?;
    if changed == 0 {
        return Err(AppError::not_found("That conversation no longer exists."));
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    validate_id(id)?;
    let changed = conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::not_found("That conversation no longer exists."));
    }
    Ok(())
}

pub fn delete_all(conn: &Connection) -> AppResult<usize> {
    Ok(conn.execute("DELETE FROM conversations", [])?)
}

/// Messages in chronological (insertion) order.
pub fn list_messages(conn: &Connection, conversation_id: &str) -> AppResult<Vec<Message>> {
    validate_id(conversation_id)?;
    if !exists(conn, conversation_id)? {
        return Err(AppError::not_found("That conversation no longer exists."));
    }
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, role, content, thinking, status, model, error, created_at
         FROM messages WHERE conversation_id = ?1 ORDER BY id ASC",
    )?;
    let rows = stmt.query_map(params![conversation_id], map_message)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Append a message and bump the conversation timestamp atomically.
pub fn add_message(conn: &mut Connection, new: &NewMessage) -> AppResult<Message> {
    validate_id(&new.conversation_id)?;
    if new.content.len() > MAX_MESSAGE_BYTES
        || new
            .thinking
            .as_ref()
            .is_some_and(|t| t.len() > MAX_MESSAGE_BYTES)
    {
        return Err(AppError::validation("The message is too large to save."));
    }
    if new.role == Role::User && new.content.trim().is_empty() {
        return Err(AppError::validation("A message cannot be empty."));
    }

    let tx = conn.transaction()?;
    let exists: bool = tx
        .query_row(
            "SELECT 1 FROM conversations WHERE id = ?1",
            params![new.conversation_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !exists {
        return Err(AppError::not_found("That conversation no longer exists."));
    }

    let now = now_ms();
    tx.execute(
        "INSERT INTO messages (conversation_id, role, content, thinking, status, model, error, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            new.conversation_id,
            new.role.as_str(),
            new.content,
            new.thinking.as_deref().filter(|t| !t.is_empty()),
            new.status.as_str(),
            new.model,
            new.error,
            now
        ],
    )?;
    let id = tx.last_insert_rowid();
    tx.execute(
        "UPDATE conversations
         SET updated_at = MAX(updated_at, ?2), model = COALESCE(?3, model)
         WHERE id = ?1",
        params![new.conversation_id, now, new.model],
    )?;
    let message = tx.query_row(
        "SELECT id, conversation_id, role, content, thinking, status, model, error, created_at
         FROM messages WHERE id = ?1",
        params![id],
        map_message,
    )?;
    tx.commit()?;
    Ok(message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::error::ErrorKind;

    fn user(conversation_id: &str, content: &str) -> NewMessage {
        NewMessage {
            conversation_id: conversation_id.into(),
            role: Role::User,
            content: content.into(),
            thinking: None,
            status: MessageStatus::Complete,
            model: None,
            error: None,
        }
    }

    #[test]
    fn create_and_get_conversation() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        let created = create(&conn, "  Hello\n  world  ", Some("llama3")).unwrap();
        assert_eq!(created.title, "Hello world");
        assert_eq!(created.model.as_deref(), Some("llama3"));
        assert_eq!(created.message_count, 0);
        assert_eq!(get(&conn, &created.id).unwrap(), created);
    }

    #[test]
    fn empty_title_is_rejected() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        let err = create(&conn, "   ", None).unwrap_err();
        assert_eq!(err.kind, ErrorKind::Validation);
    }

    #[test]
    fn long_titles_are_truncated() {
        let long = "x".repeat(500);
        assert_eq!(
            sanitize_title(&long).unwrap().chars().count(),
            MAX_TITLE_CHARS
        );
    }

    #[test]
    fn messages_are_returned_in_chronological_order() {
        let db = Database::open_in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        let c = create(&conn, "Order", None).unwrap();
        for i in 0..20 {
            let mut m = user(&c.id, &format!("message {i}"));
            if i % 2 == 1 {
                m.role = Role::Assistant;
            }
            add_message(&mut conn, &m).unwrap();
        }
        let messages = list_messages(&conn, &c.id).unwrap();
        let contents: Vec<_> = messages.iter().map(|m| m.content.clone()).collect();
        let expected: Vec<_> = (0..20).map(|i| format!("message {i}")).collect();
        assert_eq!(contents, expected);
        assert!(messages.windows(2).all(|w| w[0].id < w[1].id));
        assert_eq!(get(&conn, &c.id).unwrap().message_count, 20);
    }

    #[test]
    fn adding_a_message_bumps_updated_at_and_list_order() {
        let db = Database::open_in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        let first = create(&conn, "First", None).unwrap();
        let second = create(&conn, "Second", None).unwrap();
        // Force deterministic timestamps.
        conn.execute("UPDATE conversations SET updated_at = 1", [])
            .unwrap();
        add_message(&mut conn, &user(&first.id, "bump")).unwrap();
        let ids: Vec<_> = list(&conn).unwrap().into_iter().map(|c| c.id).collect();
        assert_eq!(ids, vec![first.id.clone(), second.id]);
        assert!(get(&conn, &first.id).unwrap().updated_at > 1);
    }

    #[test]
    fn assistant_message_records_model_status_and_thinking() {
        let db = Database::open_in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        let c = create(&conn, "Status", None).unwrap();
        let saved = add_message(
            &mut conn,
            &NewMessage {
                conversation_id: c.id.clone(),
                role: Role::Assistant,
                content: "partial".into(),
                thinking: Some("hmm".into()),
                status: MessageStatus::Interrupted,
                model: Some("qwen3:8b".into()),
                error: None,
            },
        )
        .unwrap();
        assert_eq!(saved.status, MessageStatus::Interrupted);
        assert_eq!(saved.thinking.as_deref(), Some("hmm"));
        assert_eq!(
            get(&conn, &c.id).unwrap().model.as_deref(),
            Some("qwen3:8b")
        );
    }

    #[test]
    fn adding_to_missing_conversation_fails_without_writing() {
        let db = Database::open_in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        let err = add_message(&mut conn, &user("does-not-exist", "hi")).unwrap_err();
        assert_eq!(err.kind, ErrorKind::NotFound);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn empty_user_message_is_rejected() {
        let db = Database::open_in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        let c = create(&conn, "x", None).unwrap();
        let err = add_message(&mut conn, &user(&c.id, "  \n ")).unwrap_err();
        assert_eq!(err.kind, ErrorKind::Validation);
    }

    #[test]
    fn rename_and_delete_cascade() {
        let db = Database::open_in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        let c = create(&conn, "Old", None).unwrap();
        add_message(&mut conn, &user(&c.id, "hi")).unwrap();
        assert_eq!(rename(&conn, &c.id, "New").unwrap().title, "New");
        delete(&conn, &c.id).unwrap();
        assert_eq!(get(&conn, &c.id).unwrap_err().kind, ErrorKind::NotFound);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "messages should cascade-delete");
        assert_eq!(delete(&conn, &c.id).unwrap_err().kind, ErrorKind::NotFound);
    }

    #[test]
    fn search_matches_titles_and_content_and_escapes_wildcards() {
        let db = Database::open_in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        let a = create(&conn, "Rust lifetimes", None).unwrap();
        let b = create(&conn, "Groceries", None).unwrap();
        add_message(&mut conn, &user(&b.id, "buy 100% juice")).unwrap();
        create(&conn, "Other", None).unwrap();

        let ids = |q: &str| -> Vec<String> {
            search(&conn, q)
                .unwrap()
                .into_iter()
                .map(|c| c.id)
                .collect()
        };
        assert_eq!(ids("rust"), vec![a.id.clone()]);
        assert_eq!(ids("JUICE"), vec![b.id.clone()]);
        assert_eq!(ids("100%"), vec![b.id.clone()]);
        assert!(ids("%%%").is_empty(), "wildcards must be escaped");
        assert_eq!(ids("  ").len(), 3, "blank search lists everything");
    }

    #[test]
    fn invalid_ids_are_rejected() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        assert_eq!(
            get(&conn, "x' OR 1=1 --").unwrap_err().kind,
            ErrorKind::Validation
        );
    }

    #[test]
    fn data_persists_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vinnie.db");
        let id = {
            let db = Database::open(&path).unwrap();
            let mut conn = db.conn().unwrap();
            let c = create(&conn, "Persisted", None).unwrap();
            add_message(&mut conn, &user(&c.id, "remember me")).unwrap();
            c.id
        };
        let db = Database::open(&path).unwrap();
        let conn = db.conn().unwrap();
        let conversations = list(&conn).unwrap();
        assert_eq!(conversations.len(), 1);
        assert_eq!(conversations[0].id, id);
        assert_eq!(list_messages(&conn, &id).unwrap()[0].content, "remember me");
    }
}
