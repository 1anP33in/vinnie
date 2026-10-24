use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

const MAX_CLIPBOARD_BYTES: usize = 8 * 1024 * 1024;

/// Write text to the system clipboard. Runs in the backend because the
/// webview's clipboard API is unavailable when the window lacks focus.
/// Write-only: the frontend can never read the clipboard.
#[tauri::command]
pub fn copy_text(app: AppHandle, text: String) -> AppResult<()> {
    if text.len() > MAX_CLIPBOARD_BYTES {
        return Err(AppError::validation("That text is too large to copy."));
    }
    app.clipboard()
        .write_text(text)
        .map_err(|e| AppError::internal(format!("Could not copy to the clipboard: {e}")))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub os: String,
    pub arch: String,
    pub data_dir: String,
    pub database_path: String,
    pub log_dir: Option<String>,
}

#[tauri::command]
pub fn get_app_info(app: AppHandle, state: State<'_, AppState>) -> AppInfo {
    let package = app.package_info();
    AppInfo {
        name: package.name.clone(),
        version: package.version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        data_dir: state.paths.data_dir.display().to_string(),
        database_path: state.paths.database.display().to_string(),
        log_dir: state
            .paths
            .log_dir
            .as_ref()
            .map(|p| p.display().to_string()),
    }
}

/// Open the diagnostic log folder in File Explorer.
#[tauri::command]
pub fn open_log_dir(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let dir = state
        .paths
        .log_dir
        .clone()
        .ok_or_else(|| AppError::not_found("The log folder could not be determined."))?;
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|e| AppError::internal(format!("Could not open the log folder: {e}")))
}

/// Validate that a URL is safe to hand to the system browser.
pub fn validate_external_url(raw: &str) -> AppResult<Url> {
    let url = Url::parse(raw.trim())
        .map_err(|_| AppError::validation("That link is not a valid URL."))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::validation(
            "Only http and https links can be opened.",
        ));
    }
    Ok(url)
}

/// Open an http(s) link in the user's default browser.
#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> AppResult<()> {
    let url = validate_external_url(&url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| AppError::internal(format!("Could not open the link: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_links_are_allowed() {
        assert!(validate_external_url("https://ollama.com/library").is_ok());
        assert!(validate_external_url("http://localhost:3000").is_ok());
        for bad in [
            "javascript:alert(1)",
            "file:///C:/Windows",
            "ms-settings:",
            "not a url",
        ] {
            assert!(validate_external_url(bad).is_err(), "{bad}");
        }
    }
}
