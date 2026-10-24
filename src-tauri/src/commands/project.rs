use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::error::{AppError, AppResult};
use crate::project::{self, ProjectInfo};
use crate::state::AppState;

#[tauri::command(async)]
pub fn get_project(state: State<'_, AppState>) -> AppResult<Option<ProjectInfo>> {
    project::load(&*state.db.conn()?)
}

/// Show the native folder picker and make the chosen folder the active
/// project. Returns `None` if the user cancelled.
///
/// The picker runs in the backend so the frontend never needs filesystem or
/// dialog permissions, and only paths the user explicitly chose are stored.
#[tauri::command]
pub async fn pick_project_folder(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Option<ProjectInfo>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a project folder")
        .set_parent(&window)
        .pick_folder(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx
        .await
        .map_err(|_| AppError::internal("The folder picker closed unexpectedly."))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|_| AppError::validation("That location is not a local folder."))?;
    let info = project::set(&*state.db.conn()?, &path)?;
    log::info!("active project changed");
    Ok(Some(info))
}

#[tauri::command(async)]
pub fn clear_project(state: State<'_, AppState>) -> AppResult<()> {
    project::clear(&*state.db.conn()?)
}
