//! Project analyzer: lightweight, bounded detection of what a project is.
//!
//! It walks a limited number of files (respecting ignore rules), counts
//! languages by extension, and reads a handful of well-known manifests.
//! Results are labeled as *detected*: they describe evidence, not a full
//! understanding of the project.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::deps::{self, ManagerDetection};
use crate::git::{self, GitStatus};
use crate::workspace::ignore_rules::IgnoreRules;
use crate::workspace::Workspace;

const MAX_FILES: usize = 20_000;
const MAX_DEPTH: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageStat {
    pub name: String,
    pub files: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FiveMManifest {
    pub manifest_file: String,
    pub fx_version: Option<String>,
    pub games: Vec<String>,
    pub client_scripts: Vec<String>,
    pub server_scripts: Vec<String>,
    pub shared_scripts: Vec<String>,
    pub ui_page: Option<String>,
    pub files: Vec<String>,
    pub dependencies: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    pub name: String,
    pub root: String,
    /// Detected project types, most specific first (e.g. "FiveM Resource").
    pub project_types: Vec<String>,
    pub languages: Vec<LanguageStat>,
    pub frameworks: Vec<String>,
    pub package_managers: Vec<ManagerDetection>,
    pub config_files: Vec<String>,
    pub entry_points: Vec<String>,
    pub readme: Option<String>,
    /// Files with instructions for AI assistants or contributors.
    pub instruction_files: Vec<String>,
    pub fivem: Option<FiveMManifest>,
    pub git: GitStatus,
    pub files_scanned: usize,
    pub scan_truncated: bool,
    pub analyzed_at: i64,
}

fn language_for(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "lua" => "Lua",
        "js" | "mjs" | "cjs" | "jsx" => "JavaScript",
        "ts" | "tsx" | "mts" | "cts" => "TypeScript",
        "py" => "Python",
        "cs" => "C#",
        "rs" => "Rust",
        "go" => "Go",
        "java" => "Java",
        "kt" => "Kotlin",
        "html" | "htm" => "HTML",
        "css" | "scss" | "sass" | "less" => "CSS",
        "vue" => "Vue",
        "svelte" => "Svelte",
        "php" => "PHP",
        "rb" => "Ruby",
        "c" | "h" => "C",
        "cpp" | "cc" | "hpp" => "C++",
        "sql" => "SQL",
        "sh" => "Shell",
        "ps1" => "PowerShell",
        _ => return None,
    })
}

const CONFIG_FILES: &[&str] = &[
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "vite.config.js",
    "next.config.js",
    "next.config.mjs",
    "webpack.config.js",
    ".eslintrc.json",
    "eslint.config.js",
    "Cargo.toml",
    "pyproject.toml",
    "requirements.txt",
    "setup.py",
    "go.mod",
    "Dockerfile",
    "docker-compose.yml",
    "fxmanifest.lua",
    "__resource.lua",
    "config.lua",
    "tauri.conf.json",
    ".editorconfig",
    "Makefile",
    "appsettings.json",
];

const INSTRUCTION_FILES: &[&str] = &[
    "AGENTS.md",
    "CLAUDE.md",
    "VINNIE.md",
    ".cursorrules",
    ".github/copilot-instructions.md",
    "CONTRIBUTING.md",
    ".windsurfrules",
];

