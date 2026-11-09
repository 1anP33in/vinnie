//! Per-server log ring buffers (process lifecycle and stderr, secrets already
//! redacted). Shown in the MCP manager's server details.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use serde::Serialize;

use crate::db::now_ms;

const MAX_ENTRIES: usize = 500;
const MAX_MESSAGE: usize = 2_000;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LogEntry {
    pub at: i64,
    pub level: &'static str,
    pub message: String,
}

#[derive(Default)]
pub struct McpLogs {
    entries: Mutex<HashMap<String, VecDeque<LogEntry>>>,
}

impl McpLogs {
    pub fn push(&self, server: &str, level: &'static str, message: String) {
        let message: String = message.chars().take(MAX_MESSAGE).collect();
        if let Ok(mut map) = self.entries.lock() {
            let log = map.entry(server.to_owned()).or_default();
            if log.len() >= MAX_ENTRIES {
                log.pop_front();
            }
            log.push_back(LogEntry {
                at: now_ms(),
                level,
                message,
            });
        }
    }

    pub fn get(&self, server: &str) -> Vec<LogEntry> {
        self.entries
            .lock()
            .map(|m| {
                m.get(server)
                    .map(|l| l.iter().cloned().collect())
                    .unwrap_or_default()
            })
            .unwrap_or_default()
    }

    pub fn clear(&self, server: &str) {
        if let Ok(mut map) = self.entries.lock() {
            map.remove(server);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_newest_entries() {
        let logs = McpLogs::default();
        for i in 0..MAX_ENTRIES + 10 {
            logs.push("s", "info", format!("line {i}"));
        }
        let got = logs.get("s");
        assert_eq!(got.len(), MAX_ENTRIES);
        assert_eq!(
            got.last().unwrap().message,
            format!("line {}", MAX_ENTRIES + 9)
        );
        logs.push("s", "info", "x".repeat(MAX_MESSAGE * 2));
        assert_eq!(logs.get("s").last().unwrap().message.len(), MAX_MESSAGE);
        logs.clear("s");
        assert!(logs.get("s").is_empty());
    }
}
