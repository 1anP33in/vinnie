//! Project analysis, Git status, and dependency commands.

use rusqlite::{params, OptionalExtension};
use tauri::State;

use crate::analyzer::{self, ProjectMetadata};
use crate::deps::{self, InstallCommand, ManagerDetection};
use crate::error::{AppError, AppResult};
use crate::git::{self, GitStatus};
use crate::state::{ignore_rules, AppState};

/// Analyze the project on a worker thread and cache the result.
#[tauri::command]
pub async fn analyze_project(state: State<'_, AppState>) -> AppResult<ProjectMetadata> {
    let (ws, settings) = state.workspace()?;
    let rules = ignore_rules(&settings);
    let started = std::time::Instant::now();
    let metadata = tokio::task::spawn_blocking(move || analyzer::analyze(&ws, &rules))
        .await
        .map_err(|e| AppError::internal(format!("Project analysis stopped unexpectedly: {e}")))?;
    let json = serde_json::to_string(&metadata)
        .map_err(|e| AppError::internal(format!("Could not store project metadata: {e}")))?;
    state.db.conn()?.execute(
        "INSERT INTO project_metadata (workspace, data, analyzed_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(workspace) DO UPDATE SET data = excluded.data, analyzed_at = excluded.analyzed_at",
        params![metadata.root, json, metadata.analyzed_at],
    )?;
    log::info!(
        "project analyzed in {}ms: {:?}, {} files",
        started.elapsed().as_millis(),
        metadata.project_types,
        metadata.files_scanned
    );
    Ok(metadata)
}

/// The last stored analysis for the active project, if any.
#[tauri::command(async)]
pub fn get_project_metadata(state: State<'_, AppState>) -> AppResult<Option<ProjectMetadata>> {
    let (ws, _) = state.workspace()?;
    let raw: Option<String> = state
        .db
        .conn()?
        .query_row(
            "SELECT data FROM project_metadata WHERE workspace = ?1",
            params![ws.root().display().to_string()],
            |r| r.get(0),
        )
        .optional()?;
    Ok(raw.and_then(|r| serde_json::from_str(&r).ok()))
}

#[tauri::command(async)]
pub fn git_status(state: State<'_, AppState>) -> AppResult<GitStatus> {
    let (ws, _) = state.workspace()?;
    Ok(git::status(&ws))
}

#[tauri::command(async)]
pub fn detect_package_managers(state: State<'_, AppState>) -> AppResult<Vec<ManagerDetection>> {
    let (ws, _) = state.workspace()?;
    Ok(deps::detect(&ws))
}

/// Build (but do not run) an install command. Running it goes through
/// `run_command`, so the policy and approval rules still apply.
#[tauri::command(async)]
pub fn build_install_command(
    manager: String,
    packages: Vec<String>,
    dev: Option<bool>,
) -> AppResult<InstallCommand> {
    deps::install_command(&manager, &packages, dev.unwrap_or(false))
}
