//! Shared application state managed by Tauri.

use std::path::PathBuf;

use crate::db::Database;
use crate::generation::GenerationRegistry;

pub struct AppPaths {
    pub data_dir: PathBuf,
    pub database: PathBuf,
    pub log_dir: Option<PathBuf>,
}

pub struct AppState {
    pub db: Database,
    pub http: reqwest::Client,
    pub generations: GenerationRegistry,
    pub paths: AppPaths,
}
