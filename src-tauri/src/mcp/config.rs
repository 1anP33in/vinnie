//! MCP server configurations: validation and storage.
//!
//! Configurations hold no secret values, only the names of secrets kept in
//! Windows Credential Manager (`env:NAME`, `header:NAME`). The backend reads
//! a server's command and URL from here; the frontend can only name a server.

use std::collections::BTreeMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::now_ms;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransportType {
    Stdio,
    Http,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ToolPolicy {
    Ask,
    Allow,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInput {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub transport: TransportType,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub cwd: Option<String>,
    pub url: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    pub enabled: bool,
    pub auto_connect: bool,
    pub tool_timeout_secs: u32,
    pub default_policy: ToolPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    #[serde(flatten)]
    pub input: McpServerInput,
    pub secret_keys: Vec<String>,
    pub last_connected_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// What is stored in the `data` column.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    #[serde(flatten)]
    input: McpServerInput,
    #[serde(default)]
    secret_keys: Vec<String>,
}

const RESERVED_HEADERS: &[&str] = &[
    "host",
    "content-length",
    "content-type",
    "accept",
    "mcp-session-id",
    "mcp-protocol-version",
    "connection",
    "transfer-encoding",
];

fn is_server_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 24
        && bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'_')
        && !id.contains("__")
        && !id.ends_with('_')
}

pub fn is_env_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && (bytes[0].is_ascii_alphabetic() || bytes[0] == b'_')
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'_')
}

pub fn is_header_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+.^_`|~-".contains(&b))
}

/// A secret key: `env:NAME` for stdio servers, `header:Name` for HTTP servers.
pub fn validate_secret_key(key: &str) -> AppResult<()> {
    let ok = match key.split_once(':') {
        Some(("env", name)) => is_env_name(name),
        Some(("header", name)) => {
            is_header_name(name) && !RESERVED_HEADERS.contains(&name.to_ascii_lowercase().as_str())
        }
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(AppError::validation(format!(
            "Invalid secret name `{key}`. Use env:NAME or header:Name."
        )))
    }
}

fn is_local_host(host: &str) -> bool {
    matches!(
        host.to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "[::1]" | "::1"
    )
}

/// Remote servers must use HTTPS; plain HTTP only on this computer. No
/// credentials in the URL.
pub fn validate_url(raw: &str) -> AppResult<url::Url> {
    let url = url::Url::parse(raw)
        .map_err(|_| AppError::validation("Enter a full URL, e.g. https://example.com/mcp."))?;
    match url.scheme() {
        "https" => {}
        "http" if url.host_str().is_some_and(is_local_host) => {}
        "http" => {
            return Err(AppError::validation(
                "Remote servers must use https://. Plain http is allowed only for localhost.",
            ))
        }
        _ => {
            return Err(AppError::validation(
                "Only http and https URLs are supported.",
            ))
        }
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::validation(
            "Don't put credentials in the URL. Add them as a secret header instead.",
        ));
    }
    Ok(url)
}

pub fn validate(input: &McpServerInput) -> AppResult<()> {
    if !is_server_id(&input.id) {
        return Err(AppError::validation(
            "Server IDs use lowercase letters, digits, and single underscores, start with a letter, and have at most 24 characters.",
        ));
    }
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err(AppError::validation(
            "Server names have 1 to 60 characters.",
        ));
    }
    if input.description.chars().count() > 300 {
        return Err(AppError::validation(
            "Descriptions have at most 300 characters.",
        ));
    }
    if !(5..=600).contains(&input.tool_timeout_secs) {
        return Err(AppError::validation(
            "Tool timeouts are between 5 and 600 seconds.",
        ));
    }
    if input.args.len() > 64
        || input
            .args
            .iter()
            .any(|a| a.len() > 1_000 || a.contains('\0'))
    {
        return Err(AppError::validation(
            "At most 64 arguments of up to 1000 characters.",
        ));
    }
    if input.env.len() > 50
        || input
            .env
            .iter()
            .any(|(k, v)| !is_env_name(k) || v.len() > 4_000 || v.contains('\0'))
    {
        return Err(AppError::validation("Invalid environment variable."));
    }
    if input.headers.len() > 30
        || input.headers.iter().any(|(k, v)| {
            !is_header_name(k)
                || RESERVED_HEADERS.contains(&k.to_ascii_lowercase().as_str())
                || v.len() > 4_000
                || v.contains(['\r', '\n', '\0'])
        })
    {
        return Err(AppError::validation("Invalid or reserved header."));
    }
    match input.transport {
        TransportType::Stdio => {
            let command = input.command.as_deref().map(str::trim).unwrap_or("");
            if command.is_empty() || command.len() > 260 {
                return Err(AppError::validation("Enter the program to run, e.g. npx."));
            }
            // A program name or path only: never shell syntax.
            if command.contains([
                '|', '&', ';', '<', '>', '^', '%', '`', '$', '\r', '\n', '\0',
            ]) {
                return Err(AppError::validation(
                    "Enter only the program name or path; put arguments in Arguments.",
                ));
            }
            if let Some(cwd) = &input.cwd {
                if cwd.len() > 260 || cwd.contains('\0') {
                    return Err(AppError::validation("Invalid working directory."));
                }
            }
        }
        TransportType::Http => {
            validate_url(input.url.as_deref().unwrap_or(""))?;
        }
    }
    Ok(())
}

