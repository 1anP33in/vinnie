//! Change manager: every file modification made through Vinnie is recorded
//! with before/after snapshots so it can be inspected and reverted.
//!
//! ```text
//! original file -> snapshot -> apply -> diff -> history (revert later)
//! ```
//!
//! Snapshots live in the local SQLite database. The [`ChangeRecord`] model is
//! independent of storage, so a Git-backed store can be added later behind the
//! same commands.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use similar::TextDiff;

use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use crate::workspace::fs::{self as wsfs, decode_text, hash_bytes};
use crate::workspace::{display_rel, Workspace};

/// Largest file that can be snapshotted (and therefore modified or deleted
/// through the change manager).
pub const MAX_SNAPSHOT_BYTES: u64 = 10 * 1024 * 1024;
const MAX_DIFF_CHARS: usize = 400_000;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileOperation {
    /// Replace (or create) a file's contents.
    Write {
        path: String,
        content: String,
    },
    /// Create a new file; fails if it exists.
    Create {
        path: String,
        content: String,
    },
    Delete {
        path: String,
    },
    Move {
        from: String,
        to: String,
    },
}

impl FileOperation {
    pub fn verb(&self) -> &'static str {
        match self {
            FileOperation::Write { .. } => "write",
            FileOperation::Create { .. } => "create",
            FileOperation::Delete { .. } => "delete",
            FileOperation::Move { .. } => "move",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Create,
    Modify,
    Delete,
    Move,
}

impl ChangeKind {
    fn as_str(self) -> &'static str {
        match self {
            ChangeKind::Create => "create",
            ChangeKind::Modify => "modify",
            ChangeKind::Delete => "delete",
            ChangeKind::Move => "move",
        }
    }
    fn parse(s: &str) -> Self {
        match s {
            "create" => ChangeKind::Create,
            "delete" => ChangeKind::Delete,
            "move" => ChangeKind::Move,
            _ => ChangeKind::Modify,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ChangeSource {
    #[default]
    User,
    Assistant,
}

impl ChangeSource {
    fn as_str(self) -> &'static str {
        match self {
            ChangeSource::User => "user",
            ChangeSource::Assistant => "assistant",
        }
    }
}

/// A computed but not yet applied change.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangePreview {
    pub kind: ChangeKind,
    pub path: String,
    pub new_path: Option<String>,
    /// Text before the change (`None` for new or binary files).
    pub before: Option<String>,
    /// Text after the change (`None` for deletions, moves, or binary files).
    pub after: Option<String>,
    pub diff: String,
    pub additions: usize,
    pub deletions: usize,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRecord {
    pub id: i64,
    pub task_id: Option<String>,
    pub source: ChangeSource,
    pub kind: ChangeKind,
    pub path: String,
    pub new_path: Option<String>,
    pub description: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub reverted_at: Option<i64>,
    pub additions: usize,
    pub deletions: usize,
}

/// A recorded change including its snapshots.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangeDetail {
    pub record: ChangeRecord,
    pub before: Option<String>,
    pub after: Option<String>,
    pub diff: String,
    pub binary: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeMeta {
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub source: ChangeSource,
    #[serde(default)]
    pub description: Option<String>,
}

/// Unified diff plus line counts.
pub fn unified_diff(path: &str, before: &str, after: &str) -> (String, usize, usize) {
    let diff = TextDiff::from_lines(before, after);
    let mut additions = 0;
    let mut deletions = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            similar::ChangeTag::Insert => additions += 1,
            similar::ChangeTag::Delete => deletions += 1,
            similar::ChangeTag::Equal => {}
        }
    }
    let mut text = diff
        .unified_diff()
        .context_radius(3)
        .header(&format!("a/{path}"), &format!("b/{path}"))
        .to_string();
    if text.len() > MAX_DIFF_CHARS {
        let mut cut = MAX_DIFF_CHARS;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
        text.push_str("\n… diff truncated …\n");
    }
    (text, additions, deletions)
}

