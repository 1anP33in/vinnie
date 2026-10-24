fn main() {
    // Registering the app's commands in the manifest makes Tauri generate an
    // `allow-<command>` permission for each one. Commands are then denied
    // unless a capability (see `capabilities/default.json`) grants them.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_app_info",
            "open_external_url",
            "copy_text",
            "get_settings",
            "save_settings",
            "check_connection",
            "list_models",
            "chat_stream",
            "cancel_generation",
            "list_conversations",
            "search_conversations",
            "create_conversation",
            "rename_conversation",
            "delete_conversation",
            "delete_all_conversations",
            "list_messages",
            "add_message",
            "set_last_conversation",
            "get_last_conversation",
            "get_project",
            "pick_project_folder",
            "clear_project",
        ]),
    ))
    .expect("failed to run tauri-build");
}
