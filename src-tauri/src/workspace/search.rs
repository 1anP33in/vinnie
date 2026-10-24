//! Search service: filename and text search across the workspace.
//!
//! Uses the `ignore` crate's walker (the engine behind ripgrep), so
//! `.gitignore` rules and the configured ignored directories are respected.
//! Patterns use the `regex` crate, which runs in linear time and cannot be
//! made to backtrack catastrophically. Results, file sizes, and run time are
//! all bounded, and searches can be cancelled.

use std::time::{Duration, Instant};

use globset::{Glob, GlobSet, GlobSetBuilder};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use super::fs::decode_text;
use super::ignore_rules::IgnoreRules;
use super::Workspace;
use crate::error::{AppError, AppResult};

const MAX_QUERY_CHARS: usize = 500;
const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_FILES_VISITED: usize = 50_000;
const DEFAULT_MAX_RESULTS: usize = 200;
const HARD_MAX_RESULTS: usize = 2_000;
const MAX_MATCHES_PER_FILE: usize = 100;
const MAX_PREVIEW_CHARS: usize = 240;
const SEARCH_DEADLINE: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SearchMode {
    #[default]
    Text,
    Filename,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub query: String,
    #[serde(default)]
    pub mode: SearchMode,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub regex: bool,
    /// File filters such as `lua`, `.ts`, or `*.test.ts`. Empty = all files.
    #[serde(default)]
    pub include: Vec<String>,
    #[serde(default)]
    pub max_results: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    /// 1-based line number; 0 for filename matches.
    pub line: u32,
    /// 1-based column (in characters) of the match start.
    pub column: u32,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub matches: Vec<SearchMatch>,
    pub files_searched: usize,
    /// More results exist than were returned.
    pub truncated: bool,
    pub timed_out: bool,
    pub cancelled: bool,
}

fn build_matcher(q: &SearchQuery) -> AppResult<Regex> {
    let text = q.query.trim();
    if text.is_empty() {
        return Err(AppError::validation("Enter something to search for."));
    }
    if text.chars().count() > MAX_QUERY_CHARS {
        return Err(AppError::validation("That search is too long."));
    }
    let pattern = if q.regex {
        text.to_string()
    } else {
        regex::escape(text)
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!q.case_sensitive)
        .size_limit(2 * 1024 * 1024)
        .dfa_size_limit(4 * 1024 * 1024)
        .build()
        .map_err(|e| AppError::validation(format!("That regular expression is not valid: {e}")))
}

fn build_filter(include: &[String]) -> AppResult<Option<GlobSet>> {
    let filters: Vec<&str> = include
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if filters.is_empty() {
        return Ok(None);
    }
    let mut builder = GlobSetBuilder::new();
    for f in filters {
        let glob = if f.contains('*') || f.contains('?') {
            f.to_string()
        } else {
            format!("*.{}", f.trim_start_matches("*.").trim_start_matches('.'))
        };
        let glob = Glob::new(&format!("**/{}", glob.trim_start_matches("**/")))
            .map_err(|e| AppError::validation(format!("Invalid file filter \"{f}\": {e}")))?;
        builder.add(glob);
    }
    builder
        .build()
        .map(Some)
        .map_err(|e| AppError::validation(format!("Invalid file filters: {e}")))
}

fn preview(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= MAX_PREVIEW_CHARS {
        trimmed.to_string()
    } else {
        format!(
            "{}…",
            trimmed.chars().take(MAX_PREVIEW_CHARS).collect::<String>()
        )
    }
}

