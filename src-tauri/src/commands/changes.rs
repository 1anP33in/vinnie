//! Change history commands: list, inspect, and revert recorded changes.

use tauri::State;

use super::workspace::validate_id;
use crate::changes::{self, ChangeDetail, ChangeRecord, RevertOutcome};
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command(async)]
pub fn changes_list(
    state: State<'_, AppState>,
    path: Option<String>,
    limit: Option<usize>,
) -> AppResult<Vec<ChangeRecord>> {
    let (ws, _) = state.workspace()?;
    changes::list(
        &*state.db.conn()?,
        &ws,
        path.as_deref(),
        limit.unwrap_or(200),
    )
}

#[tauri::command(async)]
pub fn changes_detail(state: State<'_, AppState>, id: i64) -> AppResult<ChangeDetail> {
    let (ws, _) = state.workspace()?;
    changes::detail(&*state.db.conn()?, &ws, id)
}

/// Revert one change. Reverting is always a direct user action.
#[tauri::command(async)]
pub fn changes_revert(
    state: State<'_, AppState>,
    id: i64,
    force: Option<bool>,
) -> AppResult<ChangeRecord> {
    let (ws, _) = state.workspace()?;
    changes::revert(&*state.db.conn()?, &ws, id, force.unwrap_or(false))
}

#[tauri::command(async)]
pub fn changes_revert_task(
    state: State<'_, AppState>,
    task_id: String,
    force: Option<bool>,
) -> AppResult<Vec<RevertOutcome>> {
    validate_id(&task_id, "task")?;
    let (ws, _) = state.workspace()?;
    changes::revert_task(&*state.db.conn()?, &ws, &task_id, force.unwrap_or(false))
}
