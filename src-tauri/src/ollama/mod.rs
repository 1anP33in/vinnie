//! Ollama model provider.

mod client;
mod stream;
#[cfg(test)]
mod test_server;
pub mod types;

pub use client::{build_http_client, OllamaClient, StreamTimeouts};
