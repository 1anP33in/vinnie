//! Wire types for the Ollama HTTP API and the shapes Vinnie exposes to the UI.
//! See https://github.com/ollama/ollama/blob/main/docs/api.md

use serde::{Deserialize, Serialize};

// ---- Ollama wire format -----------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct VersionResponse {
    pub version: String,
}

#[derive(Debug, Deserialize)]
pub struct TagsResponse {
    pub models: Option<Vec<RawModel>>,
}

#[derive(Debug, Deserialize)]
pub struct RawModel {
    pub name: String,
    #[serde(default)]
    pub modified_at: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub details: Option<RawModelDetails>,
}

#[derive(Debug, Default, Deserialize)]
pub struct RawModelDetails {
    #[serde(default)]
    pub family: Option<String>,
    #[serde(default)]
    pub parameter_size: Option<String>,
    #[serde(default)]
    pub quantization_level: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ChatRequestBody<'a> {
    pub model: &'a str,
    pub messages: &'a [ChatMessage],
    pub stream: bool,
    #[serde(skip_serializing_if = "<[serde_json::Value]>::is_empty")]
    pub tools: &'a [serde_json::Value],
    #[serde(skip_serializing_if = "ChatOptions::is_empty")]
    pub options: ChatOptions,
}

/// Model options passed through to Ollama.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatOptions {
    /// Context window in tokens. Ollama otherwise uses its (small) default
    /// and silently truncates longer prompts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_ctx: Option<u32>,
}

impl ChatOptions {
    pub fn is_empty(&self) -> bool {
        self.num_ctx.is_none()
    }
}

/// Model details from `/api/show`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelDetails {
    pub name: String,
    /// Maximum context length the model supports, if reported.
    pub context_length: Option<u64>,
    /// e.g. ["completion", "tools", "thinking"]
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    /// Tool calls made by an assistant message (passed back verbatim).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<serde_json::Value>>,
    /// For `tool` messages: the tool whose result this is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
}

/// One NDJSON line of a streaming `/api/chat` response.
#[derive(Debug, Default, Deserialize, PartialEq)]
pub struct ChatChunk {
    #[serde(default)]
    pub message: Option<ChunkMessage>,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub done_reason: Option<String>,
    #[serde(default)]
    pub total_duration: Option<u64>,
    #[serde(default)]
    pub load_duration: Option<u64>,
    #[serde(default)]
    pub prompt_eval_count: Option<u64>,
    #[serde(default)]
    pub eval_count: Option<u64>,
    #[serde(default)]
    pub eval_duration: Option<u64>,
    /// Present when Ollama reports an error mid-stream.
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
pub struct ChunkMessage {
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub thinking: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<serde_json::Value>>,
}

// ---- Shapes exposed to the frontend ----------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub name: String,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<String>,
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization: Option<String>,
}

impl From<RawModel> for ModelInfo {
    fn from(raw: RawModel) -> Self {
        let details = raw.details.unwrap_or_default();
        Self {
            name: raw.name,
            size_bytes: raw.size,
            modified_at: raw.modified_at,
            family: details.family,
            parameter_size: details.parameter_size,
            quantization: details.quantization_level,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub endpoint: String,
    pub version: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationStats {
    pub done_reason: Option<String>,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_duration_ms: Option<u64>,
    pub load_duration_ms: Option<u64>,
    pub eval_duration_ms: Option<u64>,
}

impl GenerationStats {
    pub fn from_chunk(chunk: &ChatChunk) -> Self {
        let ms = |ns: Option<u64>| ns.map(|v| v / 1_000_000);
        Self {
            done_reason: chunk.done_reason.clone(),
            prompt_tokens: chunk.prompt_eval_count,
            completion_tokens: chunk.eval_count,
            total_duration_ms: ms(chunk.total_duration),
            load_duration_ms: ms(chunk.load_duration),
            eval_duration_ms: ms(chunk.eval_duration),
        }
    }
}

/// Incremental events delivered to the UI over a Tauri channel.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    /// Ollama accepted the request and began streaming.
    Started,
    Content {
        text: String,
    },
    Thinking {
        text: String,
    },
    Done {
        stats: GenerationStats,
    },
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GenerationStatus {
    Completed,
    Cancelled,
}

/// Final result of a generation. Partial output is preserved on cancel.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationOutcome {
    pub status: GenerationStatus,
    pub content: String,
    pub thinking: String,
    pub stats: Option<GenerationStats>,
    /// Tool calls the model requested (Ollama format). The app decides
    /// whether and how to execute them.
    pub tool_calls: Vec<serde_json::Value>,
}
