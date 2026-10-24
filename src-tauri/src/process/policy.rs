//! Command execution policy.
//!
//! Commands are parsed into a program and arguments, never handed to a shell,
//! and classified as:
//!
//! - **Blocked**: destructive or system-level programs, shell interpreters
//!   (which would bypass this policy), and any shell syntax. Never runs.
//! - **Approval**: anything not known to be safe, including dependency
//!   installs and Git commands that change state.
//! - **Low**: read-only or routine build/test commands.
//!
//! The policy lives in the backend and is applied to every command,
//! regardless of what a model or the UI asks for.

use serde::Serialize;

use crate::error::{AppError, AppResult, ErrorKind};

const MAX_COMMAND_CHARS: usize = 2_000;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RiskLevel {
    Low,
    Approval,
    Blocked,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandAssessment {
    pub command: String,
    pub program: String,
    pub args: Vec<String>,
    pub risk: RiskLevel,
    /// Installs dependencies (governed by the INSTALL_DEPENDENCIES permission).
    pub installs_dependencies: bool,
    pub reason: String,
}

/// Programs that are never run.
const BLOCKED_PROGRAMS: &[&str] = &[
    // file and disk destruction
    "rm",
    "rmdir",
    "rd",
    "del",
    "erase",
    "format",
    "diskpart",
    "fdisk",
    "mkfs",
    "dd",
    "sdelete",
    "cipher",
    "vssadmin",
    "wbadmin",
    "chkdsk",
    "defrag",
    // system control
    "shutdown",
    "restart-computer",
    "stop-computer",
    "logoff",
    "bcdedit",
    "reg",
    "regedit",
    "regsvr32",
    "rundll32",
    "mshta",
    "takeown",
    "icacls",
    "cacls",
    "attrib",
    "net",
    "netsh",
    "sc",
    "schtasks",
    "taskkill",
    "wmic",
    "bitsadmin",
    "certutil",
    "runas",
    "setx",
    // shells and script hosts (would bypass this policy)
    "cmd",
    "powershell",
    "pwsh",
    "bash",
    "sh",
    "zsh",
    "wsl",
    "wscript",
    "cscript",
    "start",
];

const KNOWN_TOOLS: &[&str] = &[
    "node", "npm", "npx", "pnpm", "yarn", "bun", "deno", "python", "python3", "py", "pip", "pip3",
    "uv", "poetry", "pipenv", "cargo", "rustc", "rustup", "dotnet", "go", "git", "java", "javac",
    "tsc", "lua", "luac",
];

const SAFE_SCRIPTS: &[&str] = &[
    "build",
    "test",
    "lint",
    "typecheck",
    "check",
    "format:check",
    "lint:check",
];

/// Whether a resolved executable is one of the blocked programs (checked
/// again after PATH resolution, in case it was reached by another name).
pub fn is_blocked_executable(path: &std::path::Path) -> bool {
    path.file_name()
        .map(|n| BLOCKED_PROGRAMS.contains(&normalize_program(&n.to_string_lossy()).as_str()))
        .unwrap_or(false)
}

fn normalize_program(raw: &str) -> String {
    let name = raw
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(raw)
        .to_ascii_lowercase();
    for ext in [".exe", ".cmd", ".bat", ".com", ".ps1"] {
        if let Some(stem) = name.strip_suffix(ext) {
            return stem.to_string();
        }
    }
    name
}

/// Split on whitespace, honoring double and single quotes. Backslashes are
/// literal, as in Windows paths (POSIX-style escaping would turn
/// `C:\Windows\cmd.exe` into `C:Windowscmd.exe` and hide the program name).
fn tokenize(command: &str) -> AppResult<Vec<String>> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_token = false;
    let mut quote: Option<char> = None;
    for c in command.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => current.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                in_token = true;
            }
            None if c.is_whitespace() => {
                if in_token {
                    tokens.push(std::mem::take(&mut current));
                    in_token = false;
                }
            }
            None => {
                current.push(c);
                in_token = true;
            }
        }
    }
    if quote.is_some() {
        return Err(AppError::validation("That command has unbalanced quotes."));
    }
    if in_token {
        tokens.push(current);
    }
    Ok(tokens)
}

