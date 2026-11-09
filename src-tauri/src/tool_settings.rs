//! Per-tool settings: the user's enable switch, approval policy (MCP tools),
//! and usage counters for the Tool Explorer. Keys are native tool names or
//! `mcp:<server>:<tool>`.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use crate::mcp::config::ToolPolicy;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolSetting {
    pub key: String,
    pub enabled: bool,
    pub policy: Option<ToolPolicy>,
    pub run_count: i64,
    pub last_run_at: Option<i64>,
    pub last_outcome: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSettingInput {
    pub key: String,
    pub enabled: bool,
    pub policy: Option<ToolPolicy>,
}

fn validate_key(key: &str) -> AppResult<()> {
    let ok = !key.is_empty()
        && key.len() <= 200
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | ':' | '.' | '/'));
    if ok {
        Ok(())
    } else {
        Err(AppError::validation("Invalid tool key."))
    }
}

fn policy_str(p: Option<ToolPolicy>) -> Option<&'static str> {
    p.map(|p| match p {
        ToolPolicy::Ask => "ask",
        ToolPolicy::Allow => "allow",
        ToolPolicy::Deny => "deny",
    })
}

fn parse_policy(s: Option<String>) -> Option<ToolPolicy> {
    match s.as_deref() {
        Some("ask") => Some(ToolPolicy::Ask),
        Some("allow") => Some(ToolPolicy::Allow),
        Some("deny") => Some(ToolPolicy::Deny),
        _ => None,
    }
}

const COLUMNS: &str = "key, enabled, policy, run_count, last_run_at, last_outcome";

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ToolSetting> {
    Ok(ToolSetting {
        key: r.get(0)?,
        enabled: r.get::<_, i64>(1)? != 0,
        policy: parse_policy(r.get(2)?),
        run_count: r.get(3)?,
        last_run_at: r.get(4)?,
        last_outcome: r.get(5)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<ToolSetting>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM tool_settings ORDER BY key"))?;
    let rows = stmt.query_map([], row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, key: &str) -> AppResult<Option<ToolSetting>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM tool_settings WHERE key = ?1"),
            params![key],
            row,
        )
        .optional()?)
}

pub fn save(conn: &Connection, input: &ToolSettingInput) -> AppResult<ToolSetting> {
    validate_key(&input.key)?;
    conn.execute(
        "INSERT INTO tool_settings (key, enabled, policy) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, policy = excluded.policy",
        params![input.key, input.enabled as i64, policy_str(input.policy)],
    )?;
    get(conn, &input.key)?.ok_or_else(|| AppError::internal("The tool setting was not saved."))
}

pub fn record_run(conn: &Connection, key: &str, outcome: &str) -> AppResult<()> {
    validate_key(key)?;
    let outcome: String = outcome.chars().take(40).collect();
    conn.execute(
        "INSERT INTO tool_settings (key, run_count, last_run_at, last_outcome) VALUES (?1, 1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET run_count = run_count + 1, last_run_at = excluded.last_run_at,
         last_outcome = excluded.last_outcome",
        params![key, now_ms(), outcome],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn saves_settings_and_counts_runs() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        record_run(&conn, "mcp:github:list_issues", "succeeded").unwrap();
        record_run(&conn, "mcp:github:list_issues", "failed").unwrap();
        let s = save(
            &conn,
            &ToolSettingInput {
                key: "mcp:github:list_issues".into(),
                enabled: false,
                policy: Some(ToolPolicy::Allow),
            },
        )
        .unwrap();
        assert!(!s.enabled);
        assert_eq!(s.policy, Some(ToolPolicy::Allow));
        assert_eq!(s.run_count, 2, "saving a setting keeps the counters");
        assert_eq!(s.last_outcome.as_deref(), Some("failed"));
        assert_eq!(list(&conn).unwrap().len(), 1);
        assert!(save(
            &conn,
            &ToolSettingInput {
                key: "bad key!".into(),
                enabled: true,
                policy: None
            }
        )
        .is_err());
    }
}
