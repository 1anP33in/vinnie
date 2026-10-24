//! Workspace boundary enforcement.
//!
//! Every filesystem operation receives a path *relative to the selected
//! project root* and resolves it through [`Workspace`]. Resolution:
//!
//! 1. rejects absolute paths, drive letters, `..`, alternate data streams,
//!    and Windows reserved device names before touching the disk;
//! 2. canonicalizes the deepest existing ancestor (which resolves symlinks
//!    and junctions) and requires it to stay inside the canonical root.
//!
//! The other workspace services build on this module and never accept
//! absolute paths from the frontend.

pub mod fs;
pub mod ignore_rules;
pub mod search;

use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult, ErrorKind};

const MAX_RELATIVE_PATH_CHARS: usize = 1024;

const RESERVED_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9", "conin$",
    "conout$",
];

#[derive(Debug, Clone)]
pub struct Workspace {
    root: PathBuf,
}

/// Split and validate a workspace-relative path without touching the disk.
pub fn parse_relative(rel: &str) -> AppResult<Vec<String>> {
    let rel = rel.trim();
    if rel.chars().count() > MAX_RELATIVE_PATH_CHARS {
        return Err(AppError::validation("That path is too long."));
    }
    if rel.chars().any(|c| c.is_control()) {
        return Err(AppError::forbidden(
            "Paths cannot contain control characters.",
        ));
    }
    let normalized = rel.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err(AppError::forbidden(
            "Absolute paths are not allowed; use a path relative to the project folder.",
        ));
    }
    if normalized.contains(':') {
        return Err(AppError::forbidden(
            "Drive letters and ':' are not allowed in project paths.",
        ));
    }

    let mut parts = Vec::new();
    for part in normalized.split('/') {
        match part {
            "" | "." => continue,
            ".." => {
                return Err(AppError::forbidden(
                    "Paths cannot use '..' to leave the project folder.",
                ))
            }
            _ => {}
        }
        if part.ends_with('.') || part.ends_with(' ') {
            return Err(AppError::validation(format!(
                "\"{part}\" is not a valid Windows file name (it ends with a dot or space)."
            )));
        }
        if part
            .chars()
            .any(|c| matches!(c, '<' | '>' | '"' | '|' | '?' | '*'))
        {
            return Err(AppError::validation(format!(
                "\"{part}\" contains characters Windows does not allow in file names."
            )));
        }
        let stem = part.split('.').next().unwrap_or(part).to_ascii_lowercase();
        if RESERVED_NAMES.contains(&stem.as_str()) {
            return Err(AppError::forbidden(format!(
                "\"{part}\" is a reserved Windows device name."
            )));
        }
        parts.push(part.to_string());
    }
    Ok(parts)
}

impl Workspace {
    /// Open a workspace rooted at an existing directory.
    pub fn open(root: &Path) -> AppResult<Self> {
        let canonical = dunce::canonicalize(root).map_err(|_| {
            AppError::new(
                ErrorKind::NoWorkspace,
                "The project folder is no longer available. Choose it again from the sidebar.",
            )
        })?;
        if !canonical.is_dir() {
            return Err(AppError::new(
                ErrorKind::NoWorkspace,
                "The project path is not a folder.",
            ));
        }
        Ok(Self { root: canonical })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn name(&self) -> String {
        self.root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.root.display().to_string())
    }

    fn ensure_inside(&self, canonical: &Path) -> AppResult<()> {
        if canonical.starts_with(&self.root) {
            Ok(())
        } else {
            log::warn!("blocked path outside workspace (resolved via link or traversal)");
            Err(AppError::forbidden(
                "That path resolves outside the project folder.",
            ))
        }
    }

    /// Resolve a relative path that may or may not exist yet. The deepest
    /// existing ancestor must canonicalize inside the workspace, so links
    /// cannot be used to escape it.
    pub fn resolve(&self, rel: &str) -> AppResult<PathBuf> {
        let parts = parse_relative(rel)?;
        let mut path = self.root.clone();
        for part in &parts {
            path.push(part);
        }

        // Walk up to the deepest component that exists and verify it.
        let mut existing = path.clone();
        let mut missing: Vec<std::ffi::OsString> = Vec::new();
        loop {
            match dunce::canonicalize(&existing) {
                Ok(canonical) => {
                    self.ensure_inside(&canonical)?;
                    let mut resolved = canonical;
                    for part in missing.iter().rev() {
                        resolved.push(part);
                    }
                    return Ok(resolved);
                }
                Err(_) => {
                    let Some(name) = existing.file_name().map(|n| n.to_os_string()) else {
                        return Err(AppError::forbidden(
                            "That path is outside the project folder.",
                        ));
                    };
                    missing.push(name);
                    if !existing.pop() {
                        return Err(AppError::forbidden(
                            "That path is outside the project folder.",
                        ));
                    }
                }
            }
        }
    }

