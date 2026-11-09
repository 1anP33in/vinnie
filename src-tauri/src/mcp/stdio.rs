//! Local (stdio) MCP servers: launch, relay JSON-RPC lines, stop.
//!
//! - Only the command stored in the server's configuration is launched,
//!   resolved on PATH (or an absolute path), with arguments passed
//!   separately: never through a shell.
//! - The environment is rebuilt from a small allowlist plus the server's own
//!   variables and secrets, so other credentials in Vinnie's environment are
//!   not inherited.
//! - Each server runs in a Windows job object that kills it (and anything it
//!   started) when it is stopped or when Vinnie exits, even after a crash.
//! - Lines are size-limited; oversized output is dropped and reported.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::process::ChildStdin;
use tokio_util::sync::CancellationToken;

use super::logs::McpLogs;
use crate::error::{AppError, AppResult, ErrorKind};

/// Largest JSON-RPC line accepted from a server, or sent to one.
pub const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
const MAX_STDERR_LINE: usize = 4_000;

/// Inherited environment variables (Windows system basics; nothing secret).
const ENV_ALLOWLIST: &[&str] = &[
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "USERNAME",
    "USERDOMAIN",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "ALLUSERSPROFILE",
    "PUBLIC",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "COMMONPROGRAMFILES",
    "COMMONPROGRAMFILES(X86)",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "OS",
    "LANG",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StdioEvent {
    Message { line: String },
    Stderr { line: String },
    Dropped { reason: String },
    Exit { code: Option<i32> },
}

/// Everything needed to launch a server (resolved from its stored config).
pub struct LaunchSpec {
    pub server_id: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub cwd: Option<PathBuf>,
    /// Secret values, for redaction in logs.
    pub secrets: Vec<String>,
}

struct Running {
    stdin: Arc<tokio::sync::Mutex<ChildStdin>>,
    cancel: CancellationToken,
    generation: u64,
}

#[derive(Default)]
pub struct StdioServers {
    running: Arc<Mutex<HashMap<String, Running>>>,
    next_generation: std::sync::atomic::AtomicU64,
}

/// Resolve the configured program: an absolute path to an existing file, or
/// a name looked up on PATH (never in the current directory).
fn resolve(command: &str) -> AppResult<PathBuf> {
    let path = std::path::Path::new(command);
    if path.is_absolute() {
        return if path.is_file() {
            Ok(path.to_path_buf())
        } else {
            Err(AppError::not_found(format!("`{command}` does not exist.")))
        };
    }
    if command.contains(['/', '\\']) {
        return Err(AppError::validation(
            "Use a program name on PATH (like npx) or a full absolute path.",
        ));
    }
    crate::process::resolve_program(command)
}

/// The environment a server process gets.
pub fn build_env(
    spec_env: &BTreeMap<String, String>,
    parent: impl Iterator<Item = (String, String)>,
) -> BTreeMap<String, String> {
    let mut env: BTreeMap<String, String> = parent
        .filter(|(k, _)| ENV_ALLOWLIST.iter().any(|a| a.eq_ignore_ascii_case(k)))
        .collect();
    for (k, v) in spec_env {
        env.insert(k.clone(), v.clone());
    }
    env
}

impl StdioServers {
    #[cfg(test)]
    pub fn is_running(&self, id: &str) -> bool {
        self.running
            .lock()
            .map(|r| r.contains_key(id))
            .unwrap_or(false)
    }

    /// Launch a server. An already running instance is stopped first.
    pub async fn start<F>(&self, spec: LaunchSpec, logs: Arc<McpLogs>, emit: F) -> AppResult<u32>
    where
        F: Fn(StdioEvent) + Send + Sync + 'static,
    {
        self.stop(&spec.server_id);
        let program = resolve(&spec.command)?;
        let mut cmd = tokio::process::Command::new(&program);
        cmd.args(&spec.args)
            .env_clear()
            .envs(build_env(&spec.env, std::env::vars()))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(cwd) = &spec.cwd {
            if !cwd.is_dir() {
                return Err(AppError::not_found(format!(
                    "The working directory {} does not exist.",
                    cwd.display()
                )));
            }
            cmd.current_dir(cwd);
        } else if let Some(home) = std::env::var_os("USERPROFILE") {
            cmd.current_dir(home);
        }
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().map_err(|e| {
            AppError::new(
                ErrorKind::Io,
                format!("Could not start `{}`: {e}", spec.command),
            )
        })?;
        #[cfg(windows)]
        if let Some(handle) = child.raw_handle() {
            super::job::assign(handle);
        }
        let pid = child.id().unwrap_or(0);
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::internal("The server's stdin is unavailable."))?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let cancel = CancellationToken::new();
        let generation = self
            .next_generation
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.running
            .lock()
            .map_err(|_| AppError::internal("Server registry lock poisoned."))?
            .insert(
                spec.server_id.clone(),
                Running {
                    stdin: Arc::new(tokio::sync::Mutex::new(stdin)),
                    cancel: cancel.clone(),
                    generation,
                },
            );
        logs.push(
            &spec.server_id,
            "info",
            format!("Started {} (pid {pid}).", program.display()),
        );
        log::info!("mcp server {} started (pid {pid})", spec.server_id);

        let emit = Arc::new(emit);
        if let Some(out) = stdout {
            let emit = emit.clone();
            tokio::spawn(read_messages(out, move |e| emit(e)));
        }
        if let Some(err) = stderr {
            let emit = emit.clone();
            let logs = logs.clone();
            let id = spec.server_id.clone();
            let secrets = spec.secrets.clone();
            tokio::spawn(read_stderr(err, move |line| {
                let line = super::secrets::redact(&line, &secrets);
                logs.push(&id, "stderr", line.clone());
                emit(StdioEvent::Stderr { line });
            }));
        }

        // Waiter: reports the exit and cleans up the registry entry.
        let registry = self.running.clone();
        let id = spec.server_id.clone();
        tokio::spawn(async move {
            let status = tokio::select! {
                status = child.wait() => status.ok(),
                _ = cancel.cancelled() => {
                    crate::process::kill_tree(&mut child);
                    child.wait().await.ok()
                }
            };
            let code = status.and_then(|s| s.code());
            logs.push(
                &id,
                "info",
                format!(
                    "Server process exited{}.",
                    code.map(|c| format!(" with code {c}")).unwrap_or_default()
                ),
            );
            log::info!("mcp server {id} exited ({code:?})");
            if let Ok(mut running) = registry.lock() {
                if running.get(&id).is_some_and(|r| r.generation == generation) {
                    running.remove(&id);
                }
            }
            emit(StdioEvent::Exit { code });
        });
        Ok(pid)
    }

    /// Send one JSON-RPC message (a single line).
    pub async fn send(&self, id: &str, line: &str) -> AppResult<()> {
        if line.len() > MAX_LINE_BYTES {
            return Err(AppError::validation("The message is too large."));
        }
        if line.contains('\n') || line.contains('\r') {
            return Err(AppError::validation("A message must be a single line."));
        }
        let stdin = {
            let running = self
                .running
                .lock()
                .map_err(|_| AppError::internal("Server registry lock poisoned."))?;
            running.get(id).map(|r| r.stdin.clone()).ok_or_else(|| {
                AppError::new(ErrorKind::Interrupted, "The server process is not running.")
            })?
        };
        let mut stdin = stdin.lock().await;
        let mut bytes = Vec::with_capacity(line.len() + 1);
        bytes.extend_from_slice(line.as_bytes());
        bytes.push(b'\n');
        stdin.write_all(&bytes).await.map_err(|e| {
            AppError::new(
                ErrorKind::Interrupted,
                format!("Could not write to the server: {e}"),
            )
        })?;
        stdin.flush().await.ok();
        Ok(())
    }

    /// Stop a server (and its child processes). Returns false if none ran.
    pub fn stop(&self, id: &str) -> bool {
        let entry = self.running.lock().ok().and_then(|mut r| r.remove(id));
        match entry {
            Some(r) => {
                r.cancel.cancel();
                true
            }
            None => false,
        }
    }

    pub fn stop_all(&self) {
        let ids: Vec<String> = self
            .running
            .lock()
            .map(|r| r.keys().cloned().collect())
            .unwrap_or_default();
        for id in ids {
            self.stop(&id);
        }
    }
}

