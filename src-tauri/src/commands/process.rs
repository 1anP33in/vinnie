//! Terminal commands: policy checks, approvals, and execution.

use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

use super::workspace::validate_id;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::permissions::{Actor, Capability, PermissionLevel, PermissionSettings};
use crate::process::policy::{self, CommandAssessment, RiskLevel};
use crate::process::{self, ProcessEvent, ProcessOutcome};
use crate::state::AppState;
use crate::workspace::{display_rel, Workspace};

/// What must happen before a command may run for a given actor.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Requirement {
    /// May run immediately.
    Allowed,
    /// Needs explicit approval in the UI.
    Approval,
    /// The permission settings deny it.
    Denied,
    /// The command policy blocks it.
    Blocked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandCheck {
    pub assessment: CommandAssessment,
    pub requirement: Requirement,
    /// The user previously chose "Always allow" for this exact command.
    pub always_allowed: bool,
    pub workspace: String,
}

fn is_allowlisted(conn: &Connection, ws: &Workspace, command: &str) -> AppResult<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM command_allowlist WHERE workspace = ?1 AND command = ?2",
            params![ws.root().display().to_string(), command],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

/// Decide what an actor needs before running an assessed command.
pub fn requirement(
    assessment: &CommandAssessment,
    actor: Actor,
    permissions: &PermissionSettings,
    always_allowed: bool,
) -> Requirement {
    if assessment.risk == RiskLevel::Blocked {
        return Requirement::Blocked;
    }
    if actor == Actor::User {
        return Requirement::Allowed;
    }
    let cap = if assessment.installs_dependencies {
        Capability::InstallDependencies
    } else {
        Capability::Execute
    };
    match permissions.level(cap) {
        PermissionLevel::Denied => Requirement::Denied,
        PermissionLevel::Allowed => Requirement::Allowed,
        PermissionLevel::Approval if assessment.risk == RiskLevel::Low => Requirement::Allowed,
        PermissionLevel::Approval if always_allowed => Requirement::Allowed,
        PermissionLevel::Approval => Requirement::Approval,
    }
}

fn check(
    state: &AppState,
    command: &str,
    actor: Actor,
) -> AppResult<(CommandCheck, Workspace, Duration)> {
    let (ws, settings) = state.workspace()?;
    let assessment = policy::assess(command)?;
    let always_allowed = is_allowlisted(&*state.db.conn()?, &ws, &assessment.command)?;
    let requirement = requirement(&assessment, actor, &settings.permissions, always_allowed);
    let check = CommandCheck {
        workspace: ws.root().display().to_string(),
        assessment,
        requirement,
        always_allowed,
    };
    Ok((check, ws, process::DEFAULT_TIMEOUT))
}

/// Classify a command without running it (drives the approval UI).
#[tauri::command(async)]
pub fn assess_command(
    state: State<'_, AppState>,
    command: String,
    actor: Option<Actor>,
) -> AppResult<CommandCheck> {
    check(&state, &command, actor.unwrap_or_default()).map(|(c, ..)| c)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub run_id: String,
    pub command: String,
    /// Working directory relative to the project root.
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    #[serde(default)]
    pub actor: Actor,
    /// The user approved this command in the approval UI.
    #[serde(default)]
    pub approved: bool,
    /// "Always allow" this exact command in this workspace.
    #[serde(default)]
    pub remember: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub assessment: CommandAssessment,
    pub outcome: ProcessOutcome,
}

