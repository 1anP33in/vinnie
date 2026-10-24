//! Dependency service: package-manager detection and install commands.
//!
//! Detection looks only at well-known files in the project root (and a
//! shallow search for .NET project files). It never guesses silently: when
//! the evidence conflicts or is missing, the result is marked ambiguous and
//! lists the candidates so the user can choose.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::workspace::Workspace;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Ecosystem {
    Node,
    Python,
    Rust,
    DotNet,
    Go,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagerDetection {
    pub ecosystem: Ecosystem,
    /// The detected manager, or `None` when ambiguous.
    pub manager: Option<String>,
    pub candidates: Vec<String>,
    pub ambiguous: bool,
    /// Human-readable explanation of the decision.
    pub reason: String,
    /// Files that informed the decision.
    pub evidence: Vec<String>,
}

/// A command ready for the process service (no shell involved).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallCommand {
    pub manager: String,
    pub program: String,
    pub args: Vec<String>,
    /// The exact command line shown to the user.
    pub display: String,
    pub packages: Vec<String>,
}

fn exists(ws: &Workspace, name: &str) -> bool {
    ws.root().join(name).exists()
}

fn files_with_extension(ws: &Workspace, ext: &str, depth: usize) -> Vec<String> {
    let mut found = Vec::new();
    let walker = ignore::WalkBuilder::new(ws.root())
        .max_depth(Some(depth))
        .hidden(true)
        .git_ignore(false)
        .build();
    for entry in walker.flatten() {
        if entry.file_type().is_some_and(|t| t.is_file())
            && entry
                .path()
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case(ext))
        {
            found.push(ws.to_relative(entry.path()));
            if found.len() >= 20 {
                break;
            }
        }
    }
    found.sort();
    found
}

