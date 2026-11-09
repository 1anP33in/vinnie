//! Skill commands.

use tauri::State;

use crate::error::AppResult;
use crate::skills::{SkillBundle, SkillDetail, SkillMeta, SkillSummary};
use crate::state::AppState;

#[tauri::command]
pub fn skills_list(state: State<'_, AppState>) -> AppResult<Vec<SkillSummary>> {
    state.skills.list(&*state.db.conn()?)
}

#[tauri::command]
pub fn skills_read(state: State<'_, AppState>, id: String) -> AppResult<SkillDetail> {
    state.skills.read(&*state.db.conn()?, &id)
}

#[tauri::command]
pub fn skills_save(
    state: State<'_, AppState>,
    meta: SkillMeta,
    instructions: String,
    is_new: bool,
) -> AppResult<SkillSummary> {
    state
        .skills
        .save(&*state.db.conn()?, &meta, &instructions, is_new)
}

#[tauri::command]
pub fn skills_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.skills.delete(&*state.db.conn()?, &id)
}

#[tauri::command]
pub fn skills_set_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> AppResult<()> {
    state.skills.set_enabled(&*state.db.conn()?, &id, enabled)
}

#[tauri::command]
pub fn skills_read_reference(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> AppResult<String> {
    state.skills.read_reference(&id, &name)
}

#[tauri::command]
pub fn skills_save_reference(
    state: State<'_, AppState>,
    id: String,
    name: String,
    content: String,
) -> AppResult<()> {
    state.skills.save_reference(&id, &name, &content)
}

#[tauri::command]
pub fn skills_delete_reference(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> AppResult<()> {
    state.skills.delete_reference(&id, &name)
}

#[tauri::command]
pub fn skills_export(state: State<'_, AppState>, id: String) -> AppResult<SkillBundle> {
    state.skills.export(&*state.db.conn()?, &id)
}

#[tauri::command]
pub fn skills_import(
    state: State<'_, AppState>,
    bundle: SkillBundle,
    overwrite: bool,
) -> AppResult<SkillSummary> {
    state.skills.import(&*state.db.conn()?, &bundle, overwrite)
}