fn row_to_config(
    data: String,
    last_connected_at: Option<i64>,
    created_at: i64,
    updated_at: i64,
) -> AppResult<McpServerConfig> {
    let stored: Stored = serde_json::from_str(&data)
        .map_err(|e| AppError::internal(format!("A stored MCP server is unreadable: {e}")))?;
    Ok(McpServerConfig {
        input: stored.input,
        secret_keys: stored.secret_keys,
        last_connected_at,
        created_at,
        updated_at,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<McpServerConfig>> {
    let mut stmt = conn.prepare(
        "SELECT data, last_connected_at, created_at, updated_at FROM mcp_servers ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
    let mut out = Vec::new();
    for row in rows {
        let (data, last, created, updated) = row?;
        match row_to_config(data, last, created, updated) {
            Ok(c) => out.push(c),
            Err(e) => log::warn!("skipping unreadable MCP server: {e}"),
        }
    }
    Ok(out)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<McpServerConfig> {
    let row: Option<(String, Option<i64>, i64, i64)> = conn
        .query_row(
            "SELECT data, last_connected_at, created_at, updated_at FROM mcp_servers WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let (data, last, created, updated) =
        row.ok_or_else(|| AppError::not_found("That MCP server no longer exists."))?;
    row_to_config(data, last, created, updated)
}

/// Insert (`is_new`) or update a server. `secret_keys` is the full new list.
pub fn save(
    conn: &Connection,
    input: &McpServerInput,
    secret_keys: &[String],
    is_new: bool,
) -> AppResult<McpServerConfig> {
    validate(input)?;
    let mut input = input.clone();
    input.name = input.name.trim().to_owned();
    input.command = input.command.map(|c| c.trim().to_owned());
    let data = serde_json::to_string(&Stored {
        input: input.clone(),
        secret_keys: secret_keys.to_vec(),
    })
    .map_err(|e| AppError::internal(e.to_string()))?;
    let now = now_ms();
    if is_new {
        let inserted = conn.execute(
            "INSERT OR IGNORE INTO mcp_servers (id, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![input.id, data, now],
        )?;
        if inserted == 0 {
            return Err(AppError::conflict(format!(
                "A server with the ID `{}` already exists.",
                input.id
            )));
        }
    } else {
        let updated = conn.execute(
            "UPDATE mcp_servers SET data = ?2, updated_at = ?3 WHERE id = ?1",
            params![input.id, data, now],
        )?;
        if updated == 0 {
            return Err(AppError::not_found("That MCP server no longer exists."));
        }
    }
    get(conn, &input.id)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM mcp_servers WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn mark_connected(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE mcp_servers SET last_connected_at = ?2 WHERE id = ?1",
        params![id, now_ms()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn stdio(id: &str) -> McpServerInput {
        McpServerInput {
            id: id.into(),
            name: "Files".into(),
            description: String::new(),
            transport: TransportType::Stdio,
            command: Some("npx".into()),
            args: vec![
                "-y".into(),
                "@modelcontextprotocol/server-filesystem".into(),
            ],
            env: BTreeMap::new(),
            cwd: None,
            url: None,
            headers: BTreeMap::new(),
            enabled: true,
            auto_connect: true,
            tool_timeout_secs: 60,
            default_policy: ToolPolicy::Ask,
        }
    }

    #[test]
    fn validates_ids_commands_and_urls() {
        assert!(validate(&stdio("files")).is_ok());
        for bad in [
            "",
            "Files",
            "1files",
            "a__b",
            "files_",
            "x".repeat(25).as_str(),
        ] {
            assert!(validate(&stdio(bad)).is_err(), "{bad} should be rejected");
        }
        let mut s = stdio("files");
        s.command = Some("npx & del /q *".into());
        assert!(validate(&s).is_err());
        s.command = Some("  ".into());
        assert!(validate(&s).is_err());

        let mut h = stdio("gh");
        h.transport = TransportType::Http;
        h.url = Some("http://example.com/mcp".into());
        assert!(validate(&h).is_err(), "remote http is rejected");
        h.url = Some("http://localhost:3001/mcp".into());
        assert!(validate(&h).is_ok());
        h.url = Some("https://user:pw@example.com/mcp".into());
        assert!(validate(&h).is_err(), "credentials in URLs are rejected");
        h.url = Some("https://example.com/mcp".into());
        h.headers.insert("Host".into(), "evil".into());
        assert!(validate(&h).is_err(), "reserved headers are rejected");
    }

    #[test]
    fn validates_secret_keys() {
        assert!(validate_secret_key("env:GITHUB_TOKEN").is_ok());
        assert!(validate_secret_key("header:Authorization").is_ok());
        assert!(validate_secret_key("header:Host").is_err());
        assert!(validate_secret_key("GITHUB_TOKEN").is_err());
        assert!(validate_secret_key("env:BAD NAME").is_err());
    }

    #[test]
    fn stores_and_updates_servers_without_secret_values() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        let saved = save(&conn, &stdio("files"), &["env:TOKEN".into()], true).unwrap();
        assert_eq!(saved.secret_keys, vec!["env:TOKEN".to_string()]);
        assert!(
            save(&conn, &stdio("files"), &[], true).is_err(),
            "duplicate ids conflict"
        );
        let mut changed = stdio("files");
        changed.name = "Filesystem".into();
        save(&conn, &changed, &[], false).unwrap();
        let all = list(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].input.name, "Filesystem");
        assert!(all[0].secret_keys.is_empty());
        assert!(
            save(&conn, &stdio("ghost"), &[], false).is_err(),
            "updates need an existing server"
        );
        mark_connected(&conn, "files").unwrap();
        assert!(get(&conn, "files").unwrap().last_connected_at.is_some());
        delete(&conn, "files").unwrap();
        assert!(get(&conn, "files").is_err());
    }
}
