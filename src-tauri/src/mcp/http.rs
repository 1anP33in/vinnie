//! Remote (Streamable HTTP) MCP servers: the backend half of the SDK's
//! `fetch`.
//!
//! - Requests may only go to the configured server's origin; redirects are
//!   not followed, so credentials can't be sent elsewhere.
//! - Authorization and cookies come only from the server's stored secrets
//!   and headers, never from the webview.
//! - Response bodies are streamed back (SSE) and size-limited.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::process::Utf8Chunker;

pub const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;
const MAX_REQUEST_BODY: usize = 8 * 1024 * 1024;
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(60);

/// Headers the webview may not set.
const BLOCKED_REQUEST_HEADERS: &[&str] = &[
    "authorization",
    "cookie",
    "proxy-authorization",
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub request_id: String,
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponseHead {
    pub status: u16,
    pub status_text: String,
    pub headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BodyEvent {
    Chunk { data: String },
    End,
    Error { message: String },
}

pub fn build_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("Vinnie/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| AppError::internal(format!("Could not create the HTTP client: {e}")))
}

/// The request must target the server's own origin (scheme, host, port).
pub fn check_origin(configured: &url::Url, requested: &str) -> AppResult<url::Url> {
    let url =
        url::Url::parse(requested).map_err(|_| AppError::validation("Invalid request URL."))?;
    if url.origin() != configured.origin() {
        return Err(AppError::forbidden(
            "MCP requests may only go to the server's configured address.",
        ));
    }
    Ok(url)
}

/// Combine the webview's headers (minus blocked ones) with the server's
/// configured headers and secrets (which win).
pub fn merge_headers(
    from_webview: &BTreeMap<String, String>,
    configured: &BTreeMap<String, String>,
    secret: &BTreeMap<String, String>,
) -> AppResult<reqwest::header::HeaderMap> {
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
    let mut map = HeaderMap::new();
    let mut put = |k: &str, v: &str| -> AppResult<()> {
        let name = HeaderName::from_bytes(k.as_bytes())
            .map_err(|_| AppError::validation(format!("Invalid header name `{k}`.")))?;
        let mut value = HeaderValue::from_str(v)
            .map_err(|_| AppError::validation(format!("Invalid value for header `{k}`.")))?;
        if secret.contains_key(k) {
            value.set_sensitive(true);
        }
        map.insert(name, value);
        Ok(())
    };
    for (k, v) in from_webview {
        if !BLOCKED_REQUEST_HEADERS.contains(&k.to_ascii_lowercase().as_str()) {
            put(k, v)?;
        }
    }
    for (k, v) in configured.iter().chain(secret.iter()) {
        put(k, v)?;
    }
    Ok(map)
}

#[derive(Default)]
pub struct HttpRequests {
    active: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl HttpRequests {
    pub fn abort(&self, id: &str) -> bool {
        match self.active.lock().ok().and_then(|mut a| a.remove(id)) {
            Some(t) => {
                t.cancel();
                true
            }
            None => false,
        }
    }

    /// Send the request; stream the body through `emit` in the background.
    pub async fn fetch<F>(
        &self,
        client: &reqwest::Client,
        url: url::Url,
        request: HttpRequest,
        headers: reqwest::header::HeaderMap,
        emit: F,
    ) -> AppResult<HttpResponseHead>
    where
        F: Fn(BodyEvent) + Send + Sync + 'static,
    {
        let method = match request.method.to_ascii_uppercase().as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "DELETE" => reqwest::Method::DELETE,
            other => {
                return Err(AppError::validation(format!(
                    "Method {other} is not used by MCP."
                )))
            }
        };
        if request
            .body
            .as_ref()
            .is_some_and(|b| b.len() > MAX_REQUEST_BODY)
        {
            return Err(AppError::validation("The request body is too large."));
        }
        let token = CancellationToken::new();
        self.active
            .lock()
            .map_err(|_| AppError::internal("Request registry lock poisoned."))?
            .insert(request.request_id.clone(), token.clone());

        let mut builder = client.request(method, url).headers(headers);
        if let Some(body) = request.body {
            builder = builder.body(body);
        }
        let send = tokio::time::timeout(RESPONSE_TIMEOUT, builder.send());
        let response = tokio::select! {
            r = send => r,
            _ = token.cancelled() => {
                self.abort(&request.request_id);
                return Err(AppError::new(ErrorKind::Interrupted, "The request was aborted."));
            }
        };
        let response = match response {
            Err(_) => {
                self.abort(&request.request_id);
                return Err(AppError::new(
                    ErrorKind::Timeout,
                    "The MCP server did not respond within 60 seconds.",
                ));
            }
            Ok(Err(e)) => {
                self.abort(&request.request_id);
                let kind = if e.is_connect() {
                    ErrorKind::Unreachable
                } else {
                    ErrorKind::Http
                };
                return Err(AppError::new(
                    kind,
                    format!("Could not reach the MCP server: {e}"),
                ));
            }
            Ok(Ok(r)) => r,
        };

        let head = HttpResponseHead {
            status: response.status().as_u16(),
            status_text: response
                .status()
                .canonical_reason()
                .unwrap_or("")
                .to_owned(),
            headers: response
                .headers()
                .iter()
                .filter(|(k, _)| k.as_str() != "set-cookie")
                .filter_map(|(k, v)| {
                    v.to_str()
                        .ok()
                        .map(|v| (k.as_str().to_owned(), v.to_owned()))
                })
                .collect(),
        };

        let id = request.request_id.clone();
        let active = self.active.clone();
        tokio::spawn(async move {
            let mut stream = response.bytes_stream();
            let mut decoder = Utf8Chunker::default();
            let mut total = 0usize;
            loop {
                tokio::select! {
                    _ = token.cancelled() => break,
                    next = stream.next() => match next {
                        Some(Ok(bytes)) => {
                            total += bytes.len();
                            if total > MAX_BODY_BYTES {
                                emit(BodyEvent::Error { message: "The server's response is larger than 16 MB.".into() });
                                break;
                            }
                            let text = decoder.push(&bytes);
                            if !text.is_empty() {
                                emit(BodyEvent::Chunk { data: text });
                            }
                        }
                        Some(Err(e)) => {
                            emit(BodyEvent::Error { message: format!("The connection to the MCP server failed: {e}") });
                            break;
                        }
                        None => {
                            let rest = decoder.finish();
                            if !rest.is_empty() {
                                emit(BodyEvent::Chunk { data: rest });
                            }
                            emit(BodyEvent::End);
                            break;
                        }
                    }
                }
            }
            if let Ok(mut active) = active.lock() {
                active.remove(&id);
            }
        });
        Ok(head)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_configured_origin_is_allowed() {
        let configured = url::Url::parse("https://mcp.example.com/mcp").unwrap();
        assert!(check_origin(&configured, "https://mcp.example.com/mcp?x=1").is_ok());
        assert!(check_origin(&configured, "https://mcp.example.com/other").is_ok());
        assert!(check_origin(&configured, "https://evil.example.com/mcp").is_err());
        assert!(check_origin(&configured, "http://mcp.example.com/mcp").is_err());
        assert!(check_origin(&configured, "https://mcp.example.com:8443/mcp").is_err());
    }

    #[test]
    fn webview_cannot_set_credentials_and_secrets_win() {
        let mut from_webview = BTreeMap::new();
        from_webview.insert("Authorization".to_string(), "Bearer forged".to_string());
        from_webview.insert("Cookie".to_string(), "a=b".to_string());
        from_webview.insert(
            "Accept".to_string(),
            "application/json, text/event-stream".to_string(),
        );
        from_webview.insert("mcp-session-id".to_string(), "abc".to_string());
        let mut configured = BTreeMap::new();
        configured.insert("X-Team".to_string(), "core".to_string());
        let mut secret = BTreeMap::new();
        secret.insert("Authorization".to_string(), "Bearer real".to_string());
        let h = merge_headers(&from_webview, &configured, &secret).unwrap();
        assert_eq!(h.get("authorization").unwrap(), "Bearer real");
        assert!(h.get("authorization").unwrap().is_sensitive());
        assert!(h.get("cookie").is_none());
        assert_eq!(h.get("mcp-session-id").unwrap(), "abc");
        assert_eq!(h.get("x-team").unwrap(), "core");
    }
}