/// The `packageManager` field of package.json (Corepack convention), e.g.
/// `"pnpm@9.1.0"` -> `pnpm`.
fn declared_node_manager(ws: &Workspace) -> Option<String> {
    let raw = std::fs::read_to_string(ws.root().join("package.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let field = json.get("packageManager")?.as_str()?;
    let name = field.split('@').next()?.trim().to_ascii_lowercase();
    ["npm", "pnpm", "yarn", "bun"]
        .contains(&name.as_str())
        .then_some(name)
}

fn detect_node(ws: &Workspace) -> Option<ManagerDetection> {
    if !exists(ws, "package.json") {
        return None;
    }
    let lockfiles = [
        ("pnpm-lock.yaml", "pnpm"),
        ("package-lock.json", "npm"),
        ("yarn.lock", "yarn"),
        ("bun.lockb", "bun"),
        ("bun.lock", "bun"),
    ];
    let mut evidence = vec!["package.json".to_string()];
    let mut found: Vec<&str> = Vec::new();
    for (file, manager) in lockfiles {
        if exists(ws, file) {
            evidence.push(file.to_string());
            if !found.contains(&manager) {
                found.push(manager);
            }
        }
    }
    let declared = declared_node_manager(ws);

    let (manager, candidates, ambiguous, reason) = match (&declared, found.as_slice()) {
        (Some(d), _) => (
            Some(d.clone()),
            vec![d.clone()],
            false,
            format!("package.json declares \"packageManager\": {d}."),
        ),
        (None, [single]) => (
            Some(single.to_string()),
            vec![single.to_string()],
            false,
            format!("Found the {single} lockfile."),
        ),
        (None, []) => (
            None,
            vec!["npm".into(), "pnpm".into(), "yarn".into()],
            true,
            "package.json has no lockfile, so the package manager is unknown.".to_string(),
        ),
        (None, many) => (
            None,
            many.iter().map(|m| m.to_string()).collect(),
            true,
            format!(
                "Lockfiles for several managers were found ({}).",
                many.join(", ")
            ),
        ),
    };
    Some(ManagerDetection {
        ecosystem: Ecosystem::Node,
        manager,
        candidates,
        ambiguous,
        reason,
        evidence,
    })
}

fn detect_python(ws: &Workspace) -> Option<ManagerDetection> {
    let mut evidence = Vec::new();
    for f in [
        "requirements.txt",
        "pyproject.toml",
        "Pipfile",
        "poetry.lock",
        "uv.lock",
        "setup.py",
    ] {
        if exists(ws, f) {
            evidence.push(f.to_string());
        }
    }
    if evidence.is_empty() {
        return None;
    }
    let pyproject = std::fs::read_to_string(ws.root().join("pyproject.toml")).unwrap_or_default();
    let mut found: Vec<&str> = Vec::new();
    if exists(ws, "uv.lock") {
        found.push("uv");
    }
    if exists(ws, "poetry.lock") || pyproject.contains("[tool.poetry]") {
        found.push("poetry");
    }
    if exists(ws, "Pipfile") {
        found.push("pipenv");
    }
    if exists(ws, "requirements.txt") && found.is_empty() {
        found.push("pip");
    }
    let (manager, candidates, ambiguous, reason) = match found.as_slice() {
        [single] => (
            Some(single.to_string()),
            vec![single.to_string()],
            false,
            format!("Detected {single} from {}.", evidence.join(", ")),
        ),
        [] => (
            None,
            vec!["pip".into(), "uv".into(), "poetry".into()],
            true,
            "A Python project was found, but no lockfile or requirements file says how to install it."
                .to_string(),
        ),
        many => (
            None,
            many.iter().map(|m| m.to_string()).collect(),
            true,
            format!("Several Python tools are configured ({}).", many.join(", ")),
        ),
    };
    Some(ManagerDetection {
        ecosystem: Ecosystem::Python,
        manager,
        candidates,
        ambiguous,
        reason,
        evidence,
    })
}

fn single(ecosystem: Ecosystem, manager: &str, evidence: Vec<String>) -> ManagerDetection {
    ManagerDetection {
        ecosystem,
        manager: Some(manager.into()),
        candidates: vec![manager.into()],
        ambiguous: false,
        reason: format!("Found {}.", evidence.join(", ")),
        evidence,
    }
}

/// Detect package managers for every ecosystem present in the project.
pub fn detect(ws: &Workspace) -> Vec<ManagerDetection> {
    let mut out = Vec::new();
    out.extend(detect_node(ws));
    out.extend(detect_python(ws));
    if exists(ws, "Cargo.toml") {
        out.push(single(Ecosystem::Rust, "cargo", vec!["Cargo.toml".into()]));
    }
    let mut dotnet = files_with_extension(ws, "sln", 1);
    dotnet.extend(files_with_extension(ws, "csproj", 3));
    if !dotnet.is_empty() {
        dotnet.truncate(5);
        out.push(single(Ecosystem::DotNet, "dotnet", dotnet));
    }
    if exists(ws, "go.mod") {
        out.push(single(Ecosystem::Go, "go", vec!["go.mod".into()]));
    }
    out
}

/// Validate a package spec for the given manager. Rejects anything that
/// could be read as an option (leading `-`), paths, URLs, or shell syntax.
pub fn validate_package(manager: &str, spec: &str) -> AppResult<()> {
    let spec = spec.trim();
    let invalid =
        || AppError::validation(format!("\"{spec}\" is not a valid {manager} package name."));
    // Scoped npm packages and Go module paths are the only specs with '/'.
    let slash_allowed = manager == "go" || spec.starts_with('@');
    if spec.is_empty()
        || spec.len() > 214
        || spec.starts_with('-')
        || spec.contains('\\')
        || (spec.contains('/') && !slash_allowed)
        || spec.contains("://")
    {
        return Err(invalid());
    }
    let pattern = match manager {
        "npm" | "pnpm" | "yarn" | "bun" => {
            r"^(@[a-z0-9][a-z0-9._~-]*/)?[a-z0-9][a-z0-9._~-]*(@[A-Za-z0-9.^~<>=*|_ -]+)?$"
        }
        "pip" | "uv" | "poetry" | "pipenv" => {
            r"^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9_,-]+\])?((==|>=|<=|~=|!=|>|<)[A-Za-z0-9.*+!-]+)?$"
        }
        "cargo" => r"^[A-Za-z0-9][A-Za-z0-9_-]*(@[A-Za-z0-9.^~*<>=-]+)?$",
        "dotnet" => r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "go" => r"^[A-Za-z0-9][A-Za-z0-9._~/-]*(@[A-Za-z0-9.+-]+)?$",
        _ => {
            return Err(AppError::validation(format!(
                "Unsupported package manager: {manager}"
            )))
        }
    };
    let re = regex::Regex::new(pattern).expect("static regex");
    if manager == "go" {
        // Go module paths legitimately contain '/'.
        if spec.contains("..") || spec.contains('\\') || !re.is_match(spec) {
            return Err(invalid());
        }
        return Ok(());
    }
    if re.is_match(spec) {
        Ok(())
    } else {
        Err(invalid())
    }
}

/// Build the install command. With no packages, installs the project's
/// declared dependencies.
pub fn install_command(manager: &str, packages: &[String], dev: bool) -> AppResult<InstallCommand> {
    for p in packages {
        validate_package(manager, p)?;
    }
    if packages.len() > 20 {
        return Err(AppError::validation(
            "Install at most 20 packages at a time.",
        ));
    }
    let pkgs: Vec<String> = packages.iter().map(|p| p.trim().to_string()).collect();
    let (program, mut args): (&str, Vec<&str>) = match (manager, pkgs.is_empty()) {
        ("npm", true) => ("npm", vec!["install"]),
        ("npm", false) => (
            "npm",
            if dev {
                vec!["install", "--save-dev"]
            } else {
                vec!["install"]
            },
        ),
        ("pnpm", true) => ("pnpm", vec!["install"]),
        ("pnpm", false) => ("pnpm", if dev { vec!["add", "-D"] } else { vec!["add"] }),
        ("yarn", true) => ("yarn", vec!["install"]),
        ("yarn", false) => (
            "yarn",
            if dev {
                vec!["add", "--dev"]
            } else {
                vec!["add"]
            },
        ),
        ("bun", true) => ("bun", vec!["install"]),
        ("bun", false) => (
            "bun",
            if dev {
                vec!["add", "--dev"]
            } else {
                vec!["add"]
            },
        ),
        ("pip", true) => (
            "python",
            vec!["-m", "pip", "install", "-r", "requirements.txt"],
        ),
        ("pip", false) => ("python", vec!["-m", "pip", "install"]),
        ("uv", true) => ("uv", vec!["sync"]),
        ("uv", false) => (
            "uv",
            if dev {
                vec!["add", "--dev"]
            } else {
                vec!["add"]
            },
        ),
        ("poetry", true) => ("poetry", vec!["install"]),
        ("poetry", false) => (
            "poetry",
            if dev {
                vec!["add", "--group", "dev"]
            } else {
                vec!["add"]
            },
        ),
        ("pipenv", true) => ("pipenv", vec!["install"]),
        ("pipenv", false) => (
            "pipenv",
            if dev {
                vec!["install", "--dev"]
            } else {
                vec!["install"]
            },
        ),
        ("cargo", true) => ("cargo", vec!["fetch"]),
        ("cargo", false) => (
            "cargo",
            if dev {
                vec!["add", "--dev"]
            } else {
                vec!["add"]
            },
        ),
        ("dotnet", true) => ("dotnet", vec!["restore"]),
        ("dotnet", false) => {
            if pkgs.len() != 1 {
                return Err(AppError::validation("dotnet adds one package at a time."));
            }
            ("dotnet", vec!["add", "package"])
        }
        ("go", true) => ("go", vec!["mod", "download"]),
        ("go", false) => ("go", vec!["get"]),
        (other, _) => {
            return Err(AppError::validation(format!(
                "Unsupported package manager: {other}"
            )))
        }
    };
    let mut all: Vec<String> = args.drain(..).map(String::from).collect();
    all.extend(pkgs.iter().cloned());
    let display = std::iter::once(program.to_string())
        .chain(all.iter().map(|a| {
            if a.contains(' ') {
                format!("\"{a}\"")
            } else {
                a.clone()
            }
        }))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(InstallCommand {
        manager: manager.to_string(),
        program: program.to_string(),
        args: all,
        display,
        packages: pkgs,
    })
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

    fn node(ws: &Workspace) -> ManagerDetection {
        detect(ws)
            .into_iter()
            .find(|d| d.ecosystem == Ecosystem::Node)
            .unwrap()
    }

    #[test]
    fn detects_npm_and_pnpm_from_lockfiles() {
        let (_d, ws) = project(&[("package.json", "{}"), ("package-lock.json", "{}")]);
        assert_eq!(node(&ws).manager.as_deref(), Some("npm"));
        let (_d, ws) = project(&[("package.json", "{}"), ("pnpm-lock.yaml", "")]);
        let d = node(&ws);
        assert_eq!(d.manager.as_deref(), Some("pnpm"));
        assert!(!d.ambiguous);
        assert_eq!(d.evidence, vec!["package.json", "pnpm-lock.yaml"]);
    }

    #[test]
    fn multiple_lockfiles_are_ambiguous_unless_declared() {
        let (_d, ws) = project(&[
            ("package.json", "{}"),
            ("package-lock.json", "{}"),
            ("yarn.lock", ""),
        ]);
        let d = node(&ws);
        assert!(d.ambiguous);
        assert_eq!(d.manager, None);
        assert_eq!(d.candidates, vec!["npm", "yarn"]);

        let (_d, ws) = project(&[
            ("package.json", r#"{"packageManager": "yarn@4.1.0"}"#),
            ("package-lock.json", "{}"),
            ("yarn.lock", ""),
        ]);
        let d = node(&ws);
        assert_eq!(d.manager.as_deref(), Some("yarn"));
        assert!(!d.ambiguous);
    }

    #[test]
    fn package_json_without_lockfile_is_ambiguous() {
        let (_d, ws) = project(&[("package.json", "{}")]);
        let d = node(&ws);
        assert!(d.ambiguous);
        assert!(d.reason.contains("no lockfile"));
    }

    #[test]
    fn detects_pip_cargo_dotnet() {
        let (_d, ws) = project(&[
            ("requirements.txt", "requests\n"),
            ("Cargo.toml", "[package]\n"),
            ("src/App/App.csproj", "<Project/>"),
        ]);
        let found = detect(&ws);
        let by = |e: Ecosystem| found.iter().find(|d| d.ecosystem == e).unwrap().clone();
        assert_eq!(by(Ecosystem::Python).manager.as_deref(), Some("pip"));
        assert_eq!(by(Ecosystem::Rust).manager.as_deref(), Some("cargo"));
        let dotnet = by(Ecosystem::DotNet);
        assert_eq!(dotnet.manager.as_deref(), Some("dotnet"));
        assert_eq!(dotnet.evidence, vec!["src/App/App.csproj"]);
    }

    #[test]
    fn detects_poetry_and_python_ambiguity() {
        let (_d, ws) = project(&[("pyproject.toml", "[tool.poetry]\nname='x'\n")]);
        assert_eq!(detect(&ws)[0].manager.as_deref(), Some("poetry"));
        let (_d, ws) = project(&[("pyproject.toml", "[project]\nname='x'\n")]);
        assert!(detect(&ws)[0].ambiguous);
    }

    #[test]
    fn empty_project_has_no_managers() {
        let (_d, ws) = project(&[("README.md", "hi")]);
        assert!(detect(&ws).is_empty());
    }

    #[test]
    fn builds_install_commands() {
        let c = install_command("npm", &["express".into()], false).unwrap();
        assert_eq!(c.display, "npm install express");
        assert_eq!(
            install_command("pnpm", &["zod".into()], true)
                .unwrap()
                .display,
            "pnpm add -D zod"
        );
        assert_eq!(
            install_command("pip", &["requests".into()], false)
                .unwrap()
                .display,
            "python -m pip install requests"
        );
        assert_eq!(
            install_command("cargo", &["serde".into()], false)
                .unwrap()
                .display,
            "cargo add serde"
        );
        assert_eq!(
            install_command("pnpm", &[], false).unwrap().display,
            "pnpm install"
        );
        assert_eq!(
            install_command("pip", &[], false).unwrap().display,
            "python -m pip install -r requirements.txt"
        );
    }

    #[test]
    fn rejects_unsafe_package_specs() {
        for (manager, bad) in [
            ("npm", "--registry=http://evil"),
            ("npm", "express && del *"),
            ("npm", "../local-path"),
            ("npm", "http://evil/pkg.tgz"),
            ("pip", "-e ."),
            ("pip", "git+https://evil"),
            ("cargo", "serde;rm"),
            ("npm", ""),
        ] {
            assert!(
                install_command(manager, &[bad.into()], false).is_err(),
                "{manager} {bad}"
            );
        }
        for (manager, good) in [
            ("npm", "@types/node"),
            ("npm", "express@^4.19.0"),
            ("pip", "requests==2.32.3"),
            ("pip", "uvicorn[standard]"),
            ("cargo", "serde@1.0"),
            ("go", "github.com/gin-gonic/gin@v1.10.0"),
        ] {
            assert!(validate_package(manager, good).is_ok(), "{manager} {good}");
        }
    }
}