/// Split a command line into program + args. Shell syntax is rejected
/// because commands never run through a shell.
pub fn parse(command: &str) -> AppResult<Vec<String>> {
    let command = command.trim();
    if command.is_empty() {
        return Err(AppError::validation("Enter a command to run."));
    }
    if command.chars().count() > MAX_COMMAND_CHARS {
        return Err(AppError::validation("That command is too long."));
    }
    if command.chars().any(|c| c.is_control()) {
        return Err(AppError::new(
            ErrorKind::Blocked,
            "Commands must be a single line without control characters.",
        ));
    }
    // Reject shell operators anywhere (even inside quotes): `.cmd` shims are
    // interpreted by cmd.exe, where quoting rules differ.
    if let Some(op) = ['&', '|', '<', '>', '^', '%', '`', ';', '$', '\n']
        .iter()
        .find(|c| command.contains(**c))
    {
        return Err(AppError::new(
            ErrorKind::Blocked,
            format!(
                "Shell operators like '{op}' are not supported. Run one command at a time without pipes, redirects, or variables."
            ),
        ));
    }
    let tokens = tokenize(command)?;
    if tokens.is_empty() {
        return Err(AppError::validation("Enter a command to run."));
    }
    Ok(tokens)
}

fn assessment(
    tokens: &[String],
    risk: RiskLevel,
    installs: bool,
    reason: impl Into<String>,
) -> CommandAssessment {
    CommandAssessment {
        command: display(tokens),
        program: tokens[0].clone(),
        args: tokens[1..].to_vec(),
        risk,
        installs_dependencies: installs,
        reason: reason.into(),
    }
}

