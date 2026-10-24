//! Process service: runs commands inside the workspace with streaming
//! output, timeouts, and cancellation.
//!
//! Programs are resolved to an absolute path through `PATH` (never the
//! project folder, which would allow a planted `git.exe` to hijack a
//! command) and executed directly — no shell is involved. Policy checks live
//! in [`policy`]; this module only executes what the caller already allowed.

pub mod policy;

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10 * 60);
pub const MAX_TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// Output retained for the final result (the UI receives everything live).
const TAIL_BYTES: usize = 64 * 1024;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// `std::process::Command` that never flashes a console window.
pub fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ProcessEvent {
    Started {
        pid: Option<u32>,
        program_path: String,
        started_at: i64,
    },
    Stdout {
        text: String,
    },
    Stderr {
        text: String,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessOutcome {
    pub exit_code: Option<i32>,
    pub success: bool,
    pub timed_out: bool,
    pub cancelled: bool,
    pub duration_ms: u64,
    pub started_at: i64,
    pub stdout_tail: String,
    pub stderr_tail: String,
    /// Output was longer than the retained tail.
    pub truncated: bool,
}

/// Resolve a program name to an absolute path via `PATH`/`PATHEXT`.
pub fn resolve_program(program: &str) -> AppResult<PathBuf> {
    which::which(program).map_err(|_| {
        AppError::not_found(format!(
            "`{program}` was not found. Make sure it is installed and on your PATH, then restart Vinnie."
        ))
    })
}

/// Keeps the last `TAIL_BYTES` of a stream.
#[derive(Default)]
struct Tail {
    text: String,
    truncated: bool,
}

impl Tail {
    fn push(&mut self, s: &str) {
        self.text.push_str(s);
        if self.text.len() > TAIL_BYTES * 2 {
            let mut cut = self.text.len() - TAIL_BYTES;
            while !self.text.is_char_boundary(cut) {
                cut += 1;
            }
            self.text.drain(..cut);
            self.truncated = true;
        }
    }
}

/// Decodes a byte stream as UTF-8 incrementally (invalid bytes are replaced),
/// keeping incomplete multi-byte sequences for the next chunk.
#[derive(Default)]
struct Utf8Chunker {
    pending: Vec<u8>,
}

impl Utf8Chunker {
    fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let valid_up_to = match std::str::from_utf8(&self.pending) {
            Ok(_) => self.pending.len(),
            Err(e) if e.error_len().is_none() => e.valid_up_to(),
            Err(_) => self.pending.len(),
        };
        let out = String::from_utf8_lossy(&self.pending[..valid_up_to]).into_owned();
        self.pending.drain(..valid_up_to);
        out
    }

    fn finish(&mut self) -> String {
        let out = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        out
    }
}

async fn pump<R: AsyncRead + Unpin>(
    mut reader: R,
    is_stderr: bool,
    tx: tokio::sync::mpsc::UnboundedSender<(bool, String)>,
) {
    let mut buf = vec![0u8; 8192];
    let mut decoder = Utf8Chunker::default();
    loop {
        match reader.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let text = decoder.push(&buf[..n]);
                if !text.is_empty() && tx.send((is_stderr, text)).is_err() {
                    break;
                }
            }
        }
    }
    let rest = decoder.finish();
    if !rest.is_empty() {
        let _ = tx.send((is_stderr, rest));
    }
}

