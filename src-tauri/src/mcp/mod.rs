//! MCP backend: server configurations, secrets, and the transport halves the
//! frontend's official MCP SDK client runs on (stdio process relay and HTTP
//! fetch relay). The protocol itself is handled by the SDK in the frontend;
//! this module owns everything that touches the OS, the network, or secrets.

pub mod config;
pub mod http;
#[cfg(windows)]
mod job;
pub mod logs;
pub mod secrets;
pub mod stdio;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use rusqlite::Connection;

use self::config::{McpServerConfig, McpServerInput, TransportType};
use self::secrets::SecretStore;
use crate::error::{AppError, AppResult};

pub struct McpState {
    pub stdio: stdio::StdioServers,
    pub http: http::HttpRequests,
    pub logs: Arc<logs::McpLogs>,
    pub secrets: Box<dyn SecretStore>,
    pub client: reqwest::Client,
}

impl McpState {
    pub fn new(secrets: Box<dyn SecretStore>) -> AppResult<Self> {
        Ok(Self {
            stdio: Default::default(),
            http: Default::default(),
            logs: Default::default(),
            secrets,
            client: http::build_client()?,
        })
    }
}

/// Secret changes from the editor: a value sets the secret, `None` deletes it.
pub type SecretChanges = BTreeMap<String, Option<String>>;

/// Save a server and apply secret changes. Secret values go only to the
/// secret store; the database keeps their names.
pub fn save_server(
    conn: &Connection,
    store: &dyn SecretStore,
    input: &McpServerInput,
    changes: &SecretChanges,
    is_new: bool,
) -> AppResult<McpServerConfig> {
    config::validate(input)?;
    for (key, value) in changes {
        config::validate_secret_key(key)?;
        if let Some(v) = value {
            secrets::check_value(v)?;
        }
    }
    let mut keys: BTreeSet<String> = if is_new {
        BTreeSet::new()
    } else {
        config::get(conn, &input.id)?
            .secret_keys
            .into_iter()
            .collect()
    };
    // Save the configuration first, so a failure can't leave orphaned secrets
    // pointing at a server that doesn't exist.
    for (key, value) in changes {
        if value.is_some() {
            keys.insert(key.clone());
        } else {
            keys.remove(key);
        }
    }
    let key_list: Vec<String> = keys.into_iter().collect();
    let saved = config::save(conn, input, &key_list, is_new)?;
    for (key, value) in changes {
        let target = secrets::target(&input.id, key);
        match value {
            Some(v) => store.set(&target, v)?,
            None => store.delete(&target)?,
        }
    }
    log::info!(
        "mcp server {} saved ({} secret(s) changed)",
        input.id,
        changes.len()
    );
    Ok(saved)
}

/// Delete a server and its secrets.
pub fn delete_server(conn: &Connection, store: &dyn SecretStore, id: &str) -> AppResult<()> {
    if let Ok(existing) = config::get(conn, id) {
        for key in &existing.secret_keys {
            store.delete(&secrets::target(id, key))?;
        }
    }
    config::delete(conn, id)
}

/// A server's secrets, split by use, plus the raw values (for redaction).
#[derive(Default)]
pub struct ResolvedSecrets {
    pub env: BTreeMap<String, String>,
    pub headers: BTreeMap<String, String>,
    pub values: Vec<String>,
}

pub fn resolve_secrets(
    store: &dyn SecretStore,
    server: &McpServerConfig,
) -> AppResult<ResolvedSecrets> {
    let mut out = ResolvedSecrets::default();
    for key in &server.secret_keys {
        let Some(value) = store.get(&secrets::target(&server.input.id, key))? else {
            return Err(AppError::validation(format!(
                "The secret `{key}` for {} is missing. Edit the server and enter it again.",
                server.input.name
            )));
        };
        match key.split_once(':') {
            Some(("env", name)) => {
                out.env.insert(name.to_owned(), value.clone());
            }
            Some(("header", name)) => {
                out.headers.insert(name.to_owned(), value.clone());
            }
            _ => continue,
        }
        out.values.push(value);
    }
    Ok(out)
}