fn snapshot(ws: &Workspace, rel: &str) -> AppResult<Option<Vec<u8>>> {
    let path = ws.resolve(rel)?;
    if !path.exists() {
        return Ok(None);
    }
    if path.is_dir() {
        return Err(AppError::validation(format!(
            "{} is a folder; only files are tracked by the change manager.",
            display_rel(rel)
        )));
    }
    wsfs::read_bytes(ws, rel, MAX_SNAPSHOT_BYTES).map(Some)
}

fn text_of(bytes: &Option<Vec<u8>>) -> (Option<String>, bool) {
    match bytes {
        None => (None, false),
        Some(b) => match decode_text(b) {
            Some(t) => (Some(t), false),
            None => (None, true),
        },
    }
}

/// Compute what an operation would do without touching the disk.
pub fn preview(ws: &Workspace, op: &FileOperation) -> AppResult<ChangePreview> {
    match op {
        FileOperation::Write { path, content } | FileOperation::Create { path, content } => {
            let before = snapshot(ws, path)?;
            if matches!(op, FileOperation::Create { .. }) && before.is_some() {
                return Err(AppError::validation(format!(
                    "{} already exists.",
                    display_rel(path)
                )));
            }
            let (before_text, binary) = text_of(&before);
            let kind = if before.is_some() {
                ChangeKind::Modify
            } else {
                ChangeKind::Create
            };
            let (diff, additions, deletions) =
                unified_diff(path, before_text.as_deref().unwrap_or(""), content);
            Ok(ChangePreview {
                kind,
                path: display_rel(path),
                new_path: None,
                before: before_text,
                after: Some(content.clone()),
                diff,
                additions,
                deletions,
                binary,
            })
        }
        FileOperation::Delete { path } => {
            let before = snapshot(ws, path)?.ok_or_else(|| {
                AppError::not_found(format!("{} does not exist.", display_rel(path)))
            })?;
            let before = Some(before);
            let (before_text, binary) = text_of(&before);
            let (diff, additions, deletions) =
                unified_diff(path, before_text.as_deref().unwrap_or(""), "");
            Ok(ChangePreview {
                kind: ChangeKind::Delete,
                path: display_rel(path),
                new_path: None,
                before: before_text,
                after: None,
                diff,
                additions,
                deletions,
                binary,
            })
        }
        FileOperation::Move { from, to } => {
            ws.resolve_existing(from)?;
            if ws.resolve(to)?.exists() {
                return Err(AppError::validation(format!(
                    "{} already exists.",
                    display_rel(to)
                )));
            }
            Ok(ChangePreview {
                kind: ChangeKind::Move,
                path: display_rel(from),
                new_path: Some(display_rel(to)),
                before: None,
                after: None,
                diff: format!(
                    "rename from {}\nrename to {}\n",
                    display_rel(from),
                    display_rel(to)
                ),
                additions: 0,
                deletions: 0,
                binary: false,
            })
        }
    }
}

