use serde::Deserialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::ollama::launcher::{self, LaunchResult};
use crate::ollama::types::{
    ChatMessage, ChatOptions, ConnectionInfo, GenerationOutcome, ModelDetails, ModelInfo,
    StreamEvent,
};
use crate::ollama::{OllamaClient, StreamTimeouts};
use crate::settings::{self, validate_model_name};
use crate::state::AppState;

const MAX_HISTORY_MESSAGES: usize = 2_000;
const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const MAX_TOOLS: usize = 32;
const MAX_TOOL_SPEC_BYTES: usize = 16 * 1024;

fn client_for(state: &AppState, endpoint: Option<String>) -> AppResult<OllamaClient> {
    let endpoint = match endpoint {
        Some(endpoint) => endpoint,
        None => settings::load(&*state.db.conn()?)?.ollama_endpoint,
    };
    OllamaClient::new(state.http.clone(), &endpoint)
}

/// Check that Ollama is reachable. `endpoint` lets the settings screen test
/// an unsaved value; otherwise the saved endpoint is used.
#[tauri::command]
pub async fn check_connection(
    state: State<'_, AppState>,
    endpoint: Option<String>,
) -> AppResult<ConnectionInfo> {
    let client = client_for(&state, endpoint)?;
    let result = client.check_connection().await;
    match &result {
        Ok(info) => log::info!("connected to Ollama {} at {}", info.version, info.endpoint),
        Err(err) => log::warn!("Ollama connection check failed: {err}"),
    }
    result
}

#[tauri::command]
pub async fn list_models(
    state: State<'_, AppState>,
    endpoint: Option<String>,
) -> AppResult<Vec<ModelInfo>> {
    client_for(&state, endpoint)?.list_models().await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamRequest {
    pub request_id: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    /// Tool definitions offered to the model (Ollama/OpenAI function format).
    #[serde(default)]
    pub tools: Vec<serde_json::Value>,
    /// Context window to request (tokens).
    #[serde(default)]
    pub num_ctx: Option<u32>,
}

impl ChatStreamRequest {
    pub fn validate(&self) -> AppResult<()> {
        let id_ok = !self.request_id.is_empty()
            && self.request_id.len() <= 64
            && self
                .request_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-');
        if !id_ok {
            return Err(AppError::validation("Invalid request id."));
        }
        validate_model_name(&self.model)?;
        if self.messages.is_empty() {
            return Err(AppError::validation("There is nothing to send."));
        }
        if self.messages.len() > MAX_HISTORY_MESSAGES {
            return Err(AppError::validation(
                "This conversation is too long to send.",
            ));
        }
        let mut total = 0usize;
        for message in &self.messages {
            if !matches!(
                message.role.as_str(),
                "user" | "assistant" | "system" | "tool"
            ) {
                return Err(AppError::validation("Invalid message role."));
            }
            if message.tool_calls.is_some() && message.role != "assistant" {
                return Err(AppError::validation(
                    "Only assistant messages can contain tool calls.",
                ));
            }
            total += message.content.len();
        }
        if total > MAX_REQUEST_BYTES {
            return Err(AppError::validation(
                "This conversation is too large to send.",
            ));
        }
        if self
            .messages
            .last()
            .is_none_or(|m| m.role != "user" && m.role != "tool")
        {
            return Err(AppError::validation(
                "The last message must come from the user or a tool.",
            ));
        }
        if self.num_ctx.is_some_and(|n| !(512..=131_072).contains(&n)) {
            return Err(AppError::validation(
                "The context size must be between 512 and 131072 tokens.",
            ));
        }
        if self.tools.len() > MAX_TOOLS {
            return Err(AppError::validation("Too many tools."));
        }
        for tool in &self.tools {
            if !tool.is_object() || tool.to_string().len() > MAX_TOOL_SPEC_BYTES {
                return Err(AppError::validation("Invalid tool definition."));
            }
        }
        Ok(())
    }
}

/// Stream a chat response. Events are delivered over `on_event`; the
/// returned outcome carries the full text (partial when cancelled).
#[tauri::command]
pub async fn chat_stream(
    state: State<'_, AppState>,
    request: ChatStreamRequest,
    on_event: Channel<StreamEvent>,
) -> AppResult<GenerationOutcome> {
    request.validate()?;
    let model = validate_model_name(&request.model)?;
    let client = client_for(&state, None)?;
    let guard = state.generations.register(&request.request_id)?;
    let token = guard.token().clone();

    // Never log message content; only metadata.
    log::info!(
        "generation {} started: model={model}, messages={}, tools={}",
        request.request_id,
        request.messages.len(),
        request.tools.len()
    );

    let result = client
        .chat_stream(
            &model,
            &request.messages,
            &request.tools,
            ChatOptions {
                num_ctx: request.num_ctx,
            },
            guard.token(),
            StreamTimeouts::default(),
            |event| {
                if on_event.send(event).is_err() {
                    // The webview went away (reload/close); stop generating.
                    token.cancel();
                }
            },
        )
        .await;

    match &result {
        Ok(outcome) => log::info!(
            "generation {} finished: {:?}, {} chars, {} tool calls",
            request.request_id,
            outcome.status,
            outcome.content.len(),
            outcome.tool_calls.len()
        ),
        Err(err) => log::warn!(
            "generation {} failed: {:?}: {err}",
            request.request_id,
            err.kind
        ),
    }
    result
}

/// Context length and capabilities for a model.
#[tauri::command]
pub async fn model_details(state: State<'_, AppState>, model: String) -> AppResult<ModelDetails> {
    let model = validate_model_name(&model)?;
    client_for(&state, None)?.model_details(&model).await
}

/// Start `ollama serve` locally when the endpoint is on this computer and
/// nothing is answering there yet.
#[tauri::command]
pub async fn launch_ollama(state: State<'_, AppState>) -> AppResult<LaunchResult> {
    let endpoint = settings::load(&*state.db.conn()?)?.ollama_endpoint;
    let bind = launcher::local_bind_address(&endpoint)?;
    let client = OllamaClient::new(state.http.clone(), &endpoint)?;
    if client.check_connection().await.is_ok() {
        return Ok(LaunchResult {
            status: "alreadyRunning".into(),
            executable: None,
        });
    }
    let local_app_data = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from);
    let exe = launcher::locate(local_app_data.as_deref()).ok_or_else(|| {
        AppError::not_found(
            "Ollama is not installed (ollama.exe was not found). Download it from https://ollama.com/download, then try again.",
        )
    })?;
    launcher::spawn_serve(&exe, &bind)?;
    log::info!("started ollama serve from {} on {bind}", exe.display());
    Ok(LaunchResult {
        status: "started".into(),
        executable: Some(exe.display().to_string()),
    })
}

