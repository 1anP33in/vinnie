use tauri::State;

use crate::db::conversations::{self, Conversation, Message, NewMessage};
use crate::db::kv;
use crate::error::AppResult;
use crate::settings::validate_model_name;
use crate::state::AppState;

const LAST_CONVERSATION_KEY: &str = "last_conversation_id";

#[tauri::command(async)]
pub fn list_conversations(state: State<'_, AppState>) -> AppResult<Vec<Conversation>> {
    conversations::list(&*state.db.conn()?)
}

#[tauri::command(async)]
pub fn search_conversations(
    state: State<'_, AppState>,
    query: String,
) -> AppResult<Vec<Conversation>> {
    conversations::search(&*state.db.conn()?, &query)
}

#[tauri::command(async)]
pub fn create_conversation(
    state: State<'_, AppState>,
    title: String,
    model: Option<String>,
) -> AppResult<Conversation> {
    let model = model.map(|m| validate_model_name(&m)).transpose()?;
    conversations::create(&*state.db.conn()?, &title, model.as_deref())
}

#[tauri::command(async)]
pub fn rename_conversation(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> AppResult<Conversation> {
    conversations::rename(&*state.db.conn()?, &id, &title)
}

#[tauri::command(async)]
pub fn delete_conversation(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = state.db.conn()?;
    conversations::delete(&conn, &id)?;
    if kv::get(&conn, LAST_CONVERSATION_KEY)?.as_deref() == Some(id.as_str()) {
        kv::delete(&conn, LAST_CONVERSATION_KEY)?;
    }
    log::info!("conversation deleted");
    Ok(())
}

#[tauri::command(async)]
pub fn delete_all_conversations(state: State<'_, AppState>) -> AppResult<usize> {
    let conn = state.db.conn()?;
    let count = conversations::delete_all(&conn)?;
    kv::delete(&conn, LAST_CONVERSATION_KEY)?;
    log::info!("deleted all {count} conversations");
    Ok(count)
}

#[tauri::command(async)]
pub fn list_messages(
    state: State<'_, AppState>,
    conversation_id: String,
) -> AppResult<Vec<Message>> {
    conversations::list_messages(&*state.db.conn()?, &conversation_id)
}

#[tauri::command(async)]
pub fn add_message(state: State<'_, AppState>, message: NewMessage) -> AppResult<Message> {
    if let Some(model) = &message.model {
        validate_model_name(model)?;
    }
    conversations::add_message(&mut *state.db.conn()?, &message)
}

#[tauri::command(async)]
pub fn set_last_conversation(state: State<'_, AppState>, id: Option<String>) -> AppResult<()> {
    let conn = state.db.conn()?;
    match id {
        Some(id) if conversations::exists(&conn, &id)? => {
            kv::set(&conn, LAST_CONVERSATION_KEY, &id)
        }
        _ => kv::delete(&conn, LAST_CONVERSATION_KEY),
    }
}

/// The last active conversation, if it still exists.
#[tauri::command(async)]
pub fn get_last_conversation(state: State<'_, AppState>) -> AppResult<Option<String>> {
    let conn = state.db.conn()?;
    match kv::get(&conn, LAST_CONVERSATION_KEY)? {
        Some(id) if conversations::exists(&conn, &id)? => Ok(Some(id)),
        _ => Ok(None),
    }
}
