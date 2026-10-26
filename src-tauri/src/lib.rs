//! Vinnie desktop backend.
//!
//! Module map:
//! - `commands`   — thin, validated Tauri command handlers (the IPC surface)
//! - `db`         — SQLite connection, migrations, repositories
//! - `ollama`     — Ollama HTTP client and streaming decoder
//! - `settings`   — user settings and validation
//! - `project`    — active project folder (metadata only in Phase 1)
//! - `generation` — cancellation registry for generations, searches, commands
//! - `workspace`  — path boundary enforcement, file service, search service
//! - `changes`    — change manager: snapshots, diffs, revert, history
//! - `process`    — command policy and process execution
//! - `permissions`— workspace permission model (enforced here, not by the model)
//! - `deps`       — package-manager detection and install commands
//! - `analyzer`   — lightweight project analysis
//! - `git`        — read-only Git status

mod analyzer;
mod changes;
mod commands;
mod db;
mod deps;
mod error;
mod generation;
mod git;
mod ollama;
mod permissions;
mod process;
mod project;
mod settings;
mod state;
mod workspace;

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
        searches: Default::default(),
        processes: Default::default(),
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
            commands::workspace::ws_list_dir,
            commands::workspace::ws_project_tree,
            commands::workspace::ws_read_file,
            commands::workspace::ws_stat_file,
            commands::workspace::ws_create_dir,
            commands::workspace::ws_preview_change,
            commands::workspace::ws_apply_change,
            commands::workspace::ws_search,
            commands::workspace::ws_cancel_search,
            commands::changes::changes_list,
            commands::changes::changes_detail,
            commands::changes::changes_revert,
            commands::changes::changes_revert_task,
            commands::process::assess_command,
            commands::process::run_command,
            commands::process::cancel_command,
            commands::process::allowlist_list,
            commands::process::allowlist_remove,
            commands::analysis::analyze_project,
            commands::analysis::get_project_metadata,
            commands::analysis::git_status,
            commands::analysis::detect_package_managers,
            commands::analysis::build_install_command,
            commands::app::open_log_dir,
            commands::chat::model_details,
            commands::chat::launch_ollama,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vinnie");
}
