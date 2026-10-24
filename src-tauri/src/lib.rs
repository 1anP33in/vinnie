//! Vinnie desktop backend.
//!
//! Module map:
//! - `commands`   — thin, validated Tauri command handlers (the IPC surface)
//! - `db`         — SQLite connection, migrations, repositories
//! - `ollama`     — Ollama HTTP client and streaming decoder
//! - `settings`   — user settings and validation
//! - `project`    — active project folder (metadata only in Phase 1)
//! - `generation` — cancellation registry for in-flight generations

mod commands;
mod db;
mod error;
mod generation;
mod ollama;
mod project;
mod settings;
mod state;

use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

use crate::db::Database;
use crate::error::AppError;
use crate::state::{AppPaths, AppState};

fn init_state(app: &tauri::AppHandle) -> Result<AppState, AppError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::internal(format!("Could not resolve the data folder: {e}")))?;
    std::fs::create_dir_all(&data_dir)?;
    let database = data_dir.join("vinnie.db");
    let db = Database::open(&database)?;
    log::info!("database opened at {}", database.display());

    Ok(AppState {
        db,
        http: ollama::build_http_client()?,
        generations: Default::default(),
        paths: AppPaths {
            data_dir,
            database,
            log_dir: app.path().app_log_dir().ok(),
        },
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_plugin = tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::LogDir {
                file_name: Some("vinnie".into()),
            }),
        ])
        .level(log::LevelFilter::Info)
        .max_file_size(5 * 1024 * 1024)
        .rotation_strategy(RotationStrategy::KeepOne)
        .build();

    tauri::Builder::default()
        .plugin(log_plugin)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let state = init_state(app.handle()).inspect_err(|err| {
                log::error!("startup failed: {err}");
            })?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_info,
            commands::app::open_external_url,
            commands::app::copy_text,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::chat::check_connection,
            commands::chat::list_models,
            commands::chat::chat_stream,
            commands::chat::cancel_generation,
            commands::conversations::list_conversations,
            commands::conversations::search_conversations,
            commands::conversations::create_conversation,
            commands::conversations::rename_conversation,
            commands::conversations::delete_conversation,
            commands::conversations::delete_all_conversations,
            commands::conversations::list_messages,
            commands::conversations::add_message,
            commands::conversations::set_last_conversation,
            commands::conversations::get_last_conversation,
            commands::project::get_project,
            commands::project::pick_project_folder,
            commands::project::clear_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vinnie");
}