/// Kill the process and its children (npm, cargo, etc. spawn subprocesses).
fn kill_tree(child: &mut tokio::process::Child) {
    #[cfg(windows)]
    if let Some(pid) = child.id() {
        let _ = hidden_command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.start_kill();
}

/// Run a program to completion, streaming output through `emit`.
pub async fn run<F>(
    program: &str,
    args: &[String],
    cwd: &Path,
    timeout: Duration,
    cancel: &CancellationToken,
    mut emit: F,
) -> AppResult<ProcessOutcome>
where
    F: FnMut(ProcessEvent),
{
    let resolved = resolve_program(program)?;
    let mut command = tokio::process::Command::new(&resolved);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0")
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let started_at = crate::db::now_ms();
    let started = Instant::now();
    let mut child = command.spawn().map_err(|e| {
        AppError::new(
            crate::error::ErrorKind::Io,
            format!("Could not start `{program}`: {e}"),
        )
    })?;
    emit(ProcessEvent::Started {
        pid: child.id(),
        program_path: resolved.display().to_string(),
        started_at,
    });

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let out_task = tokio::spawn(pump(child.stdout.take().expect("piped"), false, tx.clone()));
    let err_task = tokio::spawn(pump(child.stderr.take().expect("piped"), true, tx));

    let mut stdout = Tail::default();
    let mut stderr = Tail::default();
    let deadline = tokio::time::sleep(timeout.min(MAX_TIMEOUT));
    tokio::pin!(deadline);

    let mut timed_out = false;
    let mut cancelled = false;
    let mut status = None;
    let mut streams_open = true;
    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled(), if !cancelled && status.is_none() => {
                cancelled = true;
                kill_tree(&mut child);
            }
            _ = &mut deadline, if !timed_out && status.is_none() => {
                timed_out = true;
                kill_tree(&mut child);
            }
            chunk = rx.recv(), if streams_open => match chunk {
                Some((is_err, text)) => {
                    if is_err {
                        stderr.push(&text);
                        emit(ProcessEvent::Stderr { text });
                    } else {
                        stdout.push(&text);
                        emit(ProcessEvent::Stdout { text });
                    }
                }
                None => streams_open = false,
            },
            result = child.wait(), if status.is_none() => {
                status = Some(result.map_err(|e| AppError::internal(format!("Lost track of the process: {e}")))?);
            }
        }
        if status.is_some() && !streams_open {
            break;
        }
        // Children of a killed process may hold the pipes open; don't wait forever.
        if status.is_some() && (cancelled || timed_out) {
            break;
        }
    }
    out_task.abort();
    err_task.abort();
    while let Ok((is_err, text)) = rx.try_recv() {
        if is_err {
            stderr.push(&text);
            emit(ProcessEvent::Stderr { text });
        } else {
            stdout.push(&text);
            emit(ProcessEvent::Stdout { text });
        }
    }

    let status = status.expect("loop exits only after wait");
    let exit_code = status.code();
    Ok(ProcessOutcome {
        success: status.success() && !timed_out && !cancelled,
        exit_code,
        timed_out,
        cancelled,
        duration_ms: started.elapsed().as_millis() as u64,
        started_at,
        truncated: stdout.truncated || stderr.truncated,
        stdout_tail: stdout.text,
        stderr_tail: stderr.text,
    })
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    // These tests call the process layer directly (below the policy), using
    // cmd.exe only as a convenient test fixture.

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test]
    async fn captures_stdout_stderr_and_exit_code() {
        let dir = tempfile::tempdir().unwrap();
        let mut events = Vec::new();
        let out = run(
            "cmd",
            &args(&["/C", "echo hello&& echo oops 1>&2&& exit /b 3"]),
            dir.path(),
            Duration::from_secs(20),
            &CancellationToken::new(),
            |e| events.push(e),
        )
        .await
        .unwrap();
        assert_eq!(out.exit_code, Some(3));
        assert!(!out.success);
        assert!(out.stdout_tail.contains("hello"));
        assert!(out.stderr_tail.contains("oops"));
        assert!(matches!(events.first(), Some(ProcessEvent::Started { .. })));
    }

    #[tokio::test]
    async fn success_and_working_directory() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("marker.txt"), "x").unwrap();
        let out = run(
            "cmd",
            &args(&["/C", "dir /b"]),
            dir.path(),
            Duration::from_secs(20),
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
        assert!(out.success);
        assert_eq!(out.exit_code, Some(0));
        assert!(out.stdout_tail.contains("marker.txt"));
    }

    #[tokio::test]
    async fn times_out_and_kills_the_process() {
        let dir = tempfile::tempdir().unwrap();
        let started = Instant::now();
        let out = run(
            "cmd",
            &args(&["/C", "ping -n 30 127.0.0.1"]),
            dir.path(),
            Duration::from_millis(800),
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
        assert!(out.timed_out);
        assert!(!out.success);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[tokio::test]
    async fn cancellation_stops_the_process() {
        let dir = tempfile::tempdir().unwrap();
        let cancel = CancellationToken::new();
        let trigger = cancel.clone();
        let started = Instant::now();
        let out = run(
            "cmd",
            &args(&["/C", "ping -n 30 127.0.0.1"]),
            dir.path(),
            Duration::from_secs(60),
            &cancel,
            move |e| {
                if matches!(e, ProcessEvent::Stdout { .. }) {
                    trigger.cancel();
                }
            },
        )
        .await
        .unwrap();
        assert!(out.cancelled);
        assert!(!out.success);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[tokio::test]
    async fn missing_programs_are_reported() {
        let dir = tempfile::tempdir().unwrap();
        let err = run(
            "definitely-not-a-real-program-xyz",
            &[],
            dir.path(),
            Duration::from_secs(5),
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap_err();
        assert_eq!(err.kind, crate::error::ErrorKind::NotFound);
    }

    #[test]
    fn programs_are_never_resolved_from_the_project_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("vinnie-fake-tool.cmd"), "@echo hijacked").unwrap();
        let prev = std::env::current_dir().unwrap();
        std::env::set_current_dir(dir.path()).unwrap();
        let result = resolve_program("vinnie-fake-tool");
        std::env::set_current_dir(prev).unwrap();
        assert!(
            result.is_err(),
            "resolved a program from the current directory"
        );
    }

    #[test]
    fn utf8_chunker_handles_split_characters() {
        let mut c = Utf8Chunker::default();
        let bytes = "❄ ok".as_bytes();
        assert_eq!(c.push(&bytes[..1]), "");
        assert_eq!(c.push(&bytes[1..]), "❄ ok");
        assert_eq!(c.push(&[0xff, b'a']), "\u{fffd}a");
    }
}
