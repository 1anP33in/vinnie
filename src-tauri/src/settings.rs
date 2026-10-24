//! User-facing application settings.
//!
//! Settings are stored as one JSON document in the `settings` table. Every
//! field has a default, so older or partially corrupt documents still load.
//! The backend is the source of truth for validation; the frontend mirrors
//! these rules only to give instant feedback.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::db::kv;
use crate::error::{AppError, AppResult};
use crate::permissions::PermissionSettings;
use crate::workspace::ignore_rules::DEFAULT_IGNORED_DIRECTORIES;

const SETTINGS_KEY: &str = "app_settings";
pub const DEFAULT_ENDPOINT: &str = "http://localhost:11434";
pub const MAX_MODEL_NAME_CHARS: usize = 200;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum StartupBehavior {
    /// Start on the welcome screen.
    #[default]
    NewConversation,
    /// Reopen the conversation that was active when the app closed.
    RestoreLast,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub ollama_endpoint: String,
    pub default_model: Option<String>,
    pub theme: Theme,
    pub startup_behavior: StartupBehavior,
    /// Show the model's reasoning ("thinking") output when available.
    pub show_reasoning: bool,
    /// Disable glow/frost effects and animations.
    pub reduce_effects: bool,
    pub sidebar_collapsed: bool,
    /// What the assistant may do in the workspace (enforced in the backend).
    pub permissions: PermissionSettings,
    /// Folder names skipped by the explorer, search, and analysis.
    pub ignored_directories: Vec<String>,
    /// Let the model call workspace tools (search, read, edit, run).
    pub tools_enabled: bool,
    /// Attach a project summary and the active file to chat requests.
    pub project_context_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ollama_endpoint: DEFAULT_ENDPOINT.to_string(),
            default_model: None,
            theme: Theme::Dark,
            startup_behavior: StartupBehavior::NewConversation,
            show_reasoning: true,
            reduce_effects: false,
            sidebar_collapsed: false,
            permissions: PermissionSettings::default(),
            ignored_directories: DEFAULT_IGNORED_DIRECTORIES
                .iter()
                .map(|s| s.to_string())
                .collect(),
            tools_enabled: true,
            project_context_enabled: true,
        }
    }
}

/// Validate and normalize an Ollama endpoint. Returns the canonical string
/// form (no trailing slash).
pub fn normalize_endpoint(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("The Ollama endpoint cannot be empty."));
    }
    let url = Url::parse(trimmed).map_err(|_| {
        AppError::validation(
            "The Ollama endpoint must be a full URL, such as http://localhost:11434.",
        )
    })?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::validation(
            "The Ollama endpoint must start with http:// or https://.",
        ));
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err(AppError::validation(
            "The Ollama endpoint must include a host name.",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::validation(
            "The Ollama endpoint must not contain credentials.",
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(AppError::validation(
            "The Ollama endpoint must not contain a query string or fragment.",
        ));
    }
    let mut normalized = url.to_string();
    while normalized.ends_with('/') {
        normalized.pop();
    }
    Ok(normalized)
}

pub fn validate_model_name(raw: &str) -> AppResult<String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(AppError::validation("Choose a model."));
    }
    if name.chars().count() > MAX_MODEL_NAME_CHARS
        || name.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(AppError::validation("That model name is not valid."));
    }
    Ok(name.to_string())
}

impl Settings {
    /// Validate every field, returning a normalized copy.
    pub fn validated(&self) -> AppResult<Settings> {
        let default_model = match self.default_model.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(name) => Some(validate_model_name(name)?),
        };
        let mut ignored_directories = Vec::new();
        for raw in &self.ignored_directories {
            let name = raw.trim();
            if name.is_empty() {
                continue;
            }
            if name.len() > 100
                || name.contains(['/', '\\', ':', '*', '?'])
                || name == "."
                || name == ".."
            {
                return Err(AppError::validation(format!(
                    "\"{name}\" is not a valid folder name to ignore. Use plain names like node_modules."
                )));
            }
            if !ignored_directories
                .iter()
                .any(|d: &String| d.eq_ignore_ascii_case(name))
            {
                ignored_directories.push(name.to_string());
            }
        }
        if ignored_directories.len() > 100 {
            return Err(AppError::validation("Ignore at most 100 folder names."));
        }
        Ok(Settings {
            ignored_directories,
            ollama_endpoint: normalize_endpoint(&self.ollama_endpoint)?,
            default_model,
            ..self.clone()
        })
    }
}

