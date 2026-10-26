//! Start a local Ollama server (`ollama serve`) when Vinnie can't reach one.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use url::Url;

use crate::error::{AppError, AppResult};
use crate::process::hidden_command;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    /// `started` or `alreadyRunning`.
    pub status: String,
    pub executable: Option<String>,
}

/// Only a server on this computer can be launched.
pub fn local_bind_address(endpoint: &str) -> AppResult<String> {
    let url = Url::parse(endpoint)
        .map_err(|_| AppError::validation("The Ollama endpoint is not a valid URL."))?;
    let host = url.host_str().unwrap_or_default().trim_matches(['[', ']']);
    let local = matches!(host, "localhost" | "127.0.0.1" | "::1" | "0.0.0.0");
    if !local {
        return Err(AppError::validation(format!(
            "The Ollama endpoint points to {host}, which is not this computer, so Vinnie can't start it. Start Ollama on that machine, or change the endpoint in Settings."
        )));
    }
    let port = url.port_or_known_default().unwrap_or(11434);
    let bind = if host == "::1" {
        format!("[::1]:{port}")
    } else {
        format!("127.0.0.1:{port}")
    };
    Ok(bind)
}

/// Find `ollama.exe`: on PATH, or in the default per-user install folder.
pub fn locate(local_app_data: Option<&Path>) -> Option<PathBuf> {
    if let Ok(found) = which::which("ollama") {
        return Some(found);
    }
    let candidate = local_app_data?
        .join("Programs")
        .join("Ollama")
        .join("ollama.exe");
    candidate.is_file().then_some(candidate)
}

/// Spawn `ollama serve` detached from Vinnie, with no console window. The
/// server keeps running after Vinnie exits, like the Ollama app does.
pub fn spawn_serve(executable: &Path, bind: &str) -> AppResult<()> {
    let build = |flags: u32| {
        let mut cmd = hidden_command(executable);
        cmd.arg("serve")
            .env("OLLAMA_HOST", bind)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(flags);
        }
        #[cfg(not(windows))]
        let _ = flags;
        cmd
    };
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    // Leave Vinnie's job object (if any) so the server keeps running after
    // Vinnie closes, like starting it by hand. Not every job allows that.
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    let base = CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
    build(base | CREATE_BREAKAWAY_FROM_JOB)
        .spawn()
        .or_else(|_| build(base).spawn())
        .map(|_child| ())
        .map_err(|e| AppError::internal(format!("Could not start Ollama: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_local_endpoints_can_be_launched() {
        assert_eq!(
            local_bind_address("http://localhost:11434").unwrap(),
            "127.0.0.1:11434"
        );
        assert_eq!(
            local_bind_address("http://127.0.0.1:9999").unwrap(),
            "127.0.0.1:9999"
        );
        assert_eq!(
            local_bind_address("http://[::1]:11434").unwrap(),
            "[::1]:11434"
        );
        assert!(local_bind_address("http://192.168.1.20:11434").is_err());
        assert!(local_bind_address("https://ollama.example.com").is_err());
    }

    #[test]
    fn finds_ollama_in_the_default_install_folder() {
        let dir = tempfile::tempdir().unwrap();
        let exe_dir = dir.path().join("Programs").join("Ollama");
        std::fs::create_dir_all(&exe_dir).unwrap();
        std::fs::write(exe_dir.join("ollama.exe"), b"").unwrap();
        let found = locate(Some(dir.path()));
        // Either the real one on PATH, or the planted default location.
        assert!(found.is_some());
        let empty = tempfile::tempdir().unwrap();
        if which::which("ollama").is_err() {
            assert!(locate(Some(empty.path())).is_none());
        }
    }
}
