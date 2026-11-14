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
    /// Agent runtime behavior and limits.
    pub agent: AgentSettings,
    /// Ice dragon companion viewer preferences.
    pub dragon: DragonSettings,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AgentMode {
    /// Read-only: inspect and explain, never modify.
    Ask,
    /// Propose every change; the user approves each one.
    Assist,
    /// Act autonomously within the permission settings.
    #[default]
    Agent,
}

/// Context window to request from the model. `0` means automatic.
pub const CONTEXT_BUDGETS: &[u32] = &[0, 4096, 8192, 16384, 32768];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentSettings {
    pub mode: AgentMode,
    pub max_iterations: u32,
    pub max_tool_calls: u32,
    pub max_retries: u32,
    pub command_timeout_secs: u32,
    pub task_timeout_mins: u32,
    pub max_changed_files: u32,
    /// Tokens; 0 = automatic (based on the model's context length).
    pub context_budget: u32,
    pub auto_verify: bool,
    /// Show the developer task debug view.
    pub debug_view: bool,
}

impl Default for AgentSettings {
    fn default() -> Self {
        Self {
            mode: AgentMode::Agent,
            max_iterations: 25,
            max_tool_calls: 60,
            max_retries: 2,
            command_timeout_secs: 600,
            task_timeout_mins: 30,
            max_changed_files: 20,
            context_budget: 0,
            auto_verify: true,
            debug_view: false,
        }
    }
}

impl AgentSettings {
    pub fn validated(&self) -> AppResult<AgentSettings> {
        let range = |name: &str, v: u32, min: u32, max: u32| {
            if (min..=max).contains(&v) {
                Ok(v)
            } else {
                Err(AppError::validation(format!(
                    "{name} must be between {min} and {max}."
                )))
            }
        };
        range("Maximum iterations", self.max_iterations, 1, 200)?;
        range("Maximum tool calls", self.max_tool_calls, 1, 500)?;
        range("Maximum retries", self.max_retries, 0, 10)?;
        range("Command timeout", self.command_timeout_secs, 5, 3600)?;
        range("Task timeout", self.task_timeout_mins, 1, 240)?;
        range("Maximum changed files", self.max_changed_files, 1, 500)?;
        if !CONTEXT_BUDGETS.contains(&self.context_budget) {
            return Err(AppError::validation(
                "Context budget must be Auto, 4096, 8192, 16384, or 32768.",
            ));
        }
        Ok(self.clone())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum DragonQuality {
    Low,
    #[default]
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum DragonLayout {
    /// Resizable panel beside the chat.
    #[default]
    Side,
    /// Short strip above the chat.
    Compact,
}

/// Saved camera orbit for the dragon viewer.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct DragonCamera {
    /// Horizontal angle around the dragon, degrees (0 = facing the dragon).
    pub azimuth_deg: i32,
    /// Vertical angle above the floor, degrees.
    pub elevation_deg: i32,
    /// Distance relative to the default framing, percent.
    pub distance_pct: u32,
}

impl Default for DragonCamera {
    fn default() -> Self {
        Self {
            azimuth_deg: 28,
            elevation_deg: 14,
            distance_pct: 100,
        }
    }
}

/// Ice dragon viewer preferences. These are cosmetic, so out-of-range values
/// are clamped instead of rejected and never block saving other settings.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct DragonSettings {
    /// Show the 3D dragon at all. Off: only the status-bar indicator remains.
    pub enabled: bool,
    /// The viewer panel is open (toggled from the toolbar).
    pub panel_open: bool,
    pub layout: DragonLayout,
    /// Panel size, percent of the workspace.
    pub panel_size: u32,
    pub quality: DragonQuality,
    pub snow: bool,
    pub ice_particles: bool,
    pub fog: bool,
    /// Glow, rim lights, reflections, and shadows.
    pub lighting_effects: bool,
    /// Animation speed, percent (25-200).
    pub animation_speed: u32,
    /// Idle behaviors (breathing, blinking, looking around) are playing.
    pub idle_animations: bool,
    /// The dragon glances toward the cursor while idle.
    pub follow_cursor: bool,
    pub camera: DragonCamera,
}

impl Default for DragonSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            panel_open: true,
            layout: DragonLayout::Side,
            panel_size: 30,
            quality: DragonQuality::Medium,
            snow: true,
            ice_particles: true,
            fog: true,
            lighting_effects: true,
            animation_speed: 100,
            idle_animations: true,
            follow_cursor: true,
            camera: DragonCamera::default(),
        }
    }
}

