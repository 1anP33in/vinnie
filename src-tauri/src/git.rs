//! Read-only Git awareness: repository detection, branch, and changed files.
//! Vinnie never commits, pushes, resets, or checks out on its own.

use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::process::hidden_command;
use crate::workspace::Workspace;

const MAX_LISTED: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    /// False when the `git` executable is not installed.
    pub git_available: bool,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub modified: Vec<String>,
    pub staged: Vec<String>,
    pub untracked: Vec<String>,
    pub deleted: Vec<String>,
    pub truncated: bool,
}

/// Parse `git status --porcelain=v1 -b` output.
pub fn parse_porcelain(output: &str) -> GitStatus {
    let mut status = GitStatus {
        is_repo: true,
        git_available: true,
        ..Default::default()
    };
    let mut count = 0;
    for line in output.lines() {
        if let Some(header) = line.strip_prefix("## ") {
            let (branch_part, tracking) = match header.split_once(" [") {
                Some((b, t)) => (b, Some(t.trim_end_matches(']'))),
                None => (header, None),
            };
            if let Some(name) = branch_part.strip_prefix("No commits yet on ") {
                status.branch = Some(name.to_string());
            } else if branch_part.starts_with("HEAD (no branch)") {
                status.branch = None;
            } else {
                let (local, upstream) = match branch_part.split_once("...") {
                    Some((l, u)) => (l, Some(u.to_string())),
                    None => (branch_part, None),
                };
                status.branch = Some(local.to_string());
                status.upstream = upstream;
            }
            for part in tracking.unwrap_or("").split(", ") {
                if let Some(n) = part.strip_prefix("ahead ") {
                    status.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix("behind ") {
                    status.behind = n.parse().unwrap_or(0);
                }
            }
            continue;
        }
        if line.len() < 4 {
            continue;
        }
        count += 1;
        if count > MAX_LISTED {
            status.truncated = true;
            continue;
        }
        let (x, y) = (line.as_bytes()[0] as char, line.as_bytes()[1] as char);
        let raw_path = &line[3..];
        let path = raw_path
            .rsplit_once(" -> ")
            .map(|(_, to)| to)
            .unwrap_or(raw_path)
            .trim_matches('"')
            .to_string();
        if x == '?' {
            status.untracked.push(path);
            continue;
        }
        if x != ' ' && x != '!' {
            status.staged.push(path.clone());
        }
        if y == 'D' || x == 'D' {
            status.deleted.push(path);
        } else if y == 'M' || x == 'M' || x == 'A' || x == 'R' {
            status.modified.push(path);
        }
    }
    status
}

/// Query Git for the workspace. Blocking (bounded by a short timeout).
pub fn status(ws: &Workspace) -> GitStatus {
    let child = hidden_command("git")
        .arg("-C")
        .arg(ws.root())
        .args(["status", "--porcelain=v1", "-b", "--untracked-files=normal"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let Ok(mut child) = child else {
        return GitStatus::default(); // git not installed
    };
    let deadline = std::time::Instant::now() + Duration::from_secs(8);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25));
            }
            _ => {
                let _ = child.kill();
                log::warn!("git status timed out");
                return GitStatus {
                    git_available: true,
                    ..Default::default()
                };
            }
        }
    }
    let Ok(output) = child.wait_with_output() else {
        return GitStatus {
            git_available: true,
            ..Default::default()
        };
    };
    if !output.status.success() {
        // Not a repository (or git refused, e.g. dubious ownership).
        return GitStatus {
            git_available: true,
            ..Default::default()
        };
    }
    parse_porcelain(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_tracking_and_files() {
        let out = "## main...origin/main [ahead 2, behind 1]\n M src/a.lua\nM  staged.ts\nA  new.ts\n D gone.txt\n?? scratch.txt\nR  old.ts -> renamed.ts\n";
        let s = parse_porcelain(out);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (2, 1));
        assert_eq!(
            s.modified,
            vec!["src/a.lua", "staged.ts", "new.ts", "renamed.ts"]
        );
        assert_eq!(s.staged, vec!["staged.ts", "new.ts", "renamed.ts"]);
        assert_eq!(s.deleted, vec!["gone.txt"]);
        assert_eq!(s.untracked, vec!["scratch.txt"]);
    }

    #[test]
    fn parses_new_and_detached_repositories() {
        assert_eq!(
            parse_porcelain("## No commits yet on master\n")
                .branch
                .as_deref(),
            Some("master")
        );
        assert_eq!(parse_porcelain("## HEAD (no branch)\n").branch, None);
    }

    #[test]
    fn reports_non_repositories() {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace::open(dir.path()).unwrap();
        let s = status(&ws);
        assert!(!s.is_repo);
    }

    #[test]
    fn reads_a_real_repository() {
        let dir = tempfile::tempdir().unwrap();
        let ok = hidden_command("git")
            .arg("init")
            .arg("-q")
            .arg(dir.path())
            .status();
        if !ok.is_ok_and(|s| s.success()) {
            return; // git not installed on this machine
        }
        std::fs::write(dir.path().join("new.txt"), "x").unwrap();
        let ws = Workspace::open(dir.path()).unwrap();
        let s = status(&ws);
        assert!(s.is_repo);
        assert!(s.branch.is_some());
        assert_eq!(s.untracked, vec!["new.txt"]);
    }
}
