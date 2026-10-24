//! File service: listing, reading, and writing inside the workspace.
//!
//! All functions take workspace-relative paths, resolve them through
//! [`Workspace`], and return structured results. Change tracking (snapshots,
//! diffs, revert) is layered on top in `crate::changes`.

use std::io::Read;
use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::ignore_rules::IgnoreRules;
use super::{display_rel, Workspace};
use crate::error::{AppError, AppResult};

/// Largest file the editor or model will load as text.
pub const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// Largest content accepted by a write.
pub const MAX_WRITE_BYTES: usize = 5 * 1024 * 1024;
/// Largest number of entries returned for one directory.
pub const MAX_DIR_ENTRIES: usize = 5_000;
const BINARY_SNIFF_BYTES: usize = 8_000;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    File,
    Directory,
    /// Symlink or junction; shown but never followed by the explorer.
    Link,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    pub size: Option<u64>,
    /// Excluded by the ignore rules (shown dimmed, not expanded by default).
    pub ignored: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub path: String,
    pub entries: Vec<DirEntry>,
    pub truncated: bool,
}

/// Identity of a file's current contents, used to detect external edits.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub size: u64,
    pub modified_ms: i64,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    /// `None` when the file is binary or too large.
    pub content: Option<String>,
    pub binary: bool,
    pub too_large: bool,
    pub version: FileVersion,
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn modified_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// Decode bytes as UTF-8 text, or `None` if they look binary.
pub fn decode_text(bytes: &[u8]) -> Option<String> {
    let sniff = &bytes[..bytes.len().min(BINARY_SNIFF_BYTES)];
    if sniff.contains(&0) {
        return None;
    }
    let without_bom = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    String::from_utf8(without_bom.to_vec()).ok()
}

fn version_of(path: &Path, bytes: &[u8]) -> AppResult<FileVersion> {
    let meta = std::fs::metadata(path)?;
    Ok(FileVersion {
        size: meta.len(),
        modified_ms: modified_ms(&meta),
        hash: hash_bytes(bytes),
    })
}

