//! Tauri command handlers.
//!
//! Commands are thin: they validate input crossing the IPC boundary and
//! delegate to the domain modules. Every command must also be listed in
//! `build.rs` and granted in `capabilities/default.json`.

pub mod app;
pub mod chat;
pub mod conversations;
pub mod project;
pub mod settings;