/// Canonical display form of a parsed command.
pub fn display(tokens: &[String]) -> String {
    tokens
        .iter()
        .map(|t| {
            if t.is_empty() || t.contains(' ') {
                format!("\"{t}\"")
            } else {
                t.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_version_query(args: &[&str]) -> bool {
    matches!(
        args,
        ["--version"] | ["-v"] | ["-V"] | ["version"] | ["--info"]
    )
}

/// Classify a parsed command.
pub fn assess_tokens(tokens: &[String]) -> CommandAssessment {
    let program = normalize_program(&tokens[0]);
    let args: Vec<&str> = tokens[1..].iter().map(String::as_str).collect();
    let first = args.first().copied().unwrap_or("");
    let low = |why: &str| assessment(tokens, RiskLevel::Low, false, why);
    let approve = |why: &str| assessment(tokens, RiskLevel::Approval, false, why);
    let install = |why: &str| assessment(tokens, RiskLevel::Approval, true, why);

    if BLOCKED_PROGRAMS.contains(&program.as_str()) {
        return assessment(
            tokens,
            RiskLevel::Blocked,
            false,
            format!("`{program}` can delete data, change system settings, or bypass Vinnie's command policy, so it is blocked."),
        );
    }
    // Drive-relative paths ("C:tool.exe") resolve against a hidden per-drive
    // working directory; there is no legitimate reason to use them here.
    let raw = tokens[0].as_bytes();
    if raw.len() >= 2 && raw[1] == b':' && !matches!(raw.get(2), Some(b'\\' | b'/')) {
        return assessment(
            tokens,
            RiskLevel::Blocked,
            false,
            "Drive-relative program paths are not allowed. Use a full path such as C:\\tools\\app.exe.",
        );
    }
    if tokens[0].contains(['/', '\\']) {
        return approve("Runs a program by path.");
    }
    if KNOWN_TOOLS.contains(&program.as_str()) && is_version_query(&args) {
        return low("Prints a version.");
    }

    match program.as_str() {
        "npm" | "pnpm" | "yarn" | "bun" => match first {
            "test" | "t" if args.len() == 1 => low("Runs the project's tests."),
            "run" if args.len() == 2 && SAFE_SCRIPTS.contains(&args[1]) => {
                low("Runs a standard build, test, or lint script.")
            }
            "ls" | "list" | "outdated" | "why" | "audit" if !args.contains(&"fix") => {
                low("Reads dependency information.")
            }
            "install" | "i" | "ci" | "add" | "update" | "upgrade" | "up" | "remove"
            | "uninstall" | "rm" => install("Changes the project's installed dependencies."),
            "" if program == "yarn" => install("Installs the project's dependencies."),
            _ => approve("Runs a package script or tool that is not on the low-risk list."),
        },
        "npx" => approve("Downloads and runs a package binary."),
        "pip" | "pip3" => match first {
            "install" | "uninstall" => install("Changes installed Python packages."),
            "list" | "show" | "freeze" | "check" => low("Reads Python package information."),
            _ => approve("Runs pip."),
        },
        "python" | "python3" | "py" => match args.as_slice() {
            ["-m", "pip", "install" | "uninstall", ..] => {
                install("Changes installed Python packages.")
            }
            ["-m", "pip", "list" | "show" | "freeze", ..] => {
                low("Reads Python package information.")
            }
            ["-m", "pytest" | "unittest", ..] => low("Runs the project's tests."),
            _ => approve("Runs Python code."),
        },
        "pytest" => low("Runs the project's tests."),
        "uv" | "poetry" | "pipenv" => match first {
            "add" | "remove" | "install" | "sync" | "lock" | "update" => {
                install("Changes Python dependencies.")
            }
            "run" if args.get(1).is_some_and(|a| *a == "pytest") => {
                low("Runs the project's tests.")
            }
            _ => approve("Runs a Python project tool."),
        },
        "cargo" => match first {
            "build" | "check" | "test" | "clippy" | "tree" | "metadata" | "doc" | "bench" => {
                low("Builds, checks, or tests the Rust project.")
            }
            "fmt" if args.contains(&"--check") => low("Checks formatting without changing files."),
            "add" | "remove" | "install" | "update" | "fetch" => {
                install("Changes Rust dependencies.")
            }
            _ => approve("Runs a cargo command that is not on the low-risk list."),
        },
        "dotnet" => match first {
            "build" | "test" | "--list-sdks" | "--list-runtimes" => {
                low("Builds or tests the .NET project.")
            }
            "list" => low("Reads .NET project information."),
            "add" | "remove" | "restore" => install("Changes .NET dependencies."),
            _ => approve("Runs a dotnet command that is not on the low-risk list."),
        },
        "go" => match first {
            "build" | "test" | "vet" | "list" | "env" => {
                low("Builds, tests, or inspects the Go module.")
            }
            "get" | "install" | "mod" => install("Changes Go dependencies."),
            _ => approve("Runs a go command."),
        },
        "git" => match first {
            "status" | "diff" | "log" | "show" | "blame" | "rev-parse" | "ls-files"
            | "shortlog" => low("Reads repository state."),
            "branch"
                if args.len() == 1
                    || matches!(
                        args.get(1),
                        Some(&("--show-current" | "--list" | "-a" | "-v"))
                    ) =>
            {
                low("Reads branch information.")
            }
            "remote" if matches!(args.get(1), None | Some(&"-v")) => low("Lists remotes."),
            "clean" => assessment(
                tokens,
                RiskLevel::Blocked,
                false,
                "`git clean` permanently deletes untracked files, so it is blocked.",
            ),
            _ => {
                approve("Changes repository state (for example checkout, reset, commit, or push).")
            }
        },
        "tsc" if args.contains(&"--noEmit") => low("Type-checks without writing files."),
        "eslint" if !args.contains(&"--fix") => low("Lints without changing files."),
        "prettier" if args.contains(&"--check") => low("Checks formatting without changing files."),
        _ => approve("This command is not on the low-risk list."),
    }
}

/// Parse and classify a command line.
pub fn assess(command: &str) -> AppResult<CommandAssessment> {
    let tokens = parse(command)?;
    Ok(assess_tokens(&tokens))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn risk(cmd: &str) -> RiskLevel {
        assess(cmd).map(|a| a.risk).unwrap_or(RiskLevel::Blocked)
    }

    #[test]
    fn low_risk_commands() {
        for cmd in [
            "npm test",
            "npm run build",
            "npm run lint",
            "pnpm run typecheck",
            "git status",
            "git diff",
            "git diff --stat",
            "git log --oneline -5",
            "git branch --show-current",
            "python --version",
            "node --version",
            "cargo test",
            "cargo fmt --check",
            "dotnet build",
            "python -m pytest -q",
            "npm.cmd test",
        ] {
            assert_eq!(risk(cmd), RiskLevel::Low, "{cmd}");
        }
    }

    #[test]
    fn approval_required_commands() {
        for cmd in [
            "npm install",
            "npm install express",
            "pnpm install",
            "pnpm add zod",
            "pip install requests",
            "cargo add serde",
            "git checkout main",
            "git reset --hard",
            "git commit -m wip",
            "git push",
            "npm run deploy",
            "node server.js",
            "python app.py",
            "npx create-react-app x",
            "unknown-tool --flag",
            "./scripts/setup.bat",
        ] {
            assert_eq!(risk(cmd), RiskLevel::Approval, "{cmd}");
        }
    }

    #[test]
    fn installs_are_flagged() {
        assert!(assess("npm install express").unwrap().installs_dependencies);
        assert!(
            assess("python -m pip install requests")
                .unwrap()
                .installs_dependencies
        );
        assert!(assess("cargo add serde").unwrap().installs_dependencies);
        assert!(!assess("git checkout main").unwrap().installs_dependencies);
    }

    #[test]
    fn dangerous_commands_are_blocked() {
        for cmd in [
            "rm -rf /",
            "rmdir /s /q C:\\",
            "del /f /q *.*",
            "format C:",
            "diskpart",
            "shutdown /s /t 0",
            "cmd /c dir",
            "powershell -Command Remove-Item x",
            "pwsh -c ls",
            "reg delete HKLM\\Software",
            "DEL.EXE file.txt",
            "C:\\Windows\\System32\\cmd.exe /c echo",
            "git clean -fdx",
            "taskkill /im node.exe",
        ] {
            assert_eq!(risk(cmd), RiskLevel::Blocked, "{cmd}");
        }
    }

    #[test]
    fn shell_syntax_is_blocked() {
        for cmd in [
            "npm test && del /q *",
            "git status | findstr x",
            "npm test > out.txt",
            "echo %PATH%",
            "npm test; rm -rf .",
            "echo `whoami`",
            "echo $(whoami)",
            "npm test ^& del x",
        ] {
            let err = assess(cmd).unwrap_err();
            assert_eq!(err.kind, ErrorKind::Blocked, "{cmd}");
        }
    }

    #[test]
    fn parses_quoted_arguments() {
        let a = assess(r#"git commit -m "fix the duty system""#).unwrap();
        assert_eq!(a.program, "git");
        assert_eq!(a.args, vec!["commit", "-m", "fix the duty system"]);
        assert_eq!(a.command, r#"git commit -m "fix the duty system""#);
        assert!(assess(r#"git commit -m "unbalanced"#).is_err());
        assert!(assess("   ").is_err());
    }

    #[test]
    fn windows_paths_keep_their_backslashes() {
        let a = assess(r"node C:\Projects\app\server.js").unwrap();
        assert_eq!(a.args, vec![r"C:\Projects\app\server.js"]);
        let b = assess(r#""C:\Program Files\nodejs\node.exe" --version"#).unwrap();
        assert_eq!(b.program, r"C:\Program Files\nodejs\node.exe");
        assert_eq!(
            risk(r"C:\Windows\System32\cmd.exe /c echo"),
            RiskLevel::Blocked
        );
        assert_eq!(
            risk(r#""C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe""#),
            RiskLevel::Blocked
        );
        assert_eq!(
            risk(r"C:WindowsSystem32cmd.exe /c dir"),
            RiskLevel::Blocked,
            "drive-relative"
        );
        assert!(is_blocked_executable(std::path::Path::new(
            r"C:\Windows\System32\cmd.exe"
        )));
        assert!(is_blocked_executable(std::path::Path::new(
            r"C:\tools\RM.EXE"
        )));
        assert!(!is_blocked_executable(std::path::Path::new(
            r"C:\Program Files\nodejs\node.exe"
        )));
    }
}