impl DragonSettings {
    pub fn normalized(&self) -> DragonSettings {
        DragonSettings {
            panel_size: self.panel_size.clamp(15, 60),
            animation_speed: self.animation_speed.clamp(25, 200),
            camera: DragonCamera {
                azimuth_deg: self.camera.azimuth_deg.clamp(-180, 180),
                elevation_deg: self.camera.elevation_deg.clamp(-5, 60),
                distance_pct: self.camera.distance_pct.clamp(50, 250),
            },
            ..*self
        }
    }
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
            agent: AgentSettings::default(),
            dragon: DragonSettings::default(),
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
            agent: self.agent.validated()?,
            dragon: self.dragon.normalized(),
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
    fn agent_defaults_and_validation() {
        let d = AgentSettings::default();
        assert_eq!(d.mode, AgentMode::Agent);
        assert_eq!((d.max_iterations, d.max_retries), (25, 2));
        assert!(d.auto_verify);
        for bad in [
            AgentSettings {
                max_iterations: 0,
                ..d.clone()
            },
            AgentSettings {
                max_retries: 50,
                ..d.clone()
            },
            AgentSettings {
                context_budget: 5000,
                ..d.clone()
            },
            AgentSettings {
                command_timeout_secs: 1,
                ..d.clone()
            },
        ] {
            assert!(bad.validated().is_err(), "{bad:?}");
        }
        // Older stored settings without an `agent` section get defaults.
        let parsed: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(parsed.agent, AgentSettings::default());
    }

    #[test]
    fn dragon_settings_default_and_clamp() {
        // Older stored settings without a `dragon` section get defaults.
        let parsed: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(parsed.dragon, DragonSettings::default());
        assert!(parsed.dragon.enabled);
        assert_eq!(parsed.dragon.quality, DragonQuality::Medium);

        let wild = Settings {
            dragon: DragonSettings {
                panel_size: 99,
                animation_speed: 1,
                camera: DragonCamera {
                    azimuth_deg: 900,
                    elevation_deg: -90,
                    distance_pct: 5,
                },
                ..DragonSettings::default()
            },
            ..Settings::default()
        };
        let d = wild.validated().expect("dragon values are clamped, not rejected").dragon;
        assert_eq!((d.panel_size, d.animation_speed), (60, 25));
        assert_eq!(
            (d.camera.azimuth_deg, d.camera.elevation_deg, d.camera.distance_pct),
            (180, -5, 50)
        );

        // Partial dragon documents fill in the rest.
        let partial: Settings =
            serde_json::from_str(r#"{"dragon":{"quality":"low","camera":{"azimuthDeg":10}}}"#)
                .unwrap();
        assert_eq!(partial.dragon.quality, DragonQuality::Low);
        assert_eq!(partial.dragon.camera.azimuth_deg, 10);
        assert_eq!(partial.dragon.camera.distance_pct, 100);
        assert!(partial.dragon.snow);
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
            agent: AgentSettings {
                mode: AgentMode::Assist,
                context_budget: 8192,
                ..AgentSettings::default()
            },
            dragon: DragonSettings {
                quality: DragonQuality::High,
                snow: false,
                ..DragonSettings::default()
            },
        };
        let saved = save(&conn, &settings).unwrap();
        assert_eq!(saved.agent.mode, AgentMode::Assist);
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