#[tauri::command]
pub async fn run_command(
    state: State<'_, AppState>,
    request: RunRequest,
    on_event: Channel<ProcessEvent>,
) -> AppResult<RunResult> {
    validate_id(&request.run_id, "run")?;
    let (check, ws, default_timeout) = check(&state, &request.command, request.actor)?;
    let assessment = check.assessment.clone();
    match check.requirement {
        Requirement::Blocked => {
            log::warn!("blocked command: {}", assessment.program);
            return Err(AppError::new(ErrorKind::Blocked, assessment.reason));
        }
        Requirement::Denied => {
            return Err(AppError::new(
                ErrorKind::PermissionDenied,
                "Your permission settings do not allow Vinnie to run this command.",
            ))
        }
        Requirement::Approval if !request.approved => {
            return Err(AppError::new(
                ErrorKind::ApprovalRequired,
                format!(
                    "`{}` needs your approval before it runs.",
                    assessment.command
                ),
            ))
        }
        _ => {}
    }
    if request.remember && request.approved && request.actor == Actor::Assistant {
        state.db.conn()?.execute(
            "INSERT OR IGNORE INTO command_allowlist (workspace, command, created_at) VALUES (?1, ?2, ?3)",
            params![check.workspace, assessment.command, crate::db::now_ms()],
        )?;
        log::info!("command added to allowlist");
    }

    // Re-check the actual executable after PATH resolution.
    if let Ok(resolved) = process::resolve_program(&assessment.program) {
        if policy::is_blocked_executable(&resolved) {
            log::warn!("blocked command after resolution: {}", resolved.display());
            return Err(AppError::new(
                ErrorKind::Blocked,
                format!(
                    "`{}` resolves to {}, which is blocked by Vinnie's command policy.",
                    assessment.program,
                    resolved.display()
                ),
            ));
        }
    }

    let cwd = ws.resolve_existing(request.cwd.as_deref().unwrap_or(""))?;
    if !cwd.is_dir() {
        return Err(AppError::validation(format!(
            "{} is not a folder.",
            display_rel(request.cwd.as_deref().unwrap_or(""))
        )));
    }
    let timeout = request
        .timeout_secs
        .map(|s| Duration::from_secs(s.clamp(1, process::MAX_TIMEOUT.as_secs())))
        .unwrap_or(default_timeout);

    let guard = state.processes.register(&request.run_id)?;
    let token = guard.token().clone();
    let shown: String = assessment.command.chars().take(200).collect();
    log::info!(
        "command {} start: `{shown}` actor={:?} risk={:?}",
        request.run_id,
        request.actor,
        assessment.risk
    );
    let result = process::run(
        &assessment.program,
        &assessment.args,
        &cwd,
        timeout,
        guard.token(),
        |event| {
            if on_event.send(event).is_err() {
                token.cancel();
            }
        },
    )
    .await;
    match &result {
        Ok(o) => log::info!(
            "command {} exit={:?} timed_out={} cancelled={} {}ms",
            request.run_id,
            o.exit_code,
            o.timed_out,
            o.cancelled,
            o.duration_ms
        ),
        Err(e) => log::warn!("command {} failed to start: {}", request.run_id, e.message),
    }
    Ok(RunResult {
        assessment,
        outcome: result?,
    })
}

#[tauri::command]
pub fn cancel_command(state: State<'_, AppState>, run_id: String) -> bool {
    state.processes.cancel(&run_id)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowedCommand {
    pub command: String,
    pub created_at: i64,
}

#[tauri::command(async)]
pub fn allowlist_list(state: State<'_, AppState>) -> AppResult<Vec<AllowedCommand>> {
    let (ws, _) = state.workspace()?;
    let conn = state.db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT command, created_at FROM command_allowlist WHERE workspace = ?1 ORDER BY command",
    )?;
    let rows = stmt
        .query_map(params![ws.root().display().to_string()], |r| {
            Ok(AllowedCommand {
                command: r.get(0)?,
                created_at: r.get(1)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

#[tauri::command(async)]
pub fn allowlist_remove(state: State<'_, AppState>, command: String) -> AppResult<()> {
    let (ws, _) = state.workspace()?;
    state.db.conn()?.execute(
        "DELETE FROM command_allowlist WHERE workspace = ?1 AND command = ?2",
        params![ws.root().display().to_string(), command],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(cmd: &str, actor: Actor, perms: &PermissionSettings, always: bool) -> Requirement {
        requirement(&policy::assess(cmd).unwrap(), actor, perms, always)
    }

    #[test]
    fn assistant_requirements_follow_policy_and_permissions() {
        let p = PermissionSettings::default();
        assert_eq!(
            req("npm test", Actor::Assistant, &p, false),
            Requirement::Allowed
        );
        assert_eq!(
            req("npm install express", Actor::Assistant, &p, false),
            Requirement::Approval
        );
        assert_eq!(
            req("git checkout main", Actor::Assistant, &p, false),
            Requirement::Approval
        );
        assert_eq!(
            req("git checkout main", Actor::Assistant, &p, true),
            Requirement::Allowed
        );
        assert_eq!(
            req("diskpart", Actor::Assistant, &p, true),
            Requirement::Blocked
        );

        let auto_install = PermissionSettings {
            install_dependencies: PermissionLevel::Allowed,
            ..p.clone()
        };
        assert_eq!(
            req(
                "npm install express",
                Actor::Assistant,
                &auto_install,
                false
            ),
            Requirement::Allowed
        );
        assert_eq!(
            req("git checkout main", Actor::Assistant, &auto_install, false),
            Requirement::Approval
        );

        let no_exec = PermissionSettings {
            execute: PermissionLevel::Denied,
            ..p
        };
        assert_eq!(
            req("npm test", Actor::Assistant, &no_exec, false),
            Requirement::Denied
        );
    }

    #[test]
    fn users_can_run_anything_except_blocked_commands() {
        let p = PermissionSettings::default();
        assert_eq!(
            req("npm install", Actor::User, &p, false),
            Requirement::Allowed
        );
        assert_eq!(
            req("node server.js", Actor::User, &p, false),
            Requirement::Allowed
        );
        assert_eq!(
            req("del /q *", Actor::User, &p, false),
            Requirement::Blocked
        );
    }
}
