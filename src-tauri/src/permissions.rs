//! Workspace permission model, enforced in the backend.
//!
//! Requests made on the assistant's behalf carry `actor: assistant` and are
//! checked against the user's permission settings. The model has no way to
//! change these settings: they are only written by the Settings screen.
//! Direct user actions (`actor: user`) are the user's own intent and are not
//! gated, but still pass through the same workspace and command policies.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, ErrorKind};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Capability {
    Read,
    Write,
    Execute,
    InstallDependencies,
}

impl Capability {
    fn label(self) -> &'static str {
        match self {
            Capability::Read => "read project files",
            Capability::Write => "change project files",
            Capability::Execute => "run commands",
            Capability::InstallDependencies => "install dependencies",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionLevel {
    Allowed,
    Approval,
    Denied,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct PermissionSettings {
    pub read: PermissionLevel,
    pub write: PermissionLevel,
    pub execute: PermissionLevel,
    pub install_dependencies: PermissionLevel,
}

impl Default for PermissionSettings {
    fn default() -> Self {
        Self {
            read: PermissionLevel::Allowed,
            write: PermissionLevel::Approval,
            execute: PermissionLevel::Approval,
            install_dependencies: PermissionLevel::Approval,
        }
    }
}

impl PermissionSettings {
    pub fn level(&self, cap: Capability) -> PermissionLevel {
        match cap {
            Capability::Read => self.read,
            Capability::Write => self.write,
            Capability::Execute => self.execute,
            Capability::InstallDependencies => self.install_dependencies,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Actor {
    #[default]
    User,
    Assistant,
}

/// Check whether `actor` may use `cap`. `approved` is true only when the
/// user explicitly approved this specific request in the approval UI.
pub fn check(
    settings: &PermissionSettings,
    actor: Actor,
    cap: Capability,
    approved: bool,
) -> AppResult<()> {
    if actor == Actor::User {
        return Ok(());
    }
    match settings.level(cap) {
        PermissionLevel::Allowed => Ok(()),
        PermissionLevel::Approval if approved => Ok(()),
        PermissionLevel::Approval => Err(AppError::new(
            ErrorKind::ApprovalRequired,
            format!("Vinnie needs your approval to {}.", cap.label()),
        )),
        PermissionLevel::Denied => Err(AppError::new(
            ErrorKind::PermissionDenied,
            format!(
                "Your permission settings do not allow Vinnie to {}. You can change this in Settings.",
                cap.label()
            ),
        )),
    }
}

/// Files whose contents are likely secrets. The assistant must get explicit
/// approval to read them, even when READ is allowed.
pub fn is_sensitive_path(rel: &str) -> bool {
    let lower = rel.replace('\\', "/").to_ascii_lowercase();
    let name = lower.rsplit('/').next().unwrap_or(&lower);
    if name == ".env.example" || name == ".env.sample" || name == ".env.template" {
        return false;
    }
    name == ".env"
        || name.starts_with(".env.")
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name.ends_with(".pfx")
        || name.ends_with(".p12")
        || name == "id_rsa"
        || name == "id_ed25519"
        || name == ".npmrc"
        || name == ".pypirc"
        || name == "credentials.json"
        || name == "secrets.json"
        || name == "server.cfg"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_spec() {
        let p = PermissionSettings::default();
        assert_eq!(p.read, PermissionLevel::Allowed);
        assert_eq!(p.write, PermissionLevel::Approval);
        assert_eq!(p.execute, PermissionLevel::Approval);
        assert_eq!(p.install_dependencies, PermissionLevel::Approval);
    }

    #[test]
    fn assistant_requests_are_gated() {
        let p = PermissionSettings::default();
        assert!(check(&p, Actor::Assistant, Capability::Read, false).is_ok());
        assert_eq!(
            check(&p, Actor::Assistant, Capability::Write, false)
                .unwrap_err()
                .kind,
            ErrorKind::ApprovalRequired
        );
        assert!(check(&p, Actor::Assistant, Capability::Write, true).is_ok());

        let denied = PermissionSettings {
            execute: PermissionLevel::Denied,
            ..p.clone()
        };
        assert_eq!(
            check(&denied, Actor::Assistant, Capability::Execute, true)
                .unwrap_err()
                .kind,
            ErrorKind::PermissionDenied,
            "approval cannot override a denial"
        );
    }

    #[test]
    fn user_actions_are_not_gated() {
        let denied = PermissionSettings {
            read: PermissionLevel::Denied,
            write: PermissionLevel::Denied,
            execute: PermissionLevel::Denied,
            install_dependencies: PermissionLevel::Denied,
        };
        assert!(check(&denied, Actor::User, Capability::Write, false).is_ok());
    }

    #[test]
    fn sensitive_files() {
        for p in [
            ".env",
            "config/.env.local",
            "certs/server.pem",
            "id_rsa",
            "server.cfg",
            ".npmrc",
        ] {
            assert!(is_sensitive_path(p), "{p}");
        }
        for p in [".env.example", "src/env.ts", "config.lua", "README.md"] {
            assert!(!is_sensitive_path(p), "{p}");
        }
    }
}
