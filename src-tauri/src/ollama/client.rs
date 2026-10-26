//! HTTP client for a local Ollama server.

use std::time::Duration;

use futures_util::StreamExt;
use tokio_util::sync::CancellationToken;

use super::stream::NdjsonDecoder;
use super::types::{
    ChatChunk, ChatMessage, ChatOptions, ChatRequestBody, ConnectionInfo, GenerationOutcome,
    GenerationStats, GenerationStatus, ModelDetails, ModelInfo, StreamEvent, TagsResponse,
    VersionResponse,
};
use crate::error::{AppError, AppResult, ErrorKind};
use crate::settings::normalize_endpoint;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const LIST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_ERROR_BODY_CHARS: usize = 500;

#[derive(Debug, Clone, Copy)]
pub struct StreamTimeouts {
    /// How long to wait for Ollama to start responding. Generous because the
    /// model may need to be loaded into memory first.
    pub response: Duration,
    /// Maximum silence between streamed chunks.
    pub idle: Duration,
}

impl Default for StreamTimeouts {
    fn default() -> Self {
        Self {
            response: Duration::from_secs(300),
            idle: Duration::from_secs(120),
        }
    }
}

/// Build the shared HTTP client used for every Ollama request.
pub fn build_http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent(concat!("Vinnie/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| AppError::internal(format!("Could not create HTTP client: {e}")))
}

pub struct OllamaClient {
    http: reqwest::Client,
    base: String,
}

impl OllamaClient {
    pub fn new(http: reqwest::Client, endpoint: &str) -> AppResult<Self> {
        Ok(Self {
            http,
            base: normalize_endpoint(endpoint)?,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    fn map_request_error(&self, err: &reqwest::Error) -> AppError {
        if err.is_timeout() {
            AppError::new(
                ErrorKind::Timeout,
                format!("Ollama at {} did not respond in time.", self.base),
            )
        } else if err.is_connect() {
            AppError::new(
                ErrorKind::Unreachable,
                format!("Could not connect to Ollama at {}.", self.base),
            )
        } else if err.is_decode() {
            AppError::new(
                ErrorKind::Malformed,
                "Ollama sent a response Vinnie could not understand.",
            )
        } else {
            AppError::new(
                ErrorKind::Unreachable,
                format!("The request to Ollama at {} failed: {err}", self.base),
            )
        }
    }

    async fn error_from_response(&self, response: reqwest::Response) -> AppError {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_owned))
            .unwrap_or_else(|| body.chars().take(MAX_ERROR_BODY_CHARS).collect());
        let message = if message.trim().is_empty() {
            format!("Ollama returned HTTP {status}.")
        } else {
            message
        };
        let kind = if message.contains("does not support tools") {
            ErrorKind::ToolsUnsupported
        } else if status == reqwest::StatusCode::NOT_FOUND && message.contains("not found") {
            ErrorKind::ModelNotFound
        } else if is_model_output_error(&message) {
            ErrorKind::Malformed
        } else {
            ErrorKind::Http
        };
        AppError::new(kind, message)
    }

    async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        timeout: Duration,
    ) -> AppResult<T> {
        let response = self
            .http
            .get(self.url(path))
            .timeout(timeout)
            .send()
            .await
            .map_err(|e| self.map_request_error(&e))?;
        if !response.status().is_success() {
            return Err(self.error_from_response(response).await);
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|e| self.map_request_error(&e))?;
        serde_json::from_slice(&bytes).map_err(|_| {
            AppError::new(
                ErrorKind::Malformed,
                format!(
                    "The server at {} responded, but not like Ollama. Check the endpoint.",
                    self.base
                ),
            )
        })
    }

    /// Verify Ollama is reachable and report its version.
    pub async fn check_connection(&self) -> AppResult<ConnectionInfo> {
        let version: VersionResponse = self.get_json("/api/version", PROBE_TIMEOUT).await?;
        Ok(ConnectionInfo {
            endpoint: self.base.clone(),
            version: version.version,
        })
    }

    /// Context length and capabilities of one model (`/api/show`).
    pub async fn model_details(&self, model: &str) -> AppResult<ModelDetails> {
        let response = self
            .http
            .post(self.url("/api/show"))
            .timeout(LIST_TIMEOUT)
            .json(&serde_json::json!({ "model": model }))
            .send()
            .await
            .map_err(|e| self.map_request_error(&e))?;
        if !response.status().is_success() {
            return Err(self.error_from_response(response).await);
        }
        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| self.map_request_error(&e))?;
        Ok(parse_model_details(model, &json))
    }

    /// Installed models, sorted by name.
    pub async fn list_models(&self) -> AppResult<Vec<ModelInfo>> {
        let tags: TagsResponse = self.get_json("/api/tags", LIST_TIMEOUT).await?;
        let Some(models) = tags.models else {
            return Err(AppError::new(
                ErrorKind::Malformed,
                "Ollama's model list was missing the `models` field.",
            ));
        };
        let mut models: Vec<ModelInfo> = models.into_iter().map(ModelInfo::from).collect();
        models.sort_by_key(|m| m.name.to_lowercase());
        Ok(models)
    }

    /// Stream a chat completion, invoking `emit` for each event.
    ///
    /// Returns `Cancelled` (with the partial output) when `cancel` fires. The
    /// HTTP response is dropped on cancel, which closes the connection and
    /// tells Ollama to stop generating.
    #[allow(clippy::too_many_arguments)]
    pub async fn chat_stream<F>(
        &self,
        model: &str,
        messages: &[ChatMessage],
        tools: &[serde_json::Value],
        options: ChatOptions,
        cancel: &CancellationToken,
        timeouts: StreamTimeouts,
        mut emit: F,
    ) -> AppResult<GenerationOutcome>
    where
        F: FnMut(StreamEvent),
    {
        let mut outcome = GenerationOutcome {
            status: GenerationStatus::Completed,
            content: String::new(),
            thinking: String::new(),
            stats: None,
            tool_calls: Vec::new(),
        };
        let cancelled = |mut outcome: GenerationOutcome| {
            outcome.status = GenerationStatus::Cancelled;
            Ok(outcome)
        };

        let body = ChatRequestBody {
            model,
            messages,
            stream: true,
            tools,
            options,
        };
        let send = self.http.post(self.url("/api/chat")).json(&body).send();

        let response = tokio::select! {
            biased;
            _ = cancel.cancelled() => return cancelled(outcome),
            result = tokio::time::timeout(timeouts.response, send) => match result {
                Err(_) => return Err(AppError::new(
                    ErrorKind::Timeout,
                    "Ollama took too long to start responding. The model may still be loading; try again shortly.",
                )),
                Ok(Err(e)) => return Err(self.map_request_error(&e)),
                Ok(Ok(response)) => response,
            },
        };
        if !response.status().is_success() {
            return Err(self.error_from_response(response).await);
        }
        emit(StreamEvent::Started);

        let mut stream = response.bytes_stream();
        let mut decoder = NdjsonDecoder::default();

        loop {
            let next = tokio::select! {
                biased;
                _ = cancel.cancelled() => return cancelled(outcome),
                next = tokio::time::timeout(timeouts.idle, stream.next()) => next,
            };
            let bytes = match next {
                Err(_) => {
                    return Err(AppError::new(
                        ErrorKind::Timeout,
                        "Ollama stopped sending data partway through the response.",
                    ))
                }
                Ok(None) => break,
                Ok(Some(Err(e))) => {
                    return Err(AppError::new(
                        ErrorKind::Interrupted,
                        format!("The connection to Ollama was interrupted: {e}"),
                    ))
                }
                Ok(Some(Ok(bytes))) => bytes,
            };
            for chunk in decoder.push(&bytes) {
                if apply_chunk(chunk?, &mut outcome, &mut emit)? {
                    return Ok(outcome);
                }
            }
        }

        if let Some(chunk) = decoder.finish() {
            if apply_chunk(chunk?, &mut outcome, &mut emit)? {
                return Ok(outcome);
            }
        }
        Err(AppError::new(
            ErrorKind::Interrupted,
            "The connection to Ollama closed before the response finished.",
        ))
    }
}