/// Snapshot, apply, and record an operation.
pub fn apply(
    conn: &Connection,
    ws: &Workspace,
    op: &FileOperation,
    meta: &ChangeMeta,
    expected_hash: Option<&str>,
) -> AppResult<ChangeRecord> {
    let workspace = ws.root().display().to_string();
    let (kind, path, new_path, before, after) = match op {
        FileOperation::Write { path, content } => {
            let before = snapshot(ws, path)?;
            wsfs::write_bytes(ws, path, content.as_bytes(), expected_hash)?;
            let kind = if before.is_some() {
                ChangeKind::Modify
            } else {
                ChangeKind::Create
            };
            (kind, path, None, before, Some(content.as_bytes().to_vec()))
        }
        FileOperation::Create { path, content } => {
            wsfs::create_file(ws, path, content.as_bytes())?;
            (
                ChangeKind::Create,
                path,
                None,
                None,
                Some(content.as_bytes().to_vec()),
            )
        }
        FileOperation::Delete { path } => {
            let path_buf = ws.resolve_existing(path)?;
            if path_buf.is_dir() {
                // Empty folders are deleted without a snapshot.
                wsfs::delete_path(ws, path)?;
                return Ok(placeholder_record(path, meta));
            }
            let before = snapshot(ws, path)?;
            if let (Some(expected), Some(bytes)) = (expected_hash, &before) {
                if hash_bytes(bytes) != expected {
                    return Err(AppError::conflict(format!(
                        "{} changed since it was read.",
                        display_rel(path)
                    )));
                }
            }
            wsfs::delete_path(ws, path)?;
            (ChangeKind::Delete, path, None, before, None)
        }
        FileOperation::Move { from, to } => {
            wsfs::move_path(ws, from, to)?;
            (ChangeKind::Move, from, Some(display_rel(to)), None, None)
        }
    };

    let before_hash = before.as_deref().map(hash_bytes);
    let after_hash = after.as_deref().map(hash_bytes);
    let (additions, deletions) = match (text_of(&before).0, text_of(&after).0) {
        (b, a) if kind != ChangeKind::Move => {
            let (_, add, del) =
                unified_diff(path, b.as_deref().unwrap_or(""), a.as_deref().unwrap_or(""));
            (add, del)
        }
        _ => (0, 0),
    };
    let rel = display_rel(path);
    conn.execute(
        "INSERT INTO changes (workspace, task_id, source, kind, path, new_path, description,
            before_content, after_content, before_hash, after_hash, additions, deletions, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            workspace,
            meta.task_id,
            meta.source.as_str(),
            kind.as_str(),
            rel,
            new_path,
            meta.description,
            before,
            after,
            before_hash,
            after_hash,
            additions as i64,
            deletions as i64,
            now_ms()
        ],
    )?;
    let id = conn.last_insert_rowid();
    log::info!(
        "change {id} applied: {} {} ({:?})",
        kind.as_str(),
        rel,
        meta.source
    );
    get_record(conn, id)
}

fn placeholder_record(path: &str, meta: &ChangeMeta) -> ChangeRecord {
    ChangeRecord {
        id: 0,
        task_id: meta.task_id.clone(),
        source: meta.source,
        kind: ChangeKind::Delete,
        path: display_rel(path),
        new_path: None,
        description: meta.description.clone(),
        status: "untracked".into(),
        created_at: now_ms(),
        reverted_at: None,
        additions: 0,
        deletions: 0,
    }
}

fn map_record(row: &Row<'_>) -> rusqlite::Result<ChangeRecord> {
    let source: String = row.get("source")?;
    let kind: String = row.get("kind")?;
    Ok(ChangeRecord {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        source: if source == "assistant" {
            ChangeSource::Assistant
        } else {
            ChangeSource::User
        },
        kind: ChangeKind::parse(&kind),
        path: row.get("path")?,
        new_path: row.get("new_path")?,
        description: row.get("description")?,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        reverted_at: row.get("reverted_at")?,
        additions: row.get::<_, i64>("additions")? as usize,
        deletions: row.get::<_, i64>("deletions")? as usize,
    })
}

const RECORD_COLUMNS: &str = "id, task_id, source, kind, path, new_path, description, status,
    created_at, reverted_at, additions, deletions";

fn get_record(conn: &Connection, id: i64) -> AppResult<ChangeRecord> {
    conn.query_row(
        &format!("SELECT {RECORD_COLUMNS} FROM changes WHERE id = ?1"),
        params![id],
        map_record,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("That change no longer exists."))
}

/// Changes for a workspace, newest first. With `path`, only that file's
/// history ("previous versions").
pub fn list(
    conn: &Connection,
    ws: &Workspace,
    path: Option<&str>,
    limit: usize,
) -> AppResult<Vec<ChangeRecord>> {
    let workspace = ws.root().display().to_string();
    let limit = limit.clamp(1, 1000) as i64;
    let mut stmt;
    let rows = match path {
        Some(p) => {
            stmt = conn.prepare(&format!(
                "SELECT {RECORD_COLUMNS} FROM changes
                 WHERE workspace = ?1 AND (path = ?2 OR new_path = ?2)
                 ORDER BY id DESC LIMIT ?3"
            ))?;
            stmt.query_map(params![workspace, display_rel(p), limit], map_record)?
                .collect::<Result<Vec<_>, _>>()?
        }
        None => {
            stmt = conn.prepare(&format!(
                "SELECT {RECORD_COLUMNS} FROM changes WHERE workspace = ?1 ORDER BY id DESC LIMIT ?2"
            ))?;
            stmt.query_map(params![workspace, limit], map_record)?
                .collect::<Result<Vec<_>, _>>()?
        }
    };
    Ok(rows)
}