pub fn list_dir(ws: &Workspace, rel: &str, ignore: &IgnoreRules) -> AppResult<DirListing> {
    let dir = ws.resolve_existing(rel)?;
    if !dir.is_dir() {
        return Err(AppError::validation(format!(
            "{} is not a folder.",
            display_rel(rel)
        )));
    }
    let reader = std::fs::read_dir(&dir).map_err(|e| AppError::io(&display_rel(rel), &e))?;
    let mut entries = Vec::new();
    let mut truncated = false;
    for item in reader {
        let Ok(item) = item else { continue };
        if entries.len() >= MAX_DIR_ENTRIES {
            truncated = true;
            break;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        let Ok(meta) = std::fs::symlink_metadata(item.path()) else {
            continue;
        };
        let kind = if meta.file_type().is_symlink() {
            EntryKind::Link
        } else if meta.is_dir() {
            EntryKind::Directory
        } else {
            EntryKind::File
        };
        entries.push(DirEntry {
            path: ws.to_relative(&item.path()),
            ignored: kind == EntryKind::Directory && ignore.is_ignored_dir(&name),
            size: (kind == EntryKind::File).then_some(meta.len()),
            name,
            kind,
        });
    }
    entries.sort_by(|a, b| {
        let a_dir = a.kind == EntryKind::Directory;
        let b_dir = b.kind == EntryKind::Directory;
        b_dir
            .cmp(&a_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(DirListing {
        path: ws.to_relative(&dir),
        entries,
        truncated,
    })
}

pub fn stat(ws: &Workspace, rel: &str) -> AppResult<FileVersion> {
    let path = ws.resolve_existing(rel)?;
    if !path.is_file() {
        return Err(AppError::validation(format!(
            "{} is not a file.",
            display_rel(rel)
        )));
    }
    let bytes = read_capped(&path, rel, MAX_TEXT_FILE_BYTES * 4)?;
    version_of(&path, &bytes)
}

fn read_capped(path: &Path, rel: &str, cap: u64) -> AppResult<Vec<u8>> {
    let file = std::fs::File::open(path).map_err(|e| AppError::io(&display_rel(rel), &e))?;
    let mut bytes = Vec::new();
    file.take(cap)
        .read_to_end(&mut bytes)
        .map_err(|e| AppError::io(&display_rel(rel), &e))?;
    Ok(bytes)
}

/// Read raw bytes (for snapshots). Errors if the file exceeds `cap`.
pub fn read_bytes(ws: &Workspace, rel: &str, cap: u64) -> AppResult<Vec<u8>> {
    let path = ws.resolve_existing(rel)?;
    let meta = std::fs::metadata(&path).map_err(|e| AppError::io(&display_rel(rel), &e))?;
    if !meta.is_file() {
        return Err(AppError::validation(format!(
            "{} is not a file.",
            display_rel(rel)
        )));
    }
    if meta.len() > cap {
        return Err(AppError::validation(format!(
            "{} is too large ({} MB) for Vinnie to snapshot.",
            display_rel(rel),
            meta.len() / (1024 * 1024)
        )));
    }
    read_capped(&path, rel, cap)
}

/// Read a file as text. Binary and oversized files return metadata only.
pub fn read_file(ws: &Workspace, rel: &str, max_bytes: u64) -> AppResult<FileContent> {
    let path = ws.resolve_existing(rel)?;
    let meta = std::fs::metadata(&path).map_err(|e| AppError::io(&display_rel(rel), &e))?;
    if !meta.is_file() {
        return Err(AppError::validation(format!(
            "{} is not a file.",
            display_rel(rel)
        )));
    }
    let relative = ws.to_relative(&path);
    if meta.len() > max_bytes {
        return Ok(FileContent {
            path: relative,
            content: None,
            binary: false,
            too_large: true,
            version: FileVersion {
                size: meta.len(),
                modified_ms: modified_ms(&meta),
                hash: String::new(),
            },
        });
    }
    let bytes = read_capped(&path, rel, max_bytes)?;
    let version = version_of(&path, &bytes)?;
    let content = decode_text(&bytes);
    Ok(FileContent {
        path: relative,
        binary: content.is_none(),
        content,
        too_large: false,
        version,
    })
}

/// Current content hash, or `None` if the file does not exist.
pub fn current_hash(ws: &Workspace, rel: &str) -> AppResult<Option<String>> {
    let path = ws.resolve(rel)?;
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = read_capped(&path, rel, MAX_TEXT_FILE_BYTES * 16)?;
    Ok(Some(hash_bytes(&bytes)))
}

/// Write bytes atomically (temp file + rename) so readers never see a
/// half-written file.
fn atomic_write(path: &Path, rel: &str, bytes: &[u8]) -> AppResult<()> {
    let dir = path
        .parent()
        .ok_or_else(|| AppError::validation("Cannot write to the project root itself."))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = dir.join(format!(
        ".{name}.vinnie-{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&tmp, bytes).map_err(|e| AppError::io(&display_rel(rel), &e))?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::io(&display_rel(rel), &e));
    }
    Ok(())
}

fn ensure_parent(ws: &Workspace, path: &Path, rel: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        // `resolve` already proved the deepest existing ancestor is inside.
        std::fs::create_dir_all(parent).map_err(|e| AppError::io(&display_rel(rel), &e))?;
        let canonical = dunce::canonicalize(parent)?;
        if !canonical.starts_with(ws.root()) {
            return Err(AppError::forbidden(
                "That path resolves outside the project folder.",
            ));
        }
    }
    Ok(())
}

/// Overwrite (or create) a file. With `expected_hash`, fails with a conflict
/// if the file changed since it was read.
pub fn write_bytes(
    ws: &Workspace,
    rel: &str,
    bytes: &[u8],
    expected_hash: Option<&str>,
) -> AppResult<FileVersion> {
    if bytes.len() > MAX_WRITE_BYTES {
        return Err(AppError::validation(
            "That content is too large to write (5 MB limit).",
        ));
    }
    let path = ws.resolve(rel)?;
    if parse_is_root(rel) {
        return Err(AppError::validation("A file path is required."));
    }
    if path.is_dir() {
        return Err(AppError::validation(format!(
            "{} is a folder.",
            display_rel(rel)
        )));
    }
    if let Some(expected) = expected_hash {
        let current = current_hash(ws, rel)?;
        if current.as_deref() != Some(expected) {
            return Err(AppError::conflict(format!(
                "{} was changed outside Vinnie since it was opened.",
                display_rel(rel)
            )));
        }
    }
    ensure_parent(ws, &path, rel)?;
    atomic_write(&path, rel, bytes)?;
    version_of(&path, bytes)
}

fn parse_is_root(rel: &str) -> bool {
    super::parse_relative(rel)
        .map(|p| p.is_empty())
        .unwrap_or(false)
}

/// Create a new file; fails if it already exists.
pub fn create_file(ws: &Workspace, rel: &str, bytes: &[u8]) -> AppResult<FileVersion> {
    let path = ws.resolve(rel)?;
    if parse_is_root(rel) {
        return Err(AppError::validation("A file path is required."));
    }
    if path.exists() {
        return Err(AppError::validation(format!(
            "{} already exists.",
            display_rel(rel)
        )));
    }
    write_bytes(ws, rel, bytes, None)
}

pub fn create_dir(ws: &Workspace, rel: &str) -> AppResult<()> {
    let path = ws.resolve(rel)?;
    if path.exists() {
        return Err(AppError::validation(format!(
            "{} already exists.",
            display_rel(rel)
        )));
    }
    std::fs::create_dir_all(&path).map_err(|e| AppError::io(&display_rel(rel), &e))?;
    ensure_parent(ws, &path.join("x"), rel)
}

/// Delete a file or an empty folder. Never deletes the workspace root or
/// non-empty folders.
pub fn delete_path(ws: &Workspace, rel: &str) -> AppResult<()> {
    if parse_is_root(rel) {
        return Err(AppError::forbidden(
            "The project folder itself cannot be deleted.",
        ));
    }
    let path = ws.resolve_existing(rel)?;
    let meta = std::fs::symlink_metadata(&path).map_err(|e| AppError::io(&display_rel(rel), &e))?;
    if meta.is_dir() && !meta.file_type().is_symlink() {
        let empty = std::fs::read_dir(&path)
            .map_err(|e| AppError::io(&display_rel(rel), &e))?
            .next()
            .is_none();
        if !empty {
            return Err(AppError::validation(format!(
                "{} is not empty. Only files and empty folders can be deleted.",
                display_rel(rel)
            )));
        }
        std::fs::remove_dir(&path).map_err(|e| AppError::io(&display_rel(rel), &e))
    } else if meta.is_dir() {
        std::fs::remove_dir(&path).map_err(|e| AppError::io(&display_rel(rel), &e))
    } else {
        std::fs::remove_file(&path).map_err(|e| AppError::io(&display_rel(rel), &e))
    }
}

/// Move or rename a file or folder. Never overwrites an existing target.
pub fn move_path(ws: &Workspace, from: &str, to: &str) -> AppResult<()> {
    if parse_is_root(from) || parse_is_root(to) {
        return Err(AppError::forbidden(
            "The project folder itself cannot be moved.",
        ));
    }
    let source = ws.resolve_existing(from)?;
    let target = ws.resolve(to)?;
    if target.exists() {
        return Err(AppError::validation(format!(
            "{} already exists.",
            display_rel(to)
        )));
    }
    if source.is_dir() && target.starts_with(&source) {
        return Err(AppError::validation(
            "A folder cannot be moved into itself.",
        ));
    }
    ensure_parent(ws, &target, to)?;
    std::fs::rename(&source, &target).map_err(|e| AppError::io(&display_rel(from), &e))
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTree {
    /// Indented text tree, e.g. `client/` then `  main.lua`.
    pub text: String,
    pub entries: usize,
    pub truncated: bool,
}

/// Render a bounded, indented tree of the workspace (for model context).
/// Ignored folders are listed but not expanded.
pub fn tree(
    ws: &Workspace,
    rel: &str,
    ignore: &IgnoreRules,
    max_depth: usize,
    max_entries: usize,
) -> AppResult<ProjectTree> {
    fn walk(
        ws: &Workspace,
        rel: &str,
        ignore: &IgnoreRules,
        depth: usize,
        max_depth: usize,
        max_entries: usize,
        out: &mut ProjectTree,
    ) -> AppResult<()> {
        let listing = list_dir(ws, rel, ignore)?;
        for entry in listing.entries {
            if out.entries >= max_entries {
                out.truncated = true;
                return Ok(());
            }
            out.entries += 1;
            let indent = "  ".repeat(depth);
            match entry.kind {
                EntryKind::Directory if entry.ignored => {
                    out.text
                        .push_str(&format!("{indent}{}/ (ignored)\n", entry.name));
                }
                EntryKind::Directory => {
                    out.text.push_str(&format!("{indent}{}/\n", entry.name));
                    if depth + 1 < max_depth {
                        walk(
                            ws,
                            &entry.path,
                            ignore,
                            depth + 1,
                            max_depth,
                            max_entries,
                            out,
                        )?;
                    } else {
                        out.text.push_str(&format!("{indent}  …\n"));
                    }
                }
                _ => out.text.push_str(&format!("{indent}{}\n", entry.name)),
            }
        }
        if listing.truncated {
            out.truncated = true;
        }
        Ok(())
    }
    let mut out = ProjectTree {
        text: String::new(),
        entries: 0,
        truncated: false,
    };
    walk(
        ws,
        rel,
        ignore,
        0,
        max_depth.clamp(1, 8),
        max_entries.clamp(1, 2000),
        &mut out,
    )?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorKind;

    #[test]
    fn renders_a_bounded_tree() {
        let (_d, ws) = ws();
        let t = tree(&ws, "", &IgnoreRules::default(), 3, 100).unwrap();
        assert_eq!(
            t.text,
            "client/\n  client.lua\nnode_modules/ (ignored)\nfxmanifest.lua\nREADME.md\n"
        );
        let small = tree(&ws, "", &IgnoreRules::default(), 3, 2).unwrap();
        assert!(small.truncated);
        assert_eq!(small.entries, 2);
    }

    fn ws() -> (tempfile::TempDir, Workspace) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("client")).unwrap();
        std::fs::create_dir_all(dir.path().join("node_modules/pkg")).unwrap();
        std::fs::write(dir.path().join("client/client.lua"), "print('client')\n").unwrap();
        std::fs::write(dir.path().join("fxmanifest.lua"), "fx_version 'cerulean'\n").unwrap();
        std::fs::write(dir.path().join("README.md"), "# Readme\n").unwrap();
        let ws = Workspace::open(dir.path()).unwrap();
        (dir, ws)
    }

    #[test]
    fn lists_directories_first_and_flags_ignored() {
        let (_d, ws) = ws();
        let listing = list_dir(&ws, "", &IgnoreRules::default()).unwrap();
        let names: Vec<_> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["client", "node_modules", "fxmanifest.lua", "README.md"]
        );
        assert!(listing.entries[1].ignored);
        assert!(!listing.entries[0].ignored);
        assert_eq!(listing.entries[2].path, "fxmanifest.lua");
        let nested = list_dir(&ws, "client", &IgnoreRules::default()).unwrap();
        assert_eq!(nested.entries[0].path, "client/client.lua");
    }

    #[test]
    fn reads_text_files_with_version() {
        let (_d, ws) = ws();
        let file = read_file(&ws, "client/client.lua", MAX_TEXT_FILE_BYTES).unwrap();
        assert_eq!(file.content.as_deref(), Some("print('client')\n"));
        assert!(!file.binary);
        assert_eq!(file.version.hash, hash_bytes(b"print('client')\n"));
    }

    #[test]
    fn detects_binary_and_large_files() {
        let (d, ws) = ws();
        std::fs::write(
            d.path().join("image.png"),
            [0x89, b'P', b'N', b'G', 0, 1, 2],
        )
        .unwrap();
        let bin = read_file(&ws, "image.png", MAX_TEXT_FILE_BYTES).unwrap();
        assert!(bin.binary);
        assert!(bin.content.is_none());

        std::fs::write(d.path().join("big.txt"), "x".repeat(100)).unwrap();
        let big = read_file(&ws, "big.txt", 10).unwrap();
        assert!(big.too_large);
        assert!(big.content.is_none());
    }

    #[test]
    fn strips_utf8_bom() {
        let (d, ws) = ws();
        std::fs::write(d.path().join("bom.txt"), b"\xEF\xBB\xBFhello").unwrap();
        assert_eq!(
            read_file(&ws, "bom.txt", 100).unwrap().content.as_deref(),
            Some("hello")
        );
    }

    #[test]
    fn creates_writes_and_detects_conflicts() {
        let (d, ws) = ws();
        create_file(&ws, "shared/config.lua", b"Config = {}\n").unwrap();
        assert_eq!(
            std::fs::read_to_string(d.path().join("shared/config.lua")).unwrap(),
            "Config = {}\n"
        );
        assert_eq!(
            create_file(&ws, "shared/config.lua", b"x")
                .unwrap_err()
                .kind,
            ErrorKind::Validation
        );

        let original = read_file(&ws, "shared/config.lua", MAX_TEXT_FILE_BYTES).unwrap();
        write_bytes(
            &ws,
            "shared/config.lua",
            b"Config = { a = 1 }\n",
            Some(&original.version.hash),
        )
        .unwrap();
        // A second write with the stale hash must be rejected.
        let err = write_bytes(
            &ws,
            "shared/config.lua",
            b"lost",
            Some(&original.version.hash),
        )
        .unwrap_err();
        assert_eq!(err.kind, ErrorKind::Conflict);
        assert_eq!(
            std::fs::read_to_string(d.path().join("shared/config.lua")).unwrap(),
            "Config = { a = 1 }\n"
        );
        // No temp files are left behind.
        let leftovers = std::fs::read_dir(d.path().join("shared")).unwrap().count();
        assert_eq!(leftovers, 1);
    }

    #[test]
    fn writes_cannot_escape_the_workspace() {
        let (d, ws) = ws();
        let err = write_bytes(&ws, "../escaped.txt", b"x", None).unwrap_err();
        assert_eq!(err.kind, ErrorKind::Forbidden);
        assert!(!d.path().parent().unwrap().join("escaped.txt").exists());
        assert_eq!(
            create_file(&ws, "a/../../b.txt", b"x").unwrap_err().kind,
            ErrorKind::Forbidden
        );
    }

    #[test]
    fn deletes_files_and_empty_folders_only() {
        let (d, ws) = ws();
        delete_path(&ws, "README.md").unwrap();
        assert!(!d.path().join("README.md").exists());
        assert_eq!(
            delete_path(&ws, "client").unwrap_err().kind,
            ErrorKind::Validation
        );
        assert_eq!(delete_path(&ws, "").unwrap_err().kind, ErrorKind::Forbidden);
        assert_eq!(
            delete_path(&ws, "..").unwrap_err().kind,
            ErrorKind::Forbidden
        );
        create_dir(&ws, "empty").unwrap();
        delete_path(&ws, "empty").unwrap();
        assert_eq!(
            delete_path(&ws, "missing.txt").unwrap_err().kind,
            ErrorKind::NotFound
        );
    }

    #[test]
    fn moves_and_renames_without_overwriting() {
        let (d, ws) = ws();
        move_path(&ws, "README.md", "docs/README.md").unwrap();
        assert!(d.path().join("docs/README.md").exists());
        assert_eq!(
            move_path(&ws, "fxmanifest.lua", "docs/README.md")
                .unwrap_err()
                .kind,
            ErrorKind::Validation
        );
        assert_eq!(
            move_path(&ws, "client", "client/inner").unwrap_err().kind,
            ErrorKind::Validation
        );
        assert_eq!(
            move_path(&ws, "fxmanifest.lua", "../fx.lua")
                .unwrap_err()
                .kind,
            ErrorKind::Forbidden
        );
    }
}
