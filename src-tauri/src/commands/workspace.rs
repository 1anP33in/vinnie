//! Workspace commands: browse, read, search, and change files.
//!
//! Requests carry an [`Access`] describing who is acting. Assistant requests
//! are checked against the permission settings here, in the backend.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::changes::{self, ChangeMeta, ChangePreview, ChangeRecord, ChangeSource, FileOperation};
use crate::error::{AppError, AppResult, ErrorKind};
use crate::permissions::{self, Actor, Capability};
use crate::state::{ignore_rules, AppState};
use crate::workspace::display_rel;
use crate::workspace::fs::{self as wsfs, DirListing, FileContent, FileVersion, ProjectTree};
use crate::workspace::search::{self, SearchQuery, SearchResults};

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Access {
    #[serde(default)]
    pub actor: Actor,
    /// The user explicitly approved this request in the approval UI.
    #[serde(default)]
    pub approved: bool,
}

pub fn validate_id(id: &str, what: &str) -> AppResult<()> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if ok {
        Ok(())
    } else {
        Err(AppError::validation(format!("Invalid {what} id.")))
    }
}

#[tauri::command(async)]
pub fn ws_list_dir(state: State<'_, AppState>, path: String) -> AppResult<DirListing> {
    let (ws, settings) = state.workspace()?;
    wsfs::list_dir(&ws, &path, &ignore_rules(&settings))
}

#[tauri::command(async)]
pub fn ws_project_tree(
    state: State<'_, AppState>,
    path: Option<String>,
    max_depth: Option<usize>,
    max_entries: Option<usize>,
    access: Option<Access>,
) -> AppResult<ProjectTree> {
    let (ws, settings) = state.workspace()?;
    let access = access.unwrap_or_default();
    permissions::check(
        &settings.permissions,
        access.actor,
        Capability::Read,
        access.approved,
    )?;
    wsfs::tree(
        &ws,
        path.as_deref().unwrap_or(""),
        &ignore_rules(&settings),
        max_depth.unwrap_or(3),
        max_entries.unwrap_or(300),
    )
}

#[tauri::command(async)]
pub fn ws_read_file(
    state: State<'_, AppState>,
    path: String,
    access: Option<Access>,
) -> AppResult<FileContent> {
    let (ws, settings) = state.workspace()?;
    let access = access.unwrap_or_default();
    permissions::check(
        &settings.permissions,
        access.actor,
        Capability::Read,
        access.approved,
    )?;
    if access.actor == Actor::Assistant && permissions::is_sensitive_path(&path) && !access.approved
    {
        return Err(AppError::new(
            ErrorKind::ApprovalRequired,
            format!(
                "{} may contain secrets. Vinnie needs your approval to read it.",
                display_rel(&path)
            ),
        ));
    }
    let result = wsfs::read_file(&ws, &path, wsfs::MAX_TEXT_FILE_BYTES);
    if let Err(e) = &result {
        log::warn!("read failed ({:?}): {}", e.kind, e.message);
    }
    result
}

#[tauri::command(async)]
pub fn ws_stat_file(state: State<'_, AppState>, path: String) -> AppResult<FileVersion> {
    let (ws, _) = state.workspace()?;
    wsfs::stat(&ws, &path)
}

#[tauri::command(async)]
pub fn ws_create_dir(
    state: State<'_, AppState>,
    path: String,
    access: Option<Access>,
) -> AppResult<()> {
    let (ws, settings) = state.workspace()?;
    let access = access.unwrap_or_default();
    permissions::check(
        &settings.permissions,
        access.actor,
        Capability::Write,
        access.approved,
    )?;
    wsfs::create_dir(&ws, &path)
}

/// Compute the diff an operation would produce, without changing anything.
#[tauri::command(async)]
pub fn ws_preview_change(
    state: State<'_, AppState>,
    operation: FileOperation,
) -> AppResult<ChangePreview> {
    let (ws, _) = state.workspace()?;
    changes::preview(&ws, &operation)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOptions {
    #[serde(default)]
    pub access: Access,
    /// Hash of the content the caller last saw; protects against
    /// overwriting external modifications.
    #[serde(default)]
    pub expected_hash: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

/// Apply a file operation through the change manager (snapshot + record).
#[tauri::command(async)]
pub fn ws_apply_change(
    state: State<'_, AppState>,
    operation: FileOperation,
    options: ApplyOptions,
) -> AppResult<ChangeRecord> {
    let (ws, settings) = state.workspace()?;
    let access = options.access;
    permissions::check(
        &settings.permissions,
        access.actor,
        Capability::Write,
        access.approved,
    )?;
    // Deletions by the assistant always need explicit confirmation.
    if access.actor == Actor::Assistant
        && matches!(operation, FileOperation::Delete { .. })
        && !access.approved
    {
        return Err(AppError::new(
            ErrorKind::ApprovalRequired,
            "Deleting files needs your confirmation.",
        ));
    }
    if let Some(task) = &options.task_id {
        validate_id(task, "task")?;
    }
    if options.description.as_ref().is_some_and(|d| d.len() > 500) {
        return Err(AppError::validation("The change description is too long."));
    }
    let meta = ChangeMeta {
        task_id: options.task_id.clone(),
        source: if access.actor == Actor::Assistant {
            ChangeSource::Assistant
        } else {
            ChangeSource::User
        },
        description: options.description.clone(),
    };
    let conn = state.db.conn()?;
    let result = changes::apply(
        &conn,
        &ws,
        &operation,
        &meta,
        options.expected_hash.as_deref(),
    );
    match &result {
        Ok(rec) => log::info!(
            "file op {} on {} by {:?} (change {})",
            operation.verb(),
            rec.path,
            access.actor,
            rec.id
        ),
        Err(e) => log::warn!(
            "file op {} failed ({:?}): {}",
            operation.verb(),
            e.kind,
            e.message
        ),
    }
    result
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub search_id: String,
    pub results: SearchResults,
}

#[tauri::command]
pub async fn ws_search(
    state: State<'_, AppState>,
    search_id: String,
    query: SearchQuery,
    access: Option<Access>,
) -> AppResult<SearchResponse> {
    validate_id(&search_id, "search")?;
    let (ws, settings) = state.workspace()?;
    let access = access.unwrap_or_default();
    permissions::check(
        &settings.permissions,
        access.actor,
        Capability::Read,
        access.approved,
    )?;
    let guard = state.searches.register(&search_id)?;
    let token = guard.token().clone();
    let rules = ignore_rules(&settings);
    let results = tokio::task::spawn_blocking(move || search::search(&ws, &query, &rules, &token))
        .await
        .map_err(|e| AppError::internal(format!("Search stopped unexpectedly: {e}")))??;
    log::info!(
        "search {search_id}: {} matches in {} files{}",
        results.matches.len(),
        results.files_searched,
        if results.cancelled {
            " (cancelled)"
        } else {
            ""
        }
    );
    Ok(SearchResponse { search_id, results })
}

#[tauri::command]
pub fn ws_cancel_search(state: State<'_, AppState>, search_id: String) -> bool {
    state.searches.cancel(&search_id)
}