type Snapshots = (
    Option<Vec<u8>>,
    Option<Vec<u8>>,
    Option<String>,
    Option<String>,
    String,
);

fn load_snapshots(conn: &Connection, ws: &Workspace, id: i64) -> AppResult<Snapshots> {
    let workspace = ws.root().display().to_string();
    conn.query_row(
        "SELECT before_content, after_content, before_hash, after_hash, workspace FROM changes WHERE id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )
    .optional()?
    .filter(|s: &Snapshots| s.4 == workspace)
    .ok_or_else(|| AppError::not_found("That change does not belong to this project."))
}

pub fn detail(conn: &Connection, ws: &Workspace, id: i64) -> AppResult<ChangeDetail> {
    let record = get_record(conn, id)?;
    let (before, after, ..) = load_snapshots(conn, ws, id)?;
    let (before_text, before_bin) = text_of(&before);
    let (after_text, after_bin) = text_of(&after);
    let diff = if record.kind == ChangeKind::Move {
        format!(
            "rename from {}\nrename to {}\n",
            record.path,
            record.new_path.as_deref().unwrap_or("?")
        )
    } else {
        unified_diff(
            &record.path,
            before_text.as_deref().unwrap_or(""),
            after_text.as_deref().unwrap_or(""),
        )
        .0
    };
    Ok(ChangeDetail {
        record,
        before: before_text,
        after: after_text,
        diff,
        binary: before_bin || after_bin,
    })
}

/// Undo an applied change. Unless `force`, refuses if the file was modified
/// after the change (so later edits are never silently discarded).
pub fn revert(conn: &Connection, ws: &Workspace, id: i64, force: bool) -> AppResult<ChangeRecord> {
    let record = get_record(conn, id)?;
    if record.status != "applied" {
        return Err(AppError::validation("That change was already reverted."));
    }
    let (before, _after, _before_hash, after_hash, _) = load_snapshots(conn, ws, id)?;
    let path = record.path.as_str();

    let current = wsfs::current_hash(ws, path)?;
    let conflict = |what: &str| {
        AppError::conflict(format!(
            "{} {what} since this change was made. Revert anyway to discard those edits.",
            display_rel(path)
        ))
    };

    match record.kind {
        ChangeKind::Create => {
            if !force && current != after_hash {
                return Err(conflict("was modified"));
            }
            if current.is_some() {
                wsfs::delete_path(ws, path)?;
            }
        }
        ChangeKind::Modify => {
            if !force && current != after_hash {
                return Err(conflict("was modified"));
            }
            let bytes =
                before.ok_or_else(|| AppError::internal("Snapshot missing for this change."))?;
            wsfs::write_bytes(ws, path, &bytes, None)?;
        }
        ChangeKind::Delete => {
            if current.is_some() && !force {
                return Err(conflict("was recreated"));
            }
            let bytes =
                before.ok_or_else(|| AppError::internal("Snapshot missing for this change."))?;
            wsfs::write_bytes(ws, path, &bytes, None)?;
        }
        ChangeKind::Move => {
            let to = record.new_path.clone().unwrap_or_default();
            if ws.resolve(path)?.exists() {
                return Err(AppError::conflict(format!(
                    "{} exists again, so the move cannot be undone automatically.",
                    display_rel(path)
                )));
            }
            wsfs::move_path(ws, &to, path)?;
        }
    }

    conn.execute(
        "UPDATE changes SET status = 'reverted', reverted_at = ?2 WHERE id = ?1",
        params![id, now_ms()],
    )?;
    log::info!("change {id} reverted");
    get_record(conn, id)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevertOutcome {
    pub id: i64,
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
}

/// Revert every applied change of a task, newest first. Each change is
/// attempted; failures are reported individually.
pub fn revert_task(
    conn: &Connection,
    ws: &Workspace,
    task_id: &str,
    force: bool,
) -> AppResult<Vec<RevertOutcome>> {
    let workspace = ws.root().display().to_string();
    let ids: Vec<(i64, String)> = conn
        .prepare(
            "SELECT id, path FROM changes WHERE workspace = ?1 AND task_id = ?2 AND status = 'applied'
             ORDER BY id DESC",
        )?
        .query_map(params![workspace, task_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    if ids.is_empty() {
        return Err(AppError::not_found(
            "There are no applied changes for that task.",
        ));
    }
    Ok(ids
        .into_iter()
        .map(|(id, path)| match revert(conn, ws, id, force) {
            Ok(_) => RevertOutcome {
                id,
                path,
                ok: true,
                error: None,
            },
            Err(e) => RevertOutcome {
                id,
                path,
                ok: false,
                error: Some(e.message),
            },
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::error::ErrorKind;

    fn setup() -> (tempfile::TempDir, Workspace, Database) {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            d.path().join("config.lua"),
            "Config = {}\nConfig.Debug = false\n",
        )
        .unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        (d, ws, Database::open_in_memory().unwrap())
    }

    fn read(d: &tempfile::TempDir, p: &str) -> Option<String> {
        std::fs::read_to_string(d.path().join(p)).ok()
    }

    fn meta(task: &str) -> ChangeMeta {
        ChangeMeta {
            task_id: Some(task.into()),
            source: ChangeSource::Assistant,
            description: None,
        }
    }

    #[test]
    fn preview_shows_a_diff_without_writing() {
        let (d, ws, _db) = setup();
        let op = FileOperation::Write {
            path: "config.lua".into(),
            content: "Config = {}\nConfig.Debug = true\n".into(),
        };
        let p = preview(&ws, &op).unwrap();
        assert_eq!(p.kind, ChangeKind::Modify);
        assert!(p.diff.contains("-Config.Debug = false"));
        assert!(p.diff.contains("+Config.Debug = true"));
        assert_eq!((p.additions, p.deletions), (1, 1));
        assert_eq!(
            read(&d, "config.lua").unwrap(),
            "Config = {}\nConfig.Debug = false\n"
        );
    }

    #[test]
    fn snapshot_apply_and_revert_modification() {
        let (d, ws, db) = setup();
        let conn = db.conn().unwrap();
        let rec = apply(
            &conn,
            &ws,
            &FileOperation::Write {
                path: "config.lua".into(),
                content: "changed\n".into(),
            },
            &meta("t1"),
            None,
        )
        .unwrap();
        assert_eq!(rec.kind, ChangeKind::Modify);
        assert_eq!(read(&d, "config.lua").unwrap(), "changed\n");

        let detail = detail(&conn, &ws, rec.id).unwrap();
        assert_eq!(
            detail.before.as_deref(),
            Some("Config = {}\nConfig.Debug = false\n")
        );
        assert!(detail.diff.contains("+changed"));

        let reverted = revert(&conn, &ws, rec.id, false).unwrap();
        assert_eq!(reverted.status, "reverted");
        assert_eq!(
            read(&d, "config.lua").unwrap(),
            "Config = {}\nConfig.Debug = false\n"
        );
        assert!(
            revert(&conn, &ws, rec.id, false).is_err(),
            "cannot revert twice"
        );
    }

    #[test]
    fn revert_refuses_to_discard_later_edits_unless_forced() {
        let (d, ws, db) = setup();
        let conn = db.conn().unwrap();
        let rec = apply(
            &conn,
            &ws,
            &FileOperation::Write {
                path: "config.lua".into(),
                content: "v2\n".into(),
            },
            &meta("t1"),
            None,
        )
        .unwrap();
        std::fs::write(d.path().join("config.lua"), "edited by hand\n").unwrap();
        assert_eq!(
            revert(&conn, &ws, rec.id, false).unwrap_err().kind,
            ErrorKind::Conflict
        );
        assert_eq!(read(&d, "config.lua").unwrap(), "edited by hand\n");
        revert(&conn, &ws, rec.id, true).unwrap();
        assert_eq!(
            read(&d, "config.lua").unwrap(),
            "Config = {}\nConfig.Debug = false\n"
        );
    }

    #[test]
    fn create_delete_and_move_are_reversible() {
        let (d, ws, db) = setup();
        let conn = db.conn().unwrap();
        let created = apply(
            &conn,
            &ws,
            &FileOperation::Create {
                path: "server/main.lua".into(),
                content: "print(1)\n".into(),
            },
            &meta("t2"),
            None,
        )
        .unwrap();
        assert_eq!(created.kind, ChangeKind::Create);
        assert_eq!(created.additions, 1);

        let deleted = apply(
            &conn,
            &ws,
            &FileOperation::Delete {
                path: "config.lua".into(),
            },
            &meta("t2"),
            None,
        )
        .unwrap();
        assert!(read(&d, "config.lua").is_none());

        let moved = apply(
            &conn,
            &ws,
            &FileOperation::Move {
                from: "server/main.lua".into(),
                to: "server/init.lua".into(),
            },
            &meta("t2"),
            None,
        )
        .unwrap();
        assert_eq!(moved.new_path.as_deref(), Some("server/init.lua"));

        // Revert all changes from the task, newest first.
        let outcomes = revert_task(&conn, &ws, "t2", false).unwrap();
        assert!(outcomes.iter().all(|o| o.ok), "{outcomes:?}");
        assert_eq!(
            outcomes.iter().map(|o| o.id).collect::<Vec<_>>(),
            vec![moved.id, deleted.id, created.id]
        );
        assert_eq!(
            read(&d, "config.lua").unwrap(),
            "Config = {}\nConfig.Debug = false\n"
        );
        assert!(read(&d, "server/main.lua").is_none());
        assert!(read(&d, "server/init.lua").is_none());
    }

    #[test]
    fn tracks_multiple_files_and_file_history() {
        let (_d, ws, db) = setup();
        let conn = db.conn().unwrap();
        for (i, path) in ["a.lua", "b.lua", "a.lua"].iter().enumerate() {
            apply(
                &conn,
                &ws,
                &FileOperation::Write {
                    path: (*path).into(),
                    content: format!("v{i}\n"),
                },
                &meta("t3"),
                None,
            )
            .unwrap();
        }
        assert_eq!(list(&conn, &ws, None, 50).unwrap().len(), 3);
        let history = list(&conn, &ws, Some("a.lua"), 50).unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].kind, ChangeKind::Modify);
        assert_eq!(history[1].kind, ChangeKind::Create);
        let first_version = detail(&conn, &ws, history[1].id).unwrap();
        assert_eq!(first_version.after.as_deref(), Some("v0\n"));
    }

    #[test]
    fn stale_writes_are_rejected() {
        let (_d, ws, db) = setup();
        let conn = db.conn().unwrap();
        let err = apply(
            &conn,
            &ws,
            &FileOperation::Write {
                path: "config.lua".into(),
                content: "x".into(),
            },
            &ChangeMeta::default(),
            Some("not-the-current-hash"),
        )
        .unwrap_err();
        assert_eq!(err.kind, ErrorKind::Conflict);
        assert!(
            list(&conn, &ws, None, 10).unwrap().is_empty(),
            "failed ops are not recorded"
        );
    }

    #[test]
    fn operations_cannot_leave_the_workspace() {
        let (_d, ws, db) = setup();
        let conn = db.conn().unwrap();
        for op in [
            FileOperation::Write {
                path: "../x.txt".into(),
                content: "x".into(),
            },
            FileOperation::Delete {
                path: "..\\..\\boot.ini".into(),
            },
            FileOperation::Move {
                from: "config.lua".into(),
                to: "../config.lua".into(),
            },
        ] {
            let err = apply(&conn, &ws, &op, &ChangeMeta::default(), None).unwrap_err();
            assert_eq!(err.kind, ErrorKind::Forbidden, "{op:?}");
        }
    }

    #[test]
    fn changes_from_other_workspaces_are_not_accessible() {
        let (_d, ws, db) = setup();
        let conn = db.conn().unwrap();
        let rec = apply(
            &conn,
            &ws,
            &FileOperation::Write {
                path: "config.lua".into(),
                content: "x".into(),
            },
            &ChangeMeta::default(),
            None,
        )
        .unwrap();
        let other_dir = tempfile::tempdir().unwrap();
        let other = Workspace::open(other_dir.path()).unwrap();
        assert_eq!(
            detail(&conn, &other, rec.id).unwrap_err().kind,
            ErrorKind::NotFound
        );
        assert!(list(&conn, &other, None, 10).unwrap().is_empty());
    }
}
