//! Shared application state managed by Tauri.

use std::path::PathBuf;

use crate::db::Database;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::generation::GenerationRegistry;
use crate::settings::{self, Settings};
use crate::workspace::ignore_rules::IgnoreRules;
use crate::workspace::Workspace;

pub struct AppPaths {
    pub data_dir: PathBuf,
    pub database: PathBuf,
    pub log_dir: Option<PathBuf>,
}

pub struct AppState {
    pub db: Database,
    pub http: reqwest::Client,
    /// In-flight model generations.
    pub generations: GenerationRegistry,
    /// In-flight workspace searches.
    pub searches: GenerationRegistry,
    /// Running terminal commands.
    pub processes: GenerationRegistry,
    pub paths: AppPaths,
}

impl AppState {
    /// The selected project folder as a [`Workspace`], with current settings.
    pub fn workspace(&self) -> AppResult<(Workspace, Settings)> {
        let conn = self.db.conn()?;
        let settings = settings::load(&conn)?;
        let project = crate::project::load(&conn)?.ok_or_else(|| {
            AppError::new(
                ErrorKind::NoWorkspace,
                "Choose a project folder first (sidebar → Project).",
            )
        })?;
        drop(conn);
        let ws = Workspace::open(std::path::Path::new(&project.path))?;
        Ok((ws, settings))
    }
}

pub fn ignore_rules(settings: &Settings) -> IgnoreRules {
    IgnoreRules::new(&settings.ignored_directories)
}