/// Read newline-delimited messages, dropping lines over the size limit.
async fn read_messages<R: AsyncRead + Unpin, F: Fn(StdioEvent)>(reader: R, emit: F) {
    let mut reader = BufReader::with_capacity(64 * 1024, reader);
    let mut line = Vec::new();
    loop {
        line.clear();
        match read_limited_line(&mut reader, &mut line, MAX_LINE_BYTES).await {
            Ok(LineRead::Eof) => break,
            Ok(LineRead::TooLong) => emit(StdioEvent::Dropped {
                reason: format!(
                    "The server sent a message larger than {} MB; it was dropped.",
                    MAX_LINE_BYTES / (1024 * 1024)
                ),
            }),
            Ok(LineRead::Line) => {
                let text = String::from_utf8_lossy(&line);
                let text = text.trim_end_matches(['\r', '\n']);
                if !text.trim().is_empty() {
                    emit(StdioEvent::Message {
                        line: text.to_owned(),
                    });
                }
            }
            Err(_) => break,
        }
    }
}

enum LineRead {
    Line,
    TooLong,
    Eof,
}

/// Read up to and including `\n`, but never buffer more than `max` bytes:
/// the rest of an oversized line is discarded.
async fn read_limited_line<R: AsyncBufReadExt + Unpin>(
    reader: &mut R,
    out: &mut Vec<u8>,
    max: usize,
) -> std::io::Result<LineRead> {
    let mut too_long = false;
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok(if out.is_empty() && !too_long {
                LineRead::Eof
            } else if too_long {
                LineRead::TooLong
            } else {
                LineRead::Line
            });
        }
        let (chunk, done) = match available.iter().position(|b| *b == b'\n') {
            Some(i) => (&available[..=i], true),
            None => (available, false),
        };
        if !too_long {
            if out.len() + chunk.len() > max {
                too_long = true;
                out.clear();
            } else {
                out.extend_from_slice(chunk);
            }
        }
        let n = chunk.len();
        reader.consume(n);
        if done {
            return Ok(if too_long {
                LineRead::TooLong
            } else {
                LineRead::Line
            });
        }
    }
}

