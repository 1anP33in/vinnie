//! MCP commands. The frontend only ever names a server: the command, URL,
//! and secrets used are read from the backend's own store.

use std::path::PathBuf;

use tauri::ipc::Channel;
use tauri::State;

use super::workspace::validate_id;
use crate::error::AppResult;
use crate::mcp::config::{self, McpServerConfig, McpServerInput, TransportType};
use crate::mcp::http::{self, BodyEvent, HttpRequest, HttpResponseHead};
use crate::mcp::logs::LogEntry;
use crate::mcp::stdio::{LaunchSpec, StdioEvent};
use crate::mcp::{self, SecretChanges};
use crate::state::AppState;

#[tauri::command]
pub fn mcp_list_servers(state: State<'_, AppState>) -> AppResult<Vec<McpServerConfig>> {
    config::list(&*state.db.conn()?)
}

#[tauri::command]
pub fn mcp_save_server(
    state: State<'_, AppState>,
    server: McpServerInput,
    secrets: SecretChanges,
    is_new: bool,
) -> AppResult<McpServerConfig> {
    let conn = state.db.conn()?;
    mcp::save_server(&conn, state.mcp.secrets.as_ref(), &server, &secrets, is_new)
}

#[tauri::command]
pub fn mcp_delete_server(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.mcp.stdio.stop(&id);
    state.mcp.logs.clear(&id);
    let conn = state.db.conn()?;
    mcp::delete_server(&conn, state.mcp.secrets.as_ref(), &id)?;
    log::info!("mcp server {id} removed");
    Ok(())
}

#[tauri::command]
pub fn mcp_mark_connected(state: State<'_, AppState>, id: String) -> AppResult<()> {
    config::mark_connected(&*state.db.conn()?, &id)
}

#[derive(serde::Serialize)]
pub struct Started {
    pid: u32,
}

#[tauri::command]
pub async fn mcp_stdio_start(
    state: State<'_, AppState>,
    server_id: String,
    on_event: Channel<StdioEvent>,
) -> AppResult<Started> {
    let (server, resolved) = {
        let conn = state.db.conn()?;
        let server = mcp::enabled_server(&conn, &server_id, TransportType::Stdio)?;
        let resolved = mcp::resolve_secrets(state.mcp.secrets.as_ref(), &server)?;
        (server, resolved)
    };
    let mut env = server.input.env.clone();
    env.extend(resolved.env);
    let spec = LaunchSpec {
        server_id: server.input.id.clone(),
        command: server.input.command.clone().unwrap_or_default(),
        args: server.input.args.clone(),
        env,
        cwd: server
            .input
            .cwd
            .as_deref()
            .filter(|c| !c.trim().is_empty())
            .map(PathBuf::from),
        secrets: resolved.values,
    };
    let pid = state
        .mcp
        .stdio
        .start(spec, state.mcp.logs.clone(), move |event| {
            let _ = on_event.send(event);
        })
        .await
        .inspect_err(|e| state.mcp.logs.push(&server_id, "error", e.message.clone()))?;
    Ok(Started { pid })
}

#[tauri::command]
pub async fn mcp_stdio_send(
    state: State<'_, AppState>,
    server_id: String,
    line: String,
) -> AppResult<()> {
    state.mcp.stdio.send(&server_id, &line).await
}

#[tauri::command]
pub fn mcp_stdio_stop(state: State<'_, AppState>, server_id: String) -> bool {
    state.mcp.stdio.stop(&server_id)
}

#[tauri::command]
pub async fn mcp_http_fetch(
    state: State<'_, AppState>,
    server_id: String,
    request: HttpRequest,
    on_body: Channel<BodyEvent>,
) -> AppResult<HttpResponseHead> {
    validate_id(&request.request_id, "request")?;
    let (server, resolved) = {
        let conn = state.db.conn()?;
        let server = mcp::enabled_server(&conn, &server_id, TransportType::Http)?;
        let resolved = mcp::resolve_secrets(state.mcp.secrets.as_ref(), &server)?;
        (server, resolved)
    };
    let configured = config::validate_url(server.input.url.as_deref().unwrap_or(""))?;
    let url = http::check_origin(&configured, &request.url)?;
    let headers = http::merge_headers(&request.headers, &server.input.headers, &resolved.headers)?;
    let secrets = resolved.values;
    let logs = state.mcp.logs.clone();
    let result = state
        .mcp
        .http
        .fetch(&state.mcp.client, url, request, headers, move |event| {
            let _ = on_body.send(event);
        })
        .await;
    if let Err(e) = &result {
        logs.push(
            &server_id,
            "error",
            crate::mcp::secrets::redact(&e.message, &secrets),
        );
    }
    result.inspect(|head| {
        if head.status >= 400 {
            logs.push(
                &server_id,
                "warn",
                format!("HTTP {} {}", head.status, head.status_text),
            );
        }
    })
}

#[tauri::command]
pub fn mcp_http_abort(state: State<'_, AppState>, request_id: String) -> bool {
    state.mcp.http.abort(&request_id)
}

#[tauri::command]
pub fn mcp_server_logs(state: State<'_, AppState>, server_id: String) -> Vec<LogEntry> {
    state.mcp.logs.get(&server_id)
}