/// Load settings, falling back to defaults when nothing is stored or the
/// stored document is unreadable.
pub fn load(conn: &Connection) -> AppResult<Settings> {
    let Some(raw) = kv::get(conn, SETTINGS_KEY)? else {
        return Ok(Settings::default());
    };
    let parsed: Settings = match serde_json::from_str(&raw) {
        Ok(settings) => settings,
        Err(err) => {
            log::warn!("stored settings are unreadable, using defaults: {err}");
            return Ok(Settings::default());
        }
    };
    Ok(parsed.validated().unwrap_or_else(|err| {
        log::warn!("stored settings are invalid, using defaults: {err}");
        Settings::default()
    }))
}

pub fn save(conn: &Connection, settings: &Settings) -> AppResult<Settings> {
    let validated = settings.validated()?;
    let json = serde_json::to_string(&validated)
        .map_err(|e| AppError::internal(format!("Could not serialize settings: {e}")))?;
    kv::set(conn, SETTINGS_KEY, &json)?;
    Ok(validated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::error::ErrorKind;

    #[test]
    fn endpoint_normalization() {
        assert_eq!(
            normalize_endpoint("http://localhost:11434/").unwrap(),
            "http://localhost:11434"
        );
        assert_eq!(
            normalize_endpoint("  https://example.com ").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            normalize_endpoint("http://192.168.1.5:11434/ollama/").unwrap(),
            "http://192.168.1.5:11434/ollama"
        );
    }

    #[test]
    fn endpoint_rejections() {
        for bad in [
            "",
            "localhost:11434",
            "ftp://localhost",
            "file:///etc/passwd",
            "http://user:pw@localhost:11434",
            "http://localhost:11434?x=1",
            "http://localhost:11434#frag",
            "not a url",
        ] {
            let err = normalize_endpoint(bad).unwrap_err();
            assert_eq!(err.kind, ErrorKind::Validation, "{bad} should be rejected");
        }
    }

    #[test]
    fn model_name_validation() {
        assert_eq!(validate_model_name(" qwen3:8b ").unwrap(), "qwen3:8b");
        assert!(validate_model_name("").is_err());
        assert!(validate_model_name("two words").is_err());
        assert!(validate_model_name(&"m".repeat(201)).is_err());
    }

    #[test]
    fn rejects_invalid_ignored_directories() {
        for bad in ["../x", "a/b", "C:", "*"] {
            let s = Settings {
                ignored_directories: vec![bad.into()],
                ..Settings::default()
            };
            assert!(s.validated().is_err(), "{bad}");
        }
    }

    #[test]
    fn defaults_when_missing_or_corrupt() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        assert_eq!(load(&conn).unwrap(), Settings::default());
        kv::set(&conn, SETTINGS_KEY, "{not json").unwrap();
        assert_eq!(load(&conn).unwrap(), Settings::default());
    }

    #[test]
    fn partial_documents_fill_in_defaults() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        kv::set(&conn, SETTINGS_KEY, r#"{"theme":"light"}"#).unwrap();
        let loaded = load(&conn).unwrap();
        assert_eq!(loaded.theme, Theme::Light);
        assert_eq!(loaded.ollama_endpoint, DEFAULT_ENDPOINT);
    }

    #[test]
    fn save_validates_and_round_trips() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        let settings = Settings {
            ollama_endpoint: "http://127.0.0.1:11434/".into(),
            default_model: Some("  ".into()),
            theme: Theme::System,
            startup_behavior: StartupBehavior::RestoreLast,
            show_reasoning: false,
            reduce_effects: true,
            sidebar_collapsed: true,
            permissions: PermissionSettings::default(),
            ignored_directories: vec![
                " node_modules ".into(),
                "NODE_MODULES".into(),
                "vendor".into(),
            ],
            tools_enabled: false,
            project_context_enabled: true,
        };
        let saved = save(&conn, &settings).unwrap();
        assert_eq!(saved.ollama_endpoint, "http://127.0.0.1:11434");
        assert_eq!(saved.default_model, None);
        assert_eq!(saved.ignored_directories, vec!["node_modules", "vendor"]);
        assert_eq!(load(&conn).unwrap(), saved);

        let bad = Settings {
            ollama_endpoint: "nope".into(),
            ..Settings::default()
        };
        assert!(save(&conn, &bad).is_err());
        assert_eq!(
            load(&conn).unwrap(),
            saved,
            "invalid save must not overwrite"
        );
    }
}