    /// Resolve a relative path that must already exist.
    pub fn resolve_existing(&self, rel: &str) -> AppResult<PathBuf> {
        let path = self.resolve(rel)?;
        if !path.exists() && std::fs::symlink_metadata(&path).is_err() {
            return Err(AppError::not_found(format!(
                "{} does not exist.",
                display_rel(rel)
            )));
        }
        Ok(path)
    }

    /// Convert an absolute path inside the workspace back to a relative,
    /// forward-slash path.
    pub fn to_relative(&self, abs: &Path) -> String {
        let stripped = abs.strip_prefix(&self.root).unwrap_or(abs);
        stripped
            .components()
            .filter_map(|c| match c {
                Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("/")
    }
}

/// Normalized relative path for messages ("" becomes the project root).
pub fn display_rel(rel: &str) -> String {
    let normalized = rel.trim().replace('\\', "/");
    let trimmed = normalized.trim_matches('/');
    if trimmed.is_empty() {
        "the project folder".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws() -> (tempfile::TempDir, Workspace) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("src/nested")).unwrap();
        std::fs::write(dir.path().join("src/main.lua"), "print('hi')").unwrap();
        let ws = Workspace::open(dir.path()).unwrap();
        (dir, ws)
    }

    #[test]
    fn resolves_paths_inside_the_workspace() {
        let (_d, ws) = ws();
        let p = ws.resolve_existing("src/main.lua").unwrap();
        assert!(p.starts_with(ws.root()));
        assert_eq!(ws.to_relative(&p), "src/main.lua");
        assert_eq!(
            ws.resolve("src\\main.lua").unwrap(),
            p,
            "backslashes are accepted"
        );
        assert_eq!(ws.resolve("./src/./main.lua").unwrap(), p);
        assert_eq!(ws.resolve("").unwrap(), ws.root());
    }

    #[test]
    fn resolves_new_paths_for_creation() {
        let (_d, ws) = ws();
        let p = ws.resolve("src/new/dir/file.ts").unwrap();
        assert!(p.starts_with(ws.root()));
        assert!(!p.exists());
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        let (_d, ws) = ws();
        for bad in [
            "../outside.txt",
            "src/../../outside.txt",
            "..\\..\\Windows\\System32",
            "src/nested/../../../x",
            "/etc/passwd",
            "\\Windows\\win.ini",
            "C:\\Windows\\win.ini",
            "C:/Windows",
            "file.txt:secret",
        ] {
            let err = ws.resolve(bad).unwrap_err();
            assert_eq!(err.kind, ErrorKind::Forbidden, "{bad} should be forbidden");
        }
    }

    #[test]
    fn rejects_reserved_and_invalid_names() {
        let (_d, ws) = ws();
        assert_eq!(ws.resolve("con").unwrap_err().kind, ErrorKind::Forbidden);
        assert_eq!(
            ws.resolve("src/NUL.txt").unwrap_err().kind,
            ErrorKind::Forbidden
        );
        assert_eq!(
            ws.resolve("bad?.txt").unwrap_err().kind,
            ErrorKind::Validation
        );
        assert_eq!(
            ws.resolve("trailing.").unwrap_err().kind,
            ErrorKind::Validation
        );
        assert!(ws.resolve("a\u{0}b").is_err());
    }

    #[test]
    fn missing_files_are_not_found() {
        let (_d, ws) = ws();
        assert_eq!(
            ws.resolve_existing("nope.txt").unwrap_err().kind,
            ErrorKind::NotFound
        );
    }

    #[cfg(windows)]
    #[test]
    fn junctions_cannot_escape_the_workspace() {
        let (_d, ws) = ws();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "secret").unwrap();
        let link = ws.root().join("escape");
        // Directory junctions need no special privileges on Windows.
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(status.status.success(), "mklink failed: {status:?}");
        let err = ws.resolve("escape/secret.txt").unwrap_err();
        assert_eq!(err.kind, ErrorKind::Forbidden);
        let err = ws.resolve("escape/new.txt").unwrap_err();
        assert_eq!(err.kind, ErrorKind::Forbidden);
        std::fs::remove_dir(&link).unwrap();
    }
}
