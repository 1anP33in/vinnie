//! Active project folder.
//!
//! Phase 1 only records which folder is active and reports whether it is
//! still available. It never reads, writes, or scans the folder's contents.
//! Indexing and file access will be added behind this module in Phase 2.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;

use crate::db::kv;
use crate::error::{AppError, AppResult};

const PROJECT_KEY: &str = "project_path";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProjectStatus {
    Available,
    /// The folder was moved or deleted since it was selected.
    Missing,
    /// The path exists but is not a directory.
    NotADirectory,
    /// The path exists but cannot be accessed.
    Inaccessible,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub status: ProjectStatus,
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        // Drive roots such as `C:\` have no file name.
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// Report a folder's status using metadata only.
pub fn inspect(path: &Path) -> ProjectInfo {
    let status = match std::fs::metadata(path) {
        Ok(meta) if meta.is_dir() => ProjectStatus::Available,
        Ok(_) => ProjectStatus::NotADirectory,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => ProjectStatus::Missing,
        Err(_) => ProjectStatus::Inaccessible,
    };
    ProjectInfo {
        path: path.to_string_lossy().into_owned(),
        name: display_name(path),
        status,
    }
}

/// Validate a newly selected folder before it becomes the active project.
pub fn validate_selection(path: &Path) -> AppResult<PathBuf> {
    if !path.is_absolute() {
        return Err(AppError::validation(
            "The project folder path must be absolute.",
        ));
    }
    let info = inspect(path);
    match info.status {
        ProjectStatus::Available => Ok(path.to_path_buf()),
        ProjectStatus::Missing => Err(AppError::validation("That folder does not exist.")),
        ProjectStatus::NotADirectory => {
            Err(AppError::validation("Please choose a folder, not a file."))
        }
        ProjectStatus::Inaccessible => {
            Err(AppError::validation("Vinnie cannot access that folder."))
        }
    }
}

pub fn load(conn: &Connection) -> AppResult<Option<ProjectInfo>> {
    Ok(kv::get(conn, PROJECT_KEY)?.map(|p| inspect(Path::new(&p))))
}

pub fn set(conn: &Connection, path: &Path) -> AppResult<ProjectInfo> {
    let path = validate_selection(path)?;
    let as_str = path
        .to_str()
        .ok_or_else(|| AppError::validation("The folder path contains unsupported characters."))?;
    kv::set(conn, PROJECT_KEY, as_str)?;
    Ok(inspect(&path))
}

pub fn clear(conn: &Connection) -> AppResult<()> {
    kv::delete(conn, PROJECT_KEY)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn select_persist_and_restore() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        assert_eq!(load(&conn).unwrap(), None);

        let info = set(&conn, dir.path()).unwrap();
        assert_eq!(info.status, ProjectStatus::Available);
        assert_eq!(info.name, dir.path().file_name().unwrap().to_string_lossy());
        assert_eq!(load(&conn).unwrap(), Some(info));
    }

    #[test]
    fn selection_does_not_touch_folder_contents() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        set(&conn, dir.path()).unwrap();
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn moved_or_deleted_folder_is_reported_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_path_buf();
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        set(&conn, &path).unwrap();
        drop(dir); // deletes the folder
        let restored = load(&conn).unwrap().unwrap();
        assert_eq!(restored.status, ProjectStatus::Missing);
        assert_eq!(restored.path, path.to_string_lossy());
    }

    #[test]
    fn rejects_files_relative_and_missing_paths() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("file.txt");
        std::fs::write(&file, "x").unwrap();
        assert!(validate_selection(&file).is_err());
        assert!(validate_selection(Path::new("relative/path")).is_err());
        assert!(validate_selection(&dir.path().join("nope")).is_err());
    }

    #[test]
    fn changing_and_clearing_project() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        set(&conn, a.path()).unwrap();
        set(&conn, b.path()).unwrap();
        assert_eq!(
            load(&conn).unwrap().unwrap().path,
            b.path().to_string_lossy()
        );
        clear(&conn).unwrap();
        assert_eq!(load(&conn).unwrap(), None);
    }
}