fn strip_lua_comments(src: &str) -> String {
    src.lines()
        .map(|l| match l.find("--") {
            Some(i) => &l[..i],
            None => l,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Extract `key 'value'` / `key { 'a', 'b' }` entries from a FiveM manifest.
pub fn parse_fivem_manifest(file: &str, src: &str) -> FiveMManifest {
    let src = strip_lua_comments(src);
    let quoted = regex::Regex::new(r#"['"]([^'"]+)['"]"#).expect("static regex");
    let values = |keys: &[&str]| -> Vec<String> {
        let mut out = Vec::new();
        for key in keys {
            let pattern = format!(r#"(?m)^\s*{key}\s*(\{{[^}}]*\}}|['"][^'"]*['"])"#);
            let re = regex::Regex::new(&pattern).expect("manifest regex");
            for cap in re.captures_iter(&src) {
                for v in quoted.captures_iter(&cap[1]) {
                    out.push(v[1].to_string());
                }
            }
        }
        out
    };
    FiveMManifest {
        manifest_file: file.to_string(),
        fx_version: values(&["fx_version"]).into_iter().next(),
        games: values(&["games", "game"]),
        client_scripts: values(&["client_scripts", "client_script"]),
        server_scripts: values(&["server_scripts", "server_script"]),
        shared_scripts: values(&["shared_scripts", "shared_script"]),
        ui_page: values(&["ui_page"]).into_iter().next(),
        files: values(&["files", "file"]),
        dependencies: values(&["dependencies", "dependency"]),
    }
}

fn read_json(ws: &Workspace, name: &str) -> Option<serde_json::Value> {
    let raw = std::fs::read_to_string(ws.root().join(name)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn node_frameworks(pkg: &serde_json::Value) -> Vec<String> {
    let mut deps: Vec<String> = Vec::new();
    for field in ["dependencies", "devDependencies"] {
        if let Some(obj) = pkg.get(field).and_then(|v| v.as_object()) {
            deps.extend(obj.keys().cloned());
        }
    }
    let has = |name: &str| deps.iter().any(|d| d == name);
    let mut out = Vec::new();
    for (dep, label) in [
        ("next", "Next.js"),
        ("react", "React"),
        ("vue", "Vue"),
        ("svelte", "Svelte"),
        ("@angular/core", "Angular"),
        ("express", "Express"),
        ("fastify", "Fastify"),
        ("@nestjs/core", "NestJS"),
        ("electron", "Electron"),
        ("@tauri-apps/api", "Tauri"),
        ("vite", "Vite"),
        ("tailwindcss", "Tailwind CSS"),
        ("vitest", "Vitest"),
        ("jest", "Jest"),
    ] {
        if has(dep) {
            out.push(label.to_string());
        }
    }
    out
}

fn python_frameworks(ws: &Workspace) -> Vec<String> {
    let mut text = std::fs::read_to_string(ws.root().join("requirements.txt")).unwrap_or_default();
    text.push_str(&std::fs::read_to_string(ws.root().join("pyproject.toml")).unwrap_or_default());
    let text = text.to_ascii_lowercase();
    [
        ("django", "Django"),
        ("flask", "Flask"),
        ("fastapi", "FastAPI"),
        ("pytest", "pytest"),
    ]
    .iter()
    .filter(|(needle, _)| text.contains(needle))
    .map(|(_, label)| label.to_string())
    .collect()
}

/// Analyze the workspace. Blocking; run on a worker thread.
pub fn analyze(ws: &Workspace, ignore: &IgnoreRules) -> ProjectMetadata {
    let mut counts: BTreeMap<&'static str, usize> = BTreeMap::new();
    let mut csproj = Vec::new();
    let mut files_scanned = 0;
    let mut scan_truncated = false;

    let rules = ignore.clone();
    let walker = ignore::WalkBuilder::new(ws.root())
        .max_depth(Some(MAX_DEPTH))
        .hidden(false)
        .require_git(false)
        .follow_links(false)
        .filter_entry(move |e| {
            !(e.depth() > 0
                && e.file_type().is_some_and(|t| t.is_dir())
                && rules.is_ignored_dir(&e.file_name().to_string_lossy()))
        })
        .build();
    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        files_scanned += 1;
        if files_scanned > MAX_FILES {
            scan_truncated = true;
            break;
        }
        let ext = entry
            .path()
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if let Some(lang) = language_for(&ext) {
            *counts.entry(lang).or_default() += 1;
        }
        if ext == "csproj" && csproj.len() < 10 {
            csproj.push(ws.to_relative(entry.path()));
        }
    }

    let mut languages: Vec<LanguageStat> = counts
        .into_iter()
        .map(|(name, files)| LanguageStat {
            name: name.to_string(),
            files,
        })
        .collect();
    languages.sort_by(|a, b| b.files.cmp(&a.files).then(a.name.cmp(&b.name)));

    let exists = |f: &str| ws.root().join(f).exists();
    let mut project_types = Vec::new();
    let mut frameworks = Vec::new();
    let mut entry_points = Vec::new();

    // FiveM
    let manifest_file = ["fxmanifest.lua", "__resource.lua"]
        .into_iter()
        .find(|f| exists(f));
    let fivem = manifest_file.and_then(|f| {
        std::fs::read_to_string(ws.root().join(f))
            .ok()
            .map(|src| parse_fivem_manifest(f, &src))
    });
    if let Some(m) = &fivem {
        project_types.push("FiveM Resource".to_string());
        for s in m
            .client_scripts
            .iter()
            .chain(&m.server_scripts)
            .chain(&m.shared_scripts)
        {
            if !s.starts_with('@') && !s.contains('*') && entry_points.len() < 12 {
                entry_points.push(s.clone());
            }
        }
        if let Some(ui) = &m.ui_page {
            entry_points.push(ui.clone());
        }
    }

    // Node
    if let Some(pkg) = read_json(ws, "package.json") {
        let fw = node_frameworks(&pkg);
        let is_ts = exists("tsconfig.json");
        if fw.iter().any(|f| f == "Next.js") {
            project_types.push("Next.js Application".into());
        } else if fw.iter().any(|f| f == "React") {
            project_types.push("React Application".into());
        }
        if fw.iter().any(|f| f == "Tauri") {
            project_types.push("Tauri Desktop App".into());
        }
        project_types.push(if is_ts {
            "Node.js Project (TypeScript)".into()
        } else {
            "Node.js Project".into()
        });
        frameworks.extend(fw);
        if let Some(main) = pkg.get("main").and_then(|v| v.as_str()) {
            entry_points.push(main.to_string());
        }
    }

    // Python
    if exists("requirements.txt") || exists("pyproject.toml") || exists("setup.py") {
        project_types.push("Python Project".into());
        frameworks.extend(python_frameworks(ws));
        for f in ["main.py", "app.py", "manage.py", "src/main.py"] {
            if exists(f) {
                entry_points.push(f.into());
            }
        }
    }

    // C#
    let has_sln = std::fs::read_dir(ws.root())
        .map(|rd| {
            rd.flatten().any(|e| {
                e.path()
                    .extension()
                    .is_some_and(|x| x.eq_ignore_ascii_case("sln"))
            })
        })
        .unwrap_or(false);
    if !csproj.is_empty() || has_sln {
        project_types.push("C# Project".into());
        for p in &csproj {
            if let Ok(src) = std::fs::read_to_string(ws.root().join(p)) {
                if src.contains("Microsoft.NET.Sdk.Web")
                    && !frameworks.iter().any(|f| f == "ASP.NET Core")
                {
                    frameworks.push("ASP.NET Core".into());
                }
            }
        }
        if exists("Program.cs") {
            entry_points.push("Program.cs".into());
        }
    }

    // Rust / Go
    if exists("Cargo.toml") {
        project_types.push("Rust Project".into());
        for f in ["src/main.rs", "src/lib.rs"] {
            if exists(f) {
                entry_points.push(f.into());
            }
        }
    }
    if exists("go.mod") {
        project_types.push("Go Module".into());
    }

    // Static site: HTML without a build system.
    if project_types.is_empty() && exists("index.html") {
        project_types.push("Static Website".into());
        entry_points.push("index.html".into());
    }

    let readme = ["README.md", "readme.md", "README.txt", "README"]
        .into_iter()
        .find(|f| exists(f))
        .map(String::from);
    let instruction_files = INSTRUCTION_FILES
        .iter()
        .filter(|f| exists(f))
        .map(|f| f.to_string())
        .collect();
    let config_files = CONFIG_FILES
        .iter()
        .filter(|f| exists(f))
        .map(|f| f.to_string())
        .collect();
    entry_points.dedup();

    ProjectMetadata {
        name: ws.name(),
        root: ws.root().display().to_string(),
        project_types,
        languages,
        frameworks,
        package_managers: deps::detect(ws),
        config_files,
        entry_points,
        readme,
        instruction_files,
        fivem,
        git: git::status(ws),
        files_scanned: files_scanned.min(MAX_FILES),
        scan_truncated,
        analyzed_at: crate::db::now_ms(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(files: &[(&str, &str)]) -> (tempfile::TempDir, Workspace) {
        let d = tempfile::tempdir().unwrap();
        for (name, content) in files {
            let p = d.path().join(name);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, content).unwrap();
        }
        let ws = Workspace::open(d.path()).unwrap();
        (d, ws)
    }

    const MANIFEST: &str = r#"
fx_version 'cerulean'
game 'gta5'
-- client_script 'commented.lua'
shared_script '@ox_lib/init.lua'
shared_scripts { 'shared/config.lua' }
client_scripts {
    'client/main.lua',
    "client/duty.lua",
}
server_script 'server/main.lua'
ui_page 'html/index.html'
files { 'html/index.html', 'html/app.js' }
dependency 'ox_lib'
"#;

    #[test]
    fn parses_fivem_manifests() {
        let m = parse_fivem_manifest("fxmanifest.lua", MANIFEST);
        assert_eq!(m.fx_version.as_deref(), Some("cerulean"));
        assert_eq!(m.games, vec!["gta5"]);
        assert_eq!(m.client_scripts, vec!["client/main.lua", "client/duty.lua"]);
        assert_eq!(m.server_scripts, vec!["server/main.lua"]);
        assert_eq!(
            m.shared_scripts,
            vec!["shared/config.lua", "@ox_lib/init.lua"]
        );
        assert_eq!(m.ui_page.as_deref(), Some("html/index.html"));
        assert_eq!(m.files, vec!["html/index.html", "html/app.js"]);
        assert_eq!(m.dependencies, vec!["ox_lib"]);
    }

    #[test]
    fn detects_fivem_resources() {
        let (_d, ws) = project(&[
            ("fxmanifest.lua", MANIFEST),
            ("client/main.lua", ""),
            ("client/duty.lua", ""),
            ("server/main.lua", ""),
            ("html/index.html", ""),
            ("html/app.js", ""),
            ("README.md", "# Mystic"),
        ]);
        let m = analyze(&ws, &IgnoreRules::default());
        assert_eq!(m.project_types[0], "FiveM Resource");
        assert_eq!(m.languages[0].name, "Lua");
        assert!(m.entry_points.contains(&"client/main.lua".to_string()));
        assert!(m.entry_points.contains(&"html/index.html".to_string()));
        assert_eq!(m.readme.as_deref(), Some("README.md"));
        assert!(m.fivem.is_some());
        assert!(m.config_files.contains(&"fxmanifest.lua".to_string()));
    }

    #[test]
    fn detects_node_and_react_projects() {
        let (_d, ws) = project(&[
            (
                "package.json",
                r#"{"main": "index.js", "dependencies": {"react": "19", "express": "4"}}"#,
            ),
            ("package-lock.json", "{}"),
            ("tsconfig.json", "{}"),
            ("src/App.tsx", ""),
            ("node_modules/x/index.js", ""),
            ("AGENTS.md", "rules"),
        ]);
        let m = analyze(&ws, &IgnoreRules::default());
        assert_eq!(
            m.project_types,
            vec!["React Application", "Node.js Project (TypeScript)"]
        );
        assert!(m.frameworks.contains(&"React".to_string()));
        assert!(m.frameworks.contains(&"Express".to_string()));
        assert_eq!(m.package_managers[0].manager.as_deref(), Some("npm"));
        assert_eq!(m.instruction_files, vec!["AGENTS.md"]);
        assert_eq!(
            m.languages,
            vec![LanguageStat {
                name: "TypeScript".into(),
                files: 1
            }],
            "node_modules is skipped"
        );
    }

    #[test]
    fn detects_python_projects() {
        let (_d, ws) = project(&[
            ("requirements.txt", "fastapi\nuvicorn\n"),
            ("main.py", ""),
            ("app/util.py", ""),
        ]);
        let m = analyze(&ws, &IgnoreRules::default());
        assert_eq!(m.project_types, vec!["Python Project"]);
        assert_eq!(m.frameworks, vec!["FastAPI"]);
        assert_eq!(m.entry_points, vec!["main.py"]);
        assert_eq!(
            m.languages[0],
            LanguageStat {
                name: "Python".into(),
                files: 2
            }
        );
    }

    #[test]
    fn detects_csharp_projects() {
        let (_d, ws) = project(&[
            ("App.sln", ""),
            (
                "src/Api/Api.csproj",
                r#"<Project Sdk="Microsoft.NET.Sdk.Web"></Project>"#,
            ),
            ("src/Api/Program.cs", ""),
        ]);
        let m = analyze(&ws, &IgnoreRules::default());
        assert_eq!(m.project_types, vec!["C# Project"]);
        assert_eq!(m.frameworks, vec!["ASP.NET Core"]);
        assert_eq!(m.package_managers[0].manager.as_deref(), Some("dotnet"));
    }

    #[test]
    fn detects_static_sites_and_unknown_projects() {
        let (_d, ws) = project(&[("index.html", ""), ("style.css", "")]);
        assert_eq!(
            analyze(&ws, &IgnoreRules::default()).project_types,
            vec!["Static Website"]
        );
        let (_d, ws) = project(&[("notes.txt", "")]);
        let m = analyze(&ws, &IgnoreRules::default());
        assert!(m.project_types.is_empty());
        assert!(!m.git.is_repo);
    }
}