async fn read_stderr<R: AsyncRead + Unpin, F: Fn(String)>(reader: R, emit: F) {
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line: String = line.chars().take(MAX_STDERR_LINE).collect();
        if !line.trim().is_empty() {
            emit(line);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;
    use std::time::Duration;

    fn spec(command: &str, args: &[&str]) -> LaunchSpec {
        LaunchSpec {
            server_id: "echo".into(),
            command: command.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
            env: BTreeMap::new(),
            cwd: None,
            secrets: vec!["topsecretvalue".into()],
        }
    }

    async fn wait_for<T>(
        events: &StdMutex<Vec<StdioEvent>>,
        f: impl Fn(&[StdioEvent]) -> Option<T>,
    ) -> T {
        for _ in 0..600 {
            if let Some(v) = f(&events.lock().unwrap()) {
                return v;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("timed out; events: {:?}", events.lock().unwrap());
    }

    #[test]
    fn environment_is_rebuilt_from_an_allowlist() {
        let parent = vec![
            ("Path".to_string(), "C:\\bin".to_string()),
            ("GITHUB_TOKEN".to_string(), "leak".to_string()),
            ("AWS_SECRET_ACCESS_KEY".to_string(), "leak".to_string()),
            ("SystemRoot".to_string(), "C:\\Windows".to_string()),
        ];
        let mut own = BTreeMap::new();
        own.insert("API_KEY".to_string(), "mine".to_string());
        let env = build_env(&own, parent.into_iter());
        assert_eq!(env.get("Path").map(String::as_str), Some("C:\\bin"));
        assert_eq!(
            env.get("SystemRoot").map(String::as_str),
            Some("C:\\Windows")
        );
        assert_eq!(env.get("API_KEY").map(String::as_str), Some("mine"));
        assert!(!env.contains_key("GITHUB_TOKEN"));
        assert!(!env.contains_key("AWS_SECRET_ACCESS_KEY"));
    }

    #[test]
    fn relative_paths_with_folders_are_rejected() {
        assert!(resolve("..\\evil.exe").is_err());
        assert!(resolve("tools/server.exe").is_err());
        assert!(resolve("C:\\definitely\\missing\\server.exe").is_err());
    }

    /// A PowerShell loop that echoes each stdin line and flushes: a stand-in
    /// stdio server present on every Windows machine.
    #[cfg(windows)]
    #[tokio::test]
    async fn relays_lines_both_ways_and_stops_the_process() {
        let servers = StdioServers::default();
        let logs = Arc::new(McpLogs::default());
        let events = Arc::new(StdMutex::new(Vec::new()));
        let sink = events.clone();
        let pid = servers
            .start(
                spec(
                    "powershell",
                    &[
                        "-NoProfile",
                        "-Command",
                        "while (($l = [Console]::In.ReadLine()) -ne $null) { [Console]::Out.WriteLine($l); [Console]::Out.Flush() }",
                    ],
                ),
                logs.clone(),
                move |e| sink.lock().unwrap().push(e),
            )
            .await
            .unwrap();
        assert!(pid > 0);
        assert!(servers.is_running("echo"));
        servers
            .send("echo", r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#)
            .await
            .unwrap();
        let line = wait_for(&events, |ev| {
            ev.iter().find_map(|e| match e {
                StdioEvent::Message { line } => Some(line.clone()),
                _ => None,
            })
        })
        .await;
        assert_eq!(line, r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#);
        assert!(servers.send("echo", "two\nlines").await.is_err());

        assert!(servers.stop("echo"));
        wait_for(&events, |ev| {
            ev.iter()
                .any(|e| matches!(e, StdioEvent::Exit { .. }))
                .then_some(())
        })
        .await;
        assert!(!servers.is_running("echo"));
        assert!(
            servers.send("echo", "{}").await.is_err(),
            "sending after exit fails"
        );
        assert!(logs
            .get("echo")
            .iter()
            .any(|l| l.message.contains("Started")));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn reports_exit_and_redacts_secrets_in_stderr() {
        let servers = StdioServers::default();
        let logs = Arc::new(McpLogs::default());
        let events = Arc::new(StdMutex::new(Vec::new()));
        let sink = events.clone();
        // cmd is used here only as a test fixture that writes to stderr and exits.
        servers
            .start(
                spec(
                    "cmd",
                    &["/C", "echo token topsecretvalue rejected 1>&2 & exit 3"],
                ),
                logs.clone(),
                move |e| sink.lock().unwrap().push(e),
            )
            .await
            .unwrap();
        let code = wait_for(&events, |ev| {
            ev.iter().find_map(|e| match e {
                StdioEvent::Exit { code } => Some(*code),
                _ => None,
            })
        })
        .await;
        assert_eq!(code, Some(3));
        let stderr: Vec<String> = events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                StdioEvent::Stderr { line } => Some(line.clone()),
                _ => None,
            })
            .collect();
        assert!(
            stderr
                .iter()
                .any(|l| l.contains("token [redacted] rejected")),
            "{stderr:?}"
        );
        assert!(logs
            .get("echo")
            .iter()
            .all(|l| !l.message.contains("topsecretvalue")));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn missing_programs_are_reported() {
        let servers = StdioServers::default();
        let err = servers
            .start(
                spec("vinnie-no-such-server", &[]),
                Arc::new(McpLogs::default()),
                |_| {},
            )
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::NotFound);
    }

    #[tokio::test]
    async fn oversized_lines_are_dropped() {
        let data = format!("{}\n{{\"ok\":true}}\n", "x".repeat(100));
        let mut reader = BufReader::with_capacity(16, data.as_bytes());
        let mut line = Vec::new();
        assert!(matches!(
            read_limited_line(&mut reader, &mut line, 50).await.unwrap(),
            LineRead::TooLong
        ));
        line.clear();
        assert!(matches!(
            read_limited_line(&mut reader, &mut line, 50).await.unwrap(),
            LineRead::Line
        ));
        assert_eq!(line, b"{\"ok\":true}\n");
        line.clear();
        assert!(matches!(
            read_limited_line(&mut reader, &mut line, 50).await.unwrap(),
            LineRead::Eof
        ));
    }
}