/// Ask a running generation to stop. Returns `false` if it already ended.
#[tauri::command]
pub fn cancel_generation(state: State<'_, AppState>, request_id: String) -> bool {
    let cancelled = state.generations.cancel(&request_id);
    log::info!("cancel requested for generation {request_id}: {cancelled}");
    cancelled
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(messages: Vec<(&str, &str)>) -> ChatStreamRequest {
        ChatStreamRequest {
            request_id: "abc-123".into(),
            model: "qwen3:8b".into(),
            messages: messages
                .into_iter()
                .map(|(role, content)| ChatMessage {
                    role: role.into(),
                    content: content.into(),
                    tool_calls: None,
                    tool_name: None,
                })
                .collect(),
            tools: vec![],
            num_ctx: None,
        }
    }

    #[test]
    fn accepts_valid_requests() {
        assert!(req(vec![("system", "be nice"), ("user", "hi")])
            .validate()
            .is_ok());
    }

    #[test]
    fn accepts_tool_results_as_the_last_message() {
        let mut r = req(vec![
            ("user", "find duty"),
            ("assistant", ""),
            ("tool", "{}"),
        ]);
        r.messages[1].tool_calls = Some(vec![
            serde_json::json!({"function": {"name": "search_files"}}),
        ]);
        assert!(r.validate().is_ok());
        r.messages[0].tool_calls = Some(vec![]);
        assert!(r.validate().is_err(), "users cannot send tool calls");
    }

    #[test]
    fn rejects_invalid_requests() {
        assert!(req(vec![]).validate().is_err());
        assert!(req(vec![("function", "x"), ("user", "hi")])
            .validate()
            .is_err());
        let mut too_many = req(vec![("user", "hi")]);
        too_many.tools = vec![serde_json::json!({}); 40];
        assert!(too_many.validate().is_err());
        let mut not_object = req(vec![("user", "hi")]);
        not_object.tools = vec![serde_json::json!("rm -rf")];
        assert!(not_object.validate().is_err());
        let mut huge_ctx = req(vec![("user", "hi")]);
        huge_ctx.num_ctx = Some(10_000_000);
        assert!(huge_ctx.validate().is_err());
        assert!(req(vec![("user", "hi"), ("assistant", "yo")])
            .validate()
            .is_err());
        let mut bad_id = req(vec![("user", "hi")]);
        bad_id.request_id = "../../etc".into();
        assert!(bad_id.validate().is_err());
        let mut bad_model = req(vec![("user", "hi")]);
        bad_model.model = "".into();
        assert!(bad_model.validate().is_err());
    }
}
