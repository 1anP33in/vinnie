use tauri::State;

use crate::error::AppResult;
use crate::settings::{self, Settings};
use crate::state::AppState;

#[tauri::command(async)]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<Settings> {
    settings::load(&*state.db.conn()?)
}

/// Validate and persist settings. Returns the normalized settings that were
/// actually stored.
#[tauri::command(async)]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> AppResult<Settings> {
    let saved = settings::save(&*state.db.conn()?, &settings)?;
    log::info!("settings saved");
    Ok(saved)
}