/// Extract the context length (`<arch>.context_length`) and capabilities.
pub fn parse_model_details(model: &str, json: &serde_json::Value) -> ModelDetails {
    let context_length = json
        .get("model_info")
        .and_then(|i| i.as_object())
        .and_then(|info| {
            info.iter()
                .find(|(k, _)| k.ends_with(".context_length"))
                .and_then(|(_, v)| v.as_u64())
        });
    let capabilities = json
        .get("capabilities")
        .and_then(|c| c.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    ModelDetails {
        name: model.to_string(),
        context_length,
        capabilities,
    }
}

/// Ollama reports tool calls it could not parse from the model's output as
/// errors (e.g. "Value looks like object, but can't find closing '}' symbol").
/// These are malformed model output, which a retry usually fixes.
fn is_model_output_error(message: &str) -> bool {
    let m = message.to_ascii_lowercase();
    m.contains("can't find closing")
        || m.contains("error parsing tool call")
        || m.contains("failed to parse tool call")
        || m.contains("value looks like object")
}

/// Fold one chunk into the outcome. Returns `true` when the stream is done.
fn apply_chunk<F: FnMut(StreamEvent)>(
    chunk: ChatChunk,
    outcome: &mut GenerationOutcome,
    emit: &mut F,
) -> AppResult<bool> {
    if let Some(error) = chunk.error {
        let kind = if error.contains("not found") {
            ErrorKind::ModelNotFound
        } else if is_model_output_error(&error) {
            ErrorKind::Malformed
        } else {
            ErrorKind::Http
        };
        return Err(AppError::new(kind, error));
    }
    if let Some(message) = &chunk.message {
        if let Some(thinking) = message.thinking.as_deref().filter(|t| !t.is_empty()) {
            outcome.thinking.push_str(thinking);
            emit(StreamEvent::Thinking {
                text: thinking.to_owned(),
            });
        }
        if let Some(content) = message.content.as_deref().filter(|c| !c.is_empty()) {
            outcome.content.push_str(content);
            emit(StreamEvent::Content {
                text: content.to_owned(),
            });
        }
        if let Some(calls) = &message.tool_calls {
            outcome.tool_calls.extend(calls.iter().cloned());
        }
    }
    if chunk.done {
        let stats = GenerationStats::from_chunk(&chunk);
        outcome.stats = Some(stats.clone());
        emit(StreamEvent::Done { stats });
        return Ok(true);
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ollama::test_server::{self, MockResponse};

    fn client(base: &str) -> OllamaClient {
        OllamaClient::new(build_http_client().unwrap(), base).unwrap()
    }

    fn fast() -> StreamTimeouts {
        StreamTimeouts {
            response: Duration::from_millis(500),
            idle: Duration::from_millis(500),
        }
    }

    fn msgs() -> Vec<ChatMessage> {
        vec![ChatMessage {
            role: "user".into(),
            content: "hi".into(),
            tool_calls: None,
            tool_name: None,
        }]
    }

    const STREAM: &str = concat!(
        r#"{"model":"m","message":{"role":"assistant","content":"","thinking":"Hmm"},"done":false}"#,
        "\n",
        r#"{"model":"m","message":{"role":"assistant","content":"Hello"},"done":false}"#,
        "\n",
        r#"{"model":"m","message":{"role":"assistant","content":", world"},"done":false}"#,
        "\n",
        r#"{"model":"m","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","eval_count":3,"eval_duration":2000000}"#,
        "\n",
    );

    #[tokio::test]
    async fn reports_version_when_reachable() {
        let (base, _) =
            test_server::serve(vec![MockResponse::json(200, r#"{"version":"0.35.1"}"#)]).await;
        let info = client(&base).check_connection().await.unwrap();
        assert_eq!(info.version, "0.35.1");
        assert_eq!(info.endpoint, base);
    }

    #[tokio::test]
    async fn unreachable_server_is_reported() {
        let base = test_server::closed_port_url().await;
        let err = client(&base).check_connection().await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::Unreachable);
    }

    #[tokio::test]
    async fn non_ollama_server_is_reported_as_malformed() {
        let (base, _) = test_server::serve(vec![MockResponse::json(200, "<html>hi</html>")]).await;
        let err = client(&base).check_connection().await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::Malformed);
    }

    #[tokio::test]
    async fn parses_and_sorts_model_list() {
        let body = r#"{"models":[
            {"name":"qwen3:8b","model":"qwen3:8b","modified_at":"2026-01-01T00:00:00Z","size":5200000000,
             "digest":"abc","details":{"family":"qwen3","parameter_size":"8.2B","quantization_level":"Q4_K_M"}},
            {"name":"Llama3:latest","size":1}
        ]}"#;
        let (base, _) = test_server::serve(vec![MockResponse::json(200, body)]).await;
        let models = client(&base).list_models().await.unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].name, "Llama3:latest");
        assert_eq!(models[1].family.as_deref(), Some("qwen3"));
        assert_eq!(models[1].parameter_size.as_deref(), Some("8.2B"));
        assert_eq!(models[1].quantization.as_deref(), Some("Q4_K_M"));
    }

    #[tokio::test]
    async fn empty_model_list_is_ok() {
        let (base, _) = test_server::serve(vec![MockResponse::json(200, r#"{"models":[]}"#)]).await;
        assert!(client(&base).list_models().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn model_list_without_models_field_is_malformed() {
        let (base, _) = test_server::serve(vec![MockResponse::json(200, r#"{"items":[]}"#)]).await;
        let err = client(&base).list_models().await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::Malformed);
    }

    #[tokio::test]
    async fn streams_tokens_thinking_and_stats() {
        let (base, requests) = test_server::serve(vec![MockResponse::chunked(
            200,
            STREAM.as_bytes().chunks(17).map(|c| c.to_vec()).collect(),
        )])
        .await;
        let mut events = Vec::new();
        let outcome = client(&base)
            .chat_stream(
                "m",
                &msgs(),
                &[],
                ChatOptions::default(),
                &CancellationToken::new(),
                fast(),
                |e| events.push(e),
            )
            .await
            .unwrap();
        assert_eq!(outcome.status, GenerationStatus::Completed);
        assert_eq!(outcome.content, "Hello, world");
        assert_eq!(outcome.thinking, "Hmm");
        assert_eq!(outcome.stats.as_ref().unwrap().completion_tokens, Some(3));
        assert_eq!(events.first(), Some(&StreamEvent::Started));
        assert!(matches!(events.last(), Some(StreamEvent::Done { .. })));

        let request = requests.lock().await[0].clone();
        assert!(request.starts_with("POST /api/chat"));
        assert!(request.contains(r#""stream":true"#));
        assert!(request.contains(r#""model":"m""#));
    }

    #[tokio::test]
    async fn collects_tool_calls_and_sends_tools() {
        let body = concat!(
            r#"{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"search_files","arguments":{"query":"duty"}}}]},"done":false}"#,
            "
",
            r#"{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}"#,
            "
"
        );
        let (base, requests) =
            test_server::serve(vec![MockResponse::chunked(200, vec![body.into()])]).await;
        let tools =
            vec![serde_json::json!({"type": "function", "function": {"name": "search_files"}})];
        let outcome = client(&base)
            .chat_stream(
                "m",
                &msgs(),
                &tools,
                ChatOptions::default(),
                &CancellationToken::new(),
                fast(),
                |_| {},
            )
            .await
            .unwrap();
        assert_eq!(outcome.tool_calls.len(), 1);
        assert_eq!(outcome.tool_calls[0]["function"]["name"], "search_files");
        assert_eq!(
            outcome.tool_calls[0]["function"]["arguments"]["query"],
            "duty"
        );
        let request = requests.lock().await[0].clone();
        assert!(request.contains(r#""tools":[{"#));
    }

    #[tokio::test]
    async fn models_without_tool_support_are_reported() {
        let (base, _) = test_server::serve(vec![MockResponse::json(
            400,
            r#"{"error":"registry.ollama.ai/library/gemma:2b does not support tools"}"#,
        )])
        .await;
        let tools = vec![serde_json::json!({"type": "function"})];
        let err = client(&base)
            .chat_stream(
                "m",
                &msgs(),
                &tools,
                ChatOptions::default(),
                &CancellationToken::new(),
                fast(),
                |_| {},
            )
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::ToolsUnsupported);
    }

    #[tokio::test]
    async fn requests_without_tools_omit_the_field() {
        let (base, requests) =
            test_server::serve(vec![MockResponse::chunked(200, vec![STREAM.into()])]).await;
        client(&base)
            .chat_stream(
                "m",
                &msgs(),
                &[],
                ChatOptions::default(),
                &CancellationToken::new(),
                fast(),
                |_| {},
            )
            .await
            .unwrap();
        assert!(!requests.lock().await[0].contains("\"tools\""));
    }

    #[test]
    fn parses_model_details() {
        let json = serde_json::json!({
            "model_info": { "general.architecture": "qwen3", "qwen3.context_length": 40960 },
            "capabilities": ["completion", "tools", "thinking"]
        });
        let d = parse_model_details("qwen3:8b", &json);
        assert_eq!(d.context_length, Some(40960));
        assert_eq!(d.capabilities, vec!["completion", "tools", "thinking"]);
        assert_eq!(
            parse_model_details("x", &serde_json::json!({})).context_length,
            None
        );
    }

    #[tokio::test]
    async fn sends_num_ctx_only_when_set() {
        let (base, requests) =
            test_server::serve(vec![MockResponse::chunked(200, vec![STREAM.into()])]).await;
        client(&base)
            .chat_stream(
                "m",
                &msgs(),
                &[],
                ChatOptions {
                    num_ctx: Some(8192),
                },
                &CancellationToken::new(),
                fast(),
                |_| {},
            )
            .await
            .unwrap();
        assert!(requests.lock().await[0].contains(r#""options":{"num_ctx":8192}"#));
    }

    #[tokio::test]
    async fn missing_model_maps_to_model_not_found() {
        let (base, _) = test_server::serve(vec![MockResponse::json(
            404,
            r#"{"error":"model 'nope' not found"}"#,
        )])
        .await;
        let err = client(&base)
            .chat_stream(
                "nope",
                &msgs(),
                &[],
                ChatOptions::default(),
                &CancellationToken::new(),
                fast(),
                |_| {},
            )
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::ModelNotFound);
        assert_eq!(err.message, "model 'nope' not found");
    }

    #[tokio::test]
    async fn unparseable_tool_call_is_malformed() {
        let (base, _) = test_server::serve(vec![MockResponse::json(
            200,
            r#"{"error":"Value looks like object, but can't find closing '}' symbol"}"#,
        )])
        .await;
        let err = client(&base)
            .chat_stream(
                "m",
                &msgs(),
                &[],
                ChatOptions::default(),
                &CancellationToken::new(),
                fast(),
                |_| {},
            )
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::Malformed);
    }

    #[tokio::test]
    async fn server_error_maps_to_http() {
        let (base, _) = test_server::serve(vec![MockResponse::json(
            500,
            r#"{"error":"out of memory"}"#,
        )])
        .await;
        let err = client(&base)
            .chat_stream(
                "m",
                &msgs(),
                &[],
                ChatOptions::default(),
                &CancellationToken::new(),
                fast(),
                |_| {},
            )
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::Http);
        assert_eq!(err.message, "out of memory");
    }

    #[tokio::test]
    async fn mid_stream_error_is_surfaced() {
        let body =
            "{\"message\":{\"content\":\"Hi\"},\"done\":false}\n{\"error\":\"runner crashed\"}\n";
        let (base, _) =
            test_server::serve(vec![MockResponse::chunked(200, vec![body.into()])]).await;
        let err = client(&base)
            .chat_stream(
                "m",
                &msgs(),
                &[],
                ChatOptions::default(),
                &CancellationToken::new(),
                fast(),
                |_| {},
            )
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::Http);
        assert_eq!(err.message, "runner crashed");
    }

    #[tokio::test]
    async fn connection_closed_before_done_is_interrupted() {
        let body = "{\"message\":{\"content\":\"Hi\"},\"done\":false}\n";
        let (base, _) =
            test_server::serve(vec![MockResponse::chunked(200, vec![body.into()])]).await;
        let mut content = String::new();
        let err = client(&base)
            .chat_stream(
                "m",
                &msgs(),
                &[],
                ChatOptions::default(),
                &CancellationToken::new(),
                fast(),
                |e| {
                    if let StreamEvent::Content { text } = e {
                        content.push_str(&text);
                    }
                },
            )
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::Interrupted);
        assert_eq!(content, "Hi", "partial output must still reach the UI");
    }

    #[tokio::test]
    async fn malformed_stream_line_is_reported() {
        let (base, _) = test_server::serve(vec![MockResponse::chunked(
            200,
            vec![b"not json\n".to_vec()],
        )])
        .await;
        let err = client(&base)
            .chat_stream(
                "m",
                &msgs(),
                &[],
                ChatOptions::default(),
                &CancellationToken::new(),
                fast(),
                |_| {},
            )
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::Malformed);
    }

    #[tokio::test]
    async fn silent_server_times_out() {
        let (base, _) = test_server::serve(vec![MockResponse::silent()]).await;
        let err = client(&base)
            .chat_stream(
                "m",
                &msgs(),
                &[],
                ChatOptions::default(),
                &CancellationToken::new(),
                fast(),
                |_| {},
            )
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::Timeout);
    }

    #[tokio::test]
    async fn stalled_stream_times_out() {
        let first = "{\"message\":{\"content\":\"Hi\"},\"done\":false}\n";
        let (base, _) = test_server::serve(vec![
            MockResponse::chunked(200, vec![first.into()]).hold_open(Duration::from_secs(5))
        ])
        .await;
        let err = client(&base)
            .chat_stream(
                "m",
                &msgs(),
                &[],
                ChatOptions::default(),
                &CancellationToken::new(),
                fast(),
                |_| {},
            )
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::Timeout);
    }

    #[tokio::test]
    async fn cancellation_stops_stream_and_keeps_partial_output() {
        let first = "{\"message\":{\"content\":\"Partial\"},\"done\":false}\n";
        let (base, _) = test_server::serve(vec![
            MockResponse::chunked(200, vec![first.into()]).hold_open(Duration::from_secs(10))
        ])
        .await;
        let cancel = CancellationToken::new();
        let trigger = cancel.clone();
        let started = std::time::Instant::now();
        let outcome = client(&base)
            .chat_stream(
                "m",
                &msgs(),
                &[],
                ChatOptions::default(),
                &cancel,
                StreamTimeouts::default(),
                move |e| {
                    if matches!(e, StreamEvent::Content { .. }) {
                        trigger.cancel();
                    }
                },
            )
            .await
            .unwrap();
        assert_eq!(outcome.status, GenerationStatus::Cancelled);
        assert_eq!(outcome.content, "Partial");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "cancel must not wait for the server"
        );
    }

    #[tokio::test]
    async fn cancellation_before_response_returns_immediately() {
        let (base, _) = test_server::serve(vec![MockResponse::silent()]).await;
        let cancel = CancellationToken::new();
        cancel.cancel();
        let outcome = client(&base)
            .chat_stream(
                "m",
                &msgs(),
                &[],
                ChatOptions::default(),
                &cancel,
                StreamTimeouts::default(),
                |_| {},
            )
            .await
            .unwrap();
        assert_eq!(outcome.status, GenerationStatus::Cancelled);
        assert!(outcome.content.is_empty());
    }
}