/// Run a search. Blocking; call from a worker thread.
pub fn search(
    ws: &Workspace,
    q: &SearchQuery,
    ignore: &IgnoreRules,
    cancel: &CancellationToken,
) -> AppResult<SearchResults> {
    let matcher = build_matcher(q)?;
    let filter = build_filter(&q.include)?;
    let max_results = q
        .max_results
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .clamp(1, HARD_MAX_RESULTS);
    let started = Instant::now();

    let ignore_for_walk = ignore.clone();
    let walker = ignore::WalkBuilder::new(ws.root())
        .hidden(false)
        .parents(false)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(false)
        .require_git(false)
        .follow_links(false)
        .filter_entry(move |entry| {
            let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
            !(is_dir
                && entry.depth() > 0
                && ignore_for_walk.is_ignored_dir(&entry.file_name().to_string_lossy()))
        })
        .build();

    let mut results = SearchResults::default();
    for entry in walker {
        if cancel.is_cancelled() {
            results.cancelled = true;
            break;
        }
        if started.elapsed() > SEARCH_DEADLINE {
            results.timed_out = true;
            break;
        }
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let rel = ws.to_relative(entry.path());
        if let Some(filter) = &filter {
            if !filter.is_match(&rel) {
                continue;
            }
        }
        results.files_searched += 1;
        if results.files_searched > MAX_FILES_VISITED {
            results.truncated = true;
            break;
        }

        match q.mode {
            SearchMode::Filename => {
                if let Some(m) = matcher.find(&rel) {
                    if results.matches.len() >= max_results {
                        results.truncated = true;
                        break;
                    }
                    results.matches.push(SearchMatch {
                        path: rel.clone(),
                        line: 0,
                        column: rel[..m.start()].chars().count() as u32 + 1,
                        preview: rel,
                    });
                }
            }
            SearchMode::Text => {
                if entry
                    .metadata()
                    .map(|m| m.len() > MAX_FILE_BYTES)
                    .unwrap_or(true)
                {
                    continue;
                }
                let Ok(bytes) = std::fs::read(entry.path()) else {
                    continue;
                };
                let Some(text) = decode_text(&bytes) else {
                    continue;
                };
                let mut in_file = 0;
                for (index, line) in text.lines().enumerate() {
                    let Some(m) = matcher.find(line) else {
                        continue;
                    };
                    if results.matches.len() >= max_results {
                        results.truncated = true;
                        break;
                    }
                    results.matches.push(SearchMatch {
                        path: rel.clone(),
                        line: index as u32 + 1,
                        column: line[..m.start()].chars().count() as u32 + 1,
                        preview: preview(line),
                    });
                    in_file += 1;
                    if in_file >= MAX_MATCHES_PER_FILE {
                        break;
                    }
                }
                if results.truncated {
                    break;
                }
            }
        }
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws() -> (tempfile::TempDir, Workspace) {
        let d = tempfile::tempdir().unwrap();
        let w = |p: &str, c: &str| {
            let path = d.path().join(p);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, c).unwrap();
        };
        w(
            "client/main.lua",
            "local x = 1\nRegisterCommand('duty', function() end)\n",
        );
        w(
            "client/admin.lua",
            "-- admin\n\n\nregistercommand('kick')\n",
        );
        w(
            "server/main.lua",
            "RegisterCommand('pay', function() end)\n",
        );
        w("node_modules/lib/index.js", "RegisterCommand\n");
        w("dist/bundle.js", "RegisterCommand\n");
        w("generated/out.lua", "RegisterCommand('gen')\n");
        w(".gitignore", "generated/\n");
        w("ui/index.html", "<div>RegisterCommand</div>\n");
        std::fs::write(d.path().join("blob.bin"), b"RegisterCommand\0\0binary").unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        (d, ws)
    }

    fn q(query: &str) -> SearchQuery {
        SearchQuery {
            query: query.into(),
            mode: SearchMode::Text,
            case_sensitive: false,
            regex: false,
            include: vec![],
            max_results: None,
        }
    }

    fn paths(r: &SearchResults) -> Vec<String> {
        let mut p: Vec<_> = r
            .matches
            .iter()
            .map(|m| format!("{}:{}", m.path, m.line))
            .collect();
        p.sort();
        p
    }

    fn run(ws: &Workspace, query: &SearchQuery) -> SearchResults {
        search(
            ws,
            query,
            &IgnoreRules::default(),
            &CancellationToken::new(),
        )
        .unwrap()
    }

    #[test]
    fn text_search_case_insensitive_skips_ignored_and_binary() {
        let (_d, ws) = ws();
        let r = run(&ws, &q("RegisterCommand"));
        assert_eq!(
            paths(&r),
            vec![
                "client/admin.lua:4",
                "client/main.lua:2",
                "server/main.lua:1",
                "ui/index.html:1"
            ]
        );
        assert_eq!(
            r.matches
                .iter()
                .find(|m| m.path == "client/main.lua")
                .unwrap()
                .column,
            1
        );
    }

    #[test]
    fn text_search_case_sensitive() {
        let (_d, ws) = ws();
        let mut query = q("RegisterCommand");
        query.case_sensitive = true;
        let r = run(&ws, &query);
        assert!(!paths(&r).contains(&"client/admin.lua:4".to_string()));
        assert_eq!(r.matches.len(), 3);
    }

    #[test]
    fn regex_and_literal_modes() {
        let (_d, ws) = ws();
        let mut query = q(r"RegisterCommand\('(duty|pay)'");
        query.regex = true;
        assert_eq!(
            paths(&run(&ws, &query)),
            vec!["client/main.lua:2", "server/main.lua:1"]
        );
        // As a literal, the same text matches nothing.
        query.regex = false;
        assert!(run(&ws, &query).matches.is_empty());
        let mut bad = q("(unclosed");
        bad.regex = true;
        assert!(search(
            &ws,
            &bad,
            &IgnoreRules::default(),
            &CancellationToken::new()
        )
        .is_err());
    }

    #[test]
    fn file_type_filters() {
        let (_d, ws) = ws();
        let mut query = q("registercommand");
        query.include = vec!["html".into()];
        assert_eq!(paths(&run(&ws, &query)), vec!["ui/index.html:1"]);
        query.include = vec!["*.lua".into()];
        assert_eq!(run(&ws, &query).matches.len(), 3);
    }

    #[test]
    fn filename_search() {
        let (_d, ws) = ws();
        let mut query = q("main");
        query.mode = SearchMode::Filename;
        let r = run(&ws, &query);
        assert_eq!(paths(&r), vec!["client/main.lua:0", "server/main.lua:0"]);
    }

    #[test]
    fn custom_ignore_rules_apply() {
        let (_d, ws) = ws();
        let r = search(
            &ws,
            &q("RegisterCommand"),
            &IgnoreRules::new(["client"]),
            &CancellationToken::new(),
        )
        .unwrap();
        assert!(r.matches.iter().all(|m| !m.path.starts_with("client/")));
        // node_modules is searched when not in the custom list.
        assert!(r
            .matches
            .iter()
            .any(|m| m.path.starts_with("node_modules/")));
    }

    #[test]
    fn results_are_limited_and_cancellable() {
        let (_d, ws) = ws();
        let mut query = q("RegisterCommand");
        query.max_results = Some(2);
        let r = run(&ws, &query);
        assert_eq!(r.matches.len(), 2);
        assert!(r.truncated);

        let token = CancellationToken::new();
        token.cancel();
        let r = search(&ws, &q("RegisterCommand"), &IgnoreRules::default(), &token).unwrap();
        assert!(r.cancelled);
        assert!(r.matches.is_empty());
    }

    #[test]
    fn empty_query_is_rejected() {
        let (_d, ws) = ws();
        assert!(search(
            &ws,
            &q("  "),
            &IgnoreRules::default(),
            &CancellationToken::new()
        )
        .is_err());
    }
}
