//! Tool settings and small text-file dialogs (MCP config and skill
//! import/export).

use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::tool_settings::{self, ToolSetting, ToolSettingInput};

#[tauri::command]
pub fn tool_settings_list(state: State<'_, AppState>) -> AppResult<Vec<ToolSetting>> {
    tool_settings::list(&*state.db.conn()?)
}

#[tauri::command]
pub fn tool_settings_save(
    state: State<'_, AppState>,
    setting: ToolSettingInput,
) -> AppResult<ToolSetting> {
    tool_settings::save(&*state.db.conn()?, &setting)
}

#[tauri::command]
pub fn tool_settings_record_run(
    state: State<'_, AppState>,
    key: String,
    outcome: String,
) -> AppResult<()> {
    tool_settings::record_run(&*state.db.conn()?, &key, &outcome)
}

const MAX_TEXT_FILE: u64 = 2 * 1024 * 1024;

/// Save text to a file the user picks. Returns the chosen path, or None.
#[tauri::command]
pub async fn save_text_file(
    app: AppHandle,
    window: WebviewWindow,
    default_name: String,
    content: String,
) -> AppResult<Option<String>> {
    if content.len() as u64 > MAX_TEXT_FILE {
        return Err(AppError::validation("The file is too large."));
    }
    let name: String = default_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .take(80)
        .collect();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Save as")
        .set_parent(&window)
        .set_file_name(if name.is_empty() {
            "export.json"
        } else {
            &name
        })
        .add_filter("JSON", &["json"])
        .save_file(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx
        .await
        .map_err(|_| AppError::internal("The save dialog closed unexpectedly."))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|_| AppError::validation("That location is not a local file."))?;
    std::fs::write(&path, content)?;
    Ok(Some(path.display().to_string()))
}

#[derive(serde::Serialize)]
pub struct OpenedFile {
    name: String,
    content: String,
}

/// Read a small text file the user picks.
#[tauri::command]
pub async fn open_text_file(
    app: AppHandle,
    window: WebviewWindow,
) -> AppResult<Option<OpenedFile>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Open")
        .set_parent(&window)
        .add_filter("JSON", &["json"])
        .pick_file(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx
        .await
        .map_err(|_| AppError::internal("The open dialog closed unexpectedly."))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|_| AppError::validation("That location is not a local file."))?;
    if std::fs::metadata(&path)?.len() > MAX_TEXT_FILE {
        return Err(AppError::validation("That file is larger than 2 MB."));
    }
    let content = String::from_utf8(std::fs::read(&path)?)
        .map_err(|_| AppError::validation("That file is not UTF-8 text."))?;
    Ok(Some(OpenedFile {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        content,
    }))
}
