//! Native skills: folders of instructions and references that guide the
//! agent for a kind of work. Skills are guidance only; nothing here grants
//! permissions.
//!
//! Layout (in the app data folder):
//!
//! ```text
//! skills/<id>/skill.json        metadata (validated before use)
//! skills/<id>/instructions.md   instructions, loaded only when the skill is used
//! skills/<id>/references/*.md   optional reference files
//! ```
//!
//! Ids and file names are validated before any path is built, so a skill (or
//! an imported bundle) can't read or write outside its own folder.

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::kv;
use crate::error::{AppError, AppResult};

static SKILL_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9-]{1,63}$").unwrap());
static REFERENCE_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}\.(md|txt|json|lua|js|ts|tsx|py|cs|sql|yaml|yml|toml|html|css|xml|ini|cfg)$").unwrap()
});
static VERSION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d+\.\d+\.\d+$").unwrap());
static TOOL_HINT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9_]+(\.[a-z0-9_*]+)?$").unwrap());

pub const MAX_INSTRUCTIONS: usize = 20_000;
pub const MAX_REFERENCE: usize = 200_000;
pub const MAX_REFERENCES: usize = 20;
const MAX_META_BYTES: u64 = 64 * 1024;
const BUILTINS_KEY: &str = "skills_builtins_installed";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillMatch {
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub languages: Vec<String>,
    #[serde(default)]
    pub project_types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, rename = "match")]
    pub matching: SkillMatch,
    #[serde(default)]
    pub tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    #[serde(flatten)]
    pub meta: SkillMeta,
    pub enabled: bool,
    pub builtin: bool,
    pub references: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillDetail {
    #[serde(flatten)]
    pub summary: SkillSummary,
    pub instructions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BundleReference {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SkillBundle {
    pub format: String,
    pub version: u32,
    pub skill: SkillMeta,
    pub instructions: String,
    pub references: Vec<BundleReference>,
}

pub fn validate_id(id: &str) -> AppResult<()> {
    if SKILL_ID.is_match(id) {
        Ok(())
    } else {
        Err(AppError::validation(
            "Skill ids use lowercase letters, digits, and dashes (2-64 characters).",
        ))
    }
}

pub fn validate_reference_name(name: &str) -> AppResult<()> {
    if REFERENCE_NAME.is_match(name) && !name.contains("..") {
        Ok(())
    } else {
        Err(AppError::validation(
            "Reference files need a plain name with a text extension (like notes.md).",
        ))
    }
}

fn words_ok(list: &[String], max: usize) -> bool {
    list.len() <= max
        && list
            .iter()
            .all(|w| !w.trim().is_empty() && w.chars().count() <= 40)
}

pub fn validate_meta(meta: &SkillMeta) -> AppResult<()> {
    validate_id(&meta.id)?;
    let name = meta.name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err(AppError::validation("Skill names have 1 to 60 characters."));
    }
    if meta.description.trim().is_empty() || meta.description.chars().count() > 300 {
        return Err(AppError::validation(
            "Descriptions have 1 to 300 characters.",
        ));
    }
    if !VERSION.is_match(&meta.version) {
        return Err(AppError::validation("Use a version like 1.0.0."));
    }
    if meta.author.chars().count() > 60 {
        return Err(AppError::validation(
            "Author names have at most 60 characters.",
        ));
    }
    if !words_ok(&meta.tags, 12)
        || !words_ok(&meta.matching.keywords, 40)
        || !words_ok(&meta.matching.languages, 12)
        || !words_ok(&meta.matching.project_types, 12)
    {
        return Err(AppError::validation(
            "Too many or too long tags, keywords, languages, or project types.",
        ));
    }
    if meta.tools.len() > 20 || !meta.tools.iter().all(|t| TOOL_HINT.is_match(t)) {
        return Err(AppError::validation(
            "Tool hints look like run_command or github.*",
        ));
    }
    Ok(())
}

fn validate_instructions(text: &str) -> AppResult<()> {
    if text.trim().is_empty() {
        return Err(AppError::validation(
            "Write the instructions Vinnie should follow.",
        ));
    }
    if text.chars().count() > MAX_INSTRUCTIONS {
        return Err(AppError::validation(format!(
            "Instructions are limited to {MAX_INSTRUCTIONS} characters."
        )));
    }
    Ok(())
}

// ---- built-in skills ----------------------------------------------------------

struct Builtin {
    id: &'static str,
    meta: &'static str,
    instructions: &'static str,
    references: &'static [(&'static str, &'static str)],
}

macro_rules! builtin {
    ($id:literal $(, $ref:literal)*) => {
        Builtin {
            id: $id,
            meta: include_str!(concat!("../skills/", $id, "/skill.json")),
            instructions: include_str!(concat!("../skills/", $id, "/instructions.md")),
            references: &[$(($ref, include_str!(concat!("../skills/", $id, "/references/", $ref)))),*],
        }
    };
}

const BUILTINS: &[Builtin] = &[
    builtin!("fivem-development", "fxmanifest.md"),
    builtin!("lua-development"),
    builtin!("web-development"),
    builtin!("typescript-development"),
    builtin!("python-development"),
    builtin!("csharp-development"),
    builtin!("git-assistance"),
    builtin!("debugging"),
    builtin!("database-assistance"),
    builtin!("documentation"),
];

fn is_builtin(id: &str) -> bool {
    BUILTINS.iter().any(|b| b.id == id)
}

/// Install built-in skills the user hasn't seen yet. A built-in skill the
/// user deleted is not reinstalled; edits are never overwritten.
pub fn install_builtins(conn: &Connection, dir: &Path) -> AppResult<usize> {
    std::fs::create_dir_all(dir)?;
    let mut installed: Vec<String> = kv::get(conn, BUILTINS_KEY)?
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default();
    let mut added = 0;
    for b in BUILTINS {
        if installed.iter().any(|i| i == b.id) {
            continue;
        }
        let folder = dir.join(b.id);
        if !folder.exists() {
            std::fs::create_dir_all(&folder)?;
            std::fs::write(folder.join("skill.json"), b.meta)?;
            std::fs::write(folder.join("instructions.md"), b.instructions)?;
            for (name, content) in b.references {
                std::fs::create_dir_all(folder.join("references"))?;
                std::fs::write(folder.join("references").join(name), content)?;
            }
            added += 1;
        }
        installed.push(b.id.to_owned());
    }
    kv::set(
        conn,
        BUILTINS_KEY,
        &serde_json::to_string(&installed).map_err(|e| AppError::internal(e.to_string()))?,
    )?;
    Ok(added)
}

// ---- store -------------------------------------------------------------------

pub struct SkillStore {
    dir: PathBuf,
}

fn enabled(conn: &Connection, id: &str) -> AppResult<bool> {
    let v: Option<i64> = conn
        .query_row(
            "SELECT enabled FROM skill_settings WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(v.map(|v| v != 0).unwrap_or(true))
}

fn read_text(path: &Path, max: u64) -> AppResult<String> {
    let meta = std::fs::metadata(path)?;
    if meta.len() > max {
        return Err(AppError::validation(format!(
            "{} is too large.",
            path.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        )));
    }
    String::from_utf8(std::fs::read(path)?)
        .map_err(|_| AppError::validation("The file is not UTF-8 text."))
}

impl SkillStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn folder(&self, id: &str) -> AppResult<PathBuf> {
        validate_id(id)?;
        Ok(self.dir.join(id))
    }

    fn references_of(&self, id: &str) -> Vec<String> {
        let Ok(folder) = self.folder(id) else {
            return vec![];
        };
        let Ok(entries) = std::fs::read_dir(folder.join("references")) else {
            return vec![];
        };
        let mut names: Vec<String> = entries
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| validate_reference_name(n).is_ok())
            .collect();
        names.sort();
        names.truncate(MAX_REFERENCES);
        names
    }

    fn load_meta(&self, id: &str) -> AppResult<SkillMeta> {
        let folder = self.folder(id)?;
        let text = read_text(&folder.join("skill.json"), MAX_META_BYTES)?;
        let meta: SkillMeta = serde_json::from_str(&text)
            .map_err(|e| AppError::validation(format!("skill.json is invalid: {e}")))?;
        if meta.id != id {
            return Err(AppError::validation(format!(
                "skill.json says its id is `{}`, but the folder is `{id}`.",
                meta.id
            )));
        }
        validate_meta(&meta)?;
        if !folder.join("instructions.md").is_file() {
            return Err(AppError::validation("instructions.md is missing."));
        }
        Ok(meta)
    }

    fn summary(&self, conn: &Connection, id: &str) -> AppResult<SkillSummary> {
        let meta = self.load_meta(id)?;
        Ok(SkillSummary {
            enabled: enabled(conn, id)?,
            builtin: is_builtin(id),
            references: self.references_of(id),
            meta,
            error: None,
        })
    }

    /// All installed skills. A malformed skill is listed with its error
    /// instead of breaking the list.
    pub fn list(&self, conn: &Connection) -> AppResult<Vec<SkillSummary>> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return Ok(vec![]);
        };
        let mut ids: Vec<String> = entries
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| SKILL_ID.is_match(n))
            .collect();
        ids.sort();
        let mut out = Vec::new();
        for id in ids {
            match self.summary(conn, &id) {
                Ok(s) => out.push(s),
                Err(e) => out.push(SkillSummary {
                    meta: SkillMeta {
                        id: id.clone(),
                        name: id.clone(),
                        description: String::new(),
                        version: "0.0.0".into(),
                        author: String::new(),
                        tags: vec![],
                        matching: SkillMatch::default(),
                        tools: vec![],
                    },
                    enabled: false,
                    builtin: is_builtin(&id),
                    references: vec![],
                    error: Some(e.message),
                }),
            }
        }
        out.sort_by_key(|s| s.meta.name.to_lowercase());
        Ok(out)
    }

    pub fn read(&self, conn: &Connection, id: &str) -> AppResult<SkillDetail> {
        let summary = self.summary(conn, id)?;
        let instructions = read_text(
            &self.folder(id)?.join("instructions.md"),
            (MAX_INSTRUCTIONS * 4) as u64,
        )?;
        Ok(SkillDetail {
            summary,
            instructions,
        })
    }

    pub fn save(
        &self,
        conn: &Connection,
        meta: &SkillMeta,
        instructions: &str,
        is_new: bool,
    ) -> AppResult<SkillSummary> {
        validate_meta(meta)?;
        validate_instructions(instructions)?;
        let folder = self.folder(&meta.id)?;
        if is_new && folder.exists() {
            return Err(AppError::conflict(format!(
                "A skill with the id `{}` already exists.",
                meta.id
            )));
        }
        if !is_new && !folder.exists() {
            return Err(AppError::not_found("That skill no longer exists."));
        }
        std::fs::create_dir_all(&folder)?;
        let mut meta = meta.clone();
        meta.name = meta.name.trim().to_owned();
        let json =
            serde_json::to_string_pretty(&meta).map_err(|e| AppError::internal(e.to_string()))?;
        std::fs::write(folder.join("skill.json"), format!("{json}\n"))?;
        std::fs::write(folder.join("instructions.md"), instructions)?;
        self.summary(conn, &meta.id)
    }

    pub fn delete(&self, conn: &Connection, id: &str) -> AppResult<()> {
        let folder = self.folder(id)?;
        if folder.exists() {
            std::fs::remove_dir_all(&folder)?;
        }
        conn.execute("DELETE FROM skill_settings WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn set_enabled(&self, conn: &Connection, id: &str, on: bool) -> AppResult<()> {
        validate_id(id)?;
        conn.execute(
            "INSERT INTO skill_settings (id, enabled) VALUES (?1, ?2)
             ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled",
            params![id, on as i64],
        )?;
        Ok(())
    }

    pub fn read_reference(&self, id: &str, name: &str) -> AppResult<String> {
        validate_reference_name(name)?;
        let path = self.folder(id)?.join("references").join(name);
        if !path.is_file() {
            return Err(AppError::not_found(format!(
                "The skill `{id}` has no reference `{name}`."
            )));
        }
        read_text(&path, MAX_REFERENCE as u64)
    }

    pub fn save_reference(&self, id: &str, name: &str, content: &str) -> AppResult<()> {
        validate_reference_name(name)?;
        if content.len() > MAX_REFERENCE {
            return Err(AppError::validation(
                "Reference files are limited to 200 KB.",
            ));
        }
        let folder = self.folder(id)?;
        if !folder.join("skill.json").is_file() {
            return Err(AppError::not_found("That skill no longer exists."));
        }
        let refs = folder.join("references");
        if !refs.join(name).exists() && self.references_of(id).len() >= MAX_REFERENCES {
            return Err(AppError::validation(format!(
                "A skill can have at most {MAX_REFERENCES} reference files."
            )));
        }
        std::fs::create_dir_all(&refs)?;
        std::fs::write(refs.join(name), content)?;
        Ok(())
    }

    pub fn delete_reference(&self, id: &str, name: &str) -> AppResult<()> {
        validate_reference_name(name)?;
        let path = self.folder(id)?.join("references").join(name);
        if path.is_file() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }

    pub fn export(&self, conn: &Connection, id: &str) -> AppResult<SkillBundle> {
        let detail = self.read(conn, id)?;
        let references = detail
            .summary
            .references
            .iter()
            .map(|name| {
                Ok(BundleReference {
                    name: name.clone(),
                    content: self.read_reference(id, name)?,
                })
            })
            .collect::<AppResult<Vec<_>>>()?;
        Ok(SkillBundle {
            format: "vinnie-skill".into(),
            version: 1,
            skill: detail.summary.meta,
            instructions: detail.instructions,
            references,
        })
    }

    /// Install a skill from a bundle. Everything is validated first; an
    /// existing skill is replaced only with `overwrite`.
    pub fn import(
        &self,
        conn: &Connection,
        bundle: &SkillBundle,
        overwrite: bool,
    ) -> AppResult<SkillSummary> {
        if bundle.format != "vinnie-skill" || bundle.version != 1 {
            return Err(AppError::validation(
                "This is not a Vinnie skill file (format vinnie-skill, version 1).",
            ));
        }
        validate_meta(&bundle.skill)?;
        validate_instructions(&bundle.instructions)?;
        if bundle.references.len() > MAX_REFERENCES {
            return Err(AppError::validation(format!(
                "A skill can have at most {MAX_REFERENCES} reference files."
            )));
        }
        let mut names = std::collections::HashSet::new();
        for r in &bundle.references {
            validate_reference_name(&r.name)?;
            if r.content.len() > MAX_REFERENCE {
                return Err(AppError::validation(format!(
                    "The reference {} is larger than 200 KB.",
                    r.name
                )));
            }
            if !names.insert(r.name.to_lowercase()) {
                return Err(AppError::validation(format!(
                    "Duplicate reference file {}.",
                    r.name
                )));
            }
        }
        let folder = self.folder(&bundle.skill.id)?;
        if folder.exists() {
            if !overwrite {
                return Err(AppError::conflict(format!(
                    "A skill with the id `{}` is already installed.",
                    bundle.skill.id
                )));
            }
            std::fs::remove_dir_all(&folder)?;
        }
        self.save(conn, &bundle.skill, &bundle.instructions, true)?;
        for r in &bundle.references {
            self.save_reference(&bundle.skill.id, &r.name, &r.content)?;
        }
        self.summary(conn, &bundle.skill.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn meta(id: &str) -> SkillMeta {
        SkillMeta {
            id: id.into(),
            name: "My Skill".into(),
            description: "Helps with things.".into(),
            version: "1.0.0".into(),
            author: "Me".into(),
            tags: vec!["test".into()],
            matching: SkillMatch {
                keywords: vec!["widget".into()],
                languages: vec![],
                project_types: vec![],
            },
            tools: vec!["github.*".into()],
        }
    }

    fn setup() -> (tempfile::TempDir, Database, SkillStore) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_memory().unwrap();
        let store = SkillStore::new(dir.path().join("skills"));
        (dir, db, store)
    }

    #[test]
    fn builtins_install_once_and_are_valid() {
        let (_d, db, store) = setup();
        let conn = db.conn().unwrap();
        assert_eq!(install_builtins(&conn, &store.dir).unwrap(), BUILTINS.len());
        let list = store.list(&conn).unwrap();
        assert_eq!(list.len(), BUILTINS.len());
        assert!(
            list.iter()
                .all(|s| s.error.is_none() && s.builtin && s.enabled),
            "{list:?}"
        );
        let fivem = list
            .iter()
            .find(|s| s.meta.id == "fivem-development")
            .unwrap();
        assert_eq!(fivem.references, vec!["fxmanifest.md".to_string()]);

        // A deleted built-in is not reinstalled.
        store.delete(&conn, "debugging").unwrap();
        assert_eq!(install_builtins(&conn, &store.dir).unwrap(), 0);
        assert!(store
            .list(&conn)
            .unwrap()
            .iter()
            .all(|s| s.meta.id != "debugging"));
    }

    #[test]
    fn creates_edits_and_deletes_custom_skills() {
        let (_d, db, store) = setup();
        let conn = db.conn().unwrap();
        let saved = store
            .save(&conn, &meta("my-skill"), "Do it well.", true)
            .unwrap();
        assert!(!saved.builtin);
        assert!(
            store.save(&conn, &meta("my-skill"), "Again", true).is_err(),
            "ids are unique"
        );
        let mut m = meta("my-skill");
        m.name = "Renamed".into();
        store.save(&conn, &m, "Do it better.", false).unwrap();
        let detail = store.read(&conn, "my-skill").unwrap();
        assert_eq!(detail.summary.meta.name, "Renamed");
        assert_eq!(detail.instructions, "Do it better.");
        store.set_enabled(&conn, "my-skill", false).unwrap();
        assert!(!store.read(&conn, "my-skill").unwrap().summary.enabled);
        store
            .save_reference("my-skill", "notes.md", "# Notes")
            .unwrap();
        assert_eq!(
            store.read_reference("my-skill", "notes.md").unwrap(),
            "# Notes"
        );
        store.delete_reference("my-skill", "notes.md").unwrap();
        assert!(store.read_reference("my-skill", "notes.md").is_err());
        store.delete(&conn, "my-skill").unwrap();
        assert!(store.read(&conn, "my-skill").is_err());
    }

    #[test]
    fn rejects_invalid_metadata_and_unsafe_names() {
        let (_d, db, store) = setup();
        let conn = db.conn().unwrap();
        for id in ["", "A", "../etc", "a/b", "-x", "x"] {
            assert!(store.save(&conn, &meta(id), "x", true).is_err(), "{id}");
        }
        let mut bad = meta("ok-skill");
        bad.version = "one".into();
        assert!(store.save(&conn, &bad, "x", true).is_err());
        let mut hints = meta("ok-skill");
        hints.tools = vec!["rm -rf".into()];
        assert!(store.save(&conn, &hints, "x", true).is_err());
        store.save(&conn, &meta("ok-skill"), "x", true).unwrap();
        for name in ["../../evil.md", "a/b.md", "notes.exe", "..md", ".hidden.md"] {
            assert!(
                store.save_reference("ok-skill", name, "x").is_err(),
                "{name}"
            );
            assert!(store.read_reference("ok-skill", name).is_err(), "{name}");
        }
        assert!(store
            .save(&conn, &meta("empty-instr"), "   ", true)
            .is_err());
    }

    #[test]
    fn malformed_skills_are_listed_with_an_error() {
        let (_d, db, store) = setup();
        let conn = db.conn().unwrap();
        std::fs::create_dir_all(store.dir.join("broken")).unwrap();
        std::fs::write(store.dir.join("broken/skill.json"), "{ not json").unwrap();
        std::fs::create_dir_all(store.dir.join("mismatch")).unwrap();
        std::fs::write(
            store.dir.join("mismatch/skill.json"),
            serde_json::to_string(&meta("other-id")).unwrap(),
        )
        .unwrap();
        std::fs::write(store.dir.join("mismatch/instructions.md"), "x").unwrap();
        let list = store.list(&conn).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list.iter().all(|s| s.error.is_some() && !s.enabled));
    }

    #[test]
    fn export_and_import_round_trip() {
        let (_d, db, store) = setup();
        let conn = db.conn().unwrap();
        store
            .save(&conn, &meta("my-skill"), "Do it well.", true)
            .unwrap();
        store
            .save_reference("my-skill", "notes.md", "# Notes")
            .unwrap();
        let bundle = store.export(&conn, "my-skill").unwrap();
        assert_eq!(bundle.references.len(), 1);
        assert!(
            store.import(&conn, &bundle, false).is_err(),
            "existing skills need overwrite"
        );
        store.delete(&conn, "my-skill").unwrap();
        let imported = store.import(&conn, &bundle, false).unwrap();
        assert_eq!(imported.references, vec!["notes.md".to_string()]);
        assert_eq!(
            store.read(&conn, "my-skill").unwrap().instructions,
            "Do it well."
        );

        let mut evil = bundle.clone();
        evil.skill.id = "evil".into();
        evil.references = vec![BundleReference {
            name: "../../x.md".into(),
            content: "x".into(),
        }];
        assert!(store.import(&conn, &evil, false).is_err());
        assert!(
            !store.dir.join("evil").exists(),
            "nothing is written for an invalid bundle"
        );
    }
}