/// Load an enabled server for launching or requests.
pub fn enabled_server(
    conn: &Connection,
    id: &str,
    transport: TransportType,
) -> AppResult<McpServerConfig> {
    let server = config::get(conn, id)?;
    if !server.input.enabled {
        return Err(AppError::forbidden(format!(
            "{} is disabled.",
            server.input.name
        )));
    }
    if server.input.transport != transport {
        return Err(AppError::validation(
            "That server uses a different transport.",
        ));
    }
    Ok(server)
}

#[cfg(test)]
mod tests {
    use super::config::{ToolPolicy, TransportType};
    use super::secrets::MemoryStore;
    use super::*;
    use crate::db::Database;

    fn http_server(id: &str) -> McpServerInput {
        McpServerInput {
            id: id.into(),
            name: "GitHub".into(),
            description: String::new(),
            transport: TransportType::Http,
            command: None,
            args: vec![],
            env: BTreeMap::new(),
            cwd: None,
            url: Some("https://api.example.com/mcp".into()),
            headers: BTreeMap::new(),
            enabled: true,
            auto_connect: true,
            tool_timeout_secs: 60,
            default_policy: ToolPolicy::Ask,
        }
    }

    #[test]
    fn secrets_are_stored_separately_and_removed_with_the_server() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        let store = MemoryStore::default();
        let mut changes = SecretChanges::new();
        changes.insert(
            "header:Authorization".into(),
            Some("Bearer ghp_secret".into()),
        );
        let saved = save_server(&conn, &store, &http_server("github"), &changes, true).unwrap();
        assert_eq!(saved.secret_keys, vec!["header:Authorization".to_string()]);

        // The value is in the secret store, not in the database.
        let raw: String = conn
            .query_row(
                "SELECT data FROM mcp_servers WHERE id = 'github'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!raw.contains("ghp_secret"));
        let resolved = resolve_secrets(&store, &saved).unwrap();
        assert_eq!(
            resolved.headers.get("Authorization").map(String::as_str),
            Some("Bearer ghp_secret")
        );

        // Editing without changes keeps the secret; None deletes it.
        save_server(
            &conn,
            &store,
            &http_server("github"),
            &SecretChanges::new(),
            false,
        )
        .unwrap();
        assert!(store
            .get(&secrets::target("github", "header:Authorization"))
            .unwrap()
            .is_some());
        let mut delete = SecretChanges::new();
        delete.insert("header:Authorization".into(), None);
        let after = save_server(&conn, &store, &http_server("github"), &delete, false).unwrap();
        assert!(after.secret_keys.is_empty());
        assert!(store
            .get(&secrets::target("github", "header:Authorization"))
            .unwrap()
            .is_none());

        save_server(&conn, &store, &http_server("github"), &changes, false).unwrap();
        delete_server(&conn, &store, "github").unwrap();
        assert!(store
            .get(&secrets::target("github", "header:Authorization"))
            .unwrap()
            .is_none());
    }

    #[test]
    fn invalid_secret_names_and_disabled_servers_are_refused() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        let store = MemoryStore::default();
        let mut bad = SecretChanges::new();
        bad.insert("TOKEN".into(), Some("x".into()));
        assert!(save_server(&conn, &store, &http_server("github"), &bad, true).is_err());

        let mut disabled = http_server("github");
        disabled.enabled = false;
        save_server(&conn, &store, &disabled, &SecretChanges::new(), true).unwrap();
        assert!(enabled_server(&conn, "github", TransportType::Http).is_err());
    }

    #[test]
    fn missing_secrets_are_reported() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        let store = MemoryStore::default();
        let mut changes = SecretChanges::new();
        changes.insert("header:Authorization".into(), Some("Bearer x".into()));
        let saved = save_server(&conn, &store, &http_server("github"), &changes, true).unwrap();
        store
            .delete(&secrets::target("github", "header:Authorization"))
            .unwrap();
        let err = resolve_secrets(&store, &saved).err().unwrap();
        assert!(err.message.contains("missing"));
    }
}
