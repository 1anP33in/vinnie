//! Incremental NDJSON decoding for Ollama's streaming responses.
//!
//! Network chunks do not align with JSON lines (or even UTF-8 characters), so
//! bytes are buffered until a newline completes a line.

use super::types::ChatChunk;
use crate::error::{AppError, AppResult, ErrorKind};

/// Upper bound for a single line; protects against unbounded buffering.
const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Default)]
pub struct NdjsonDecoder {
    buf: Vec<u8>,
}

fn malformed(detail: impl std::fmt::Display) -> AppError {
    AppError::new(
        ErrorKind::Malformed,
        format!("Ollama sent a response Vinnie could not understand ({detail})."),
    )
}

fn parse_line(line: &[u8]) -> Option<AppResult<ChatChunk>> {
    let line = line.trim_ascii();
    if line.is_empty() {
        return None;
    }
    Some(serde_json::from_slice::<ChatChunk>(line).map_err(malformed))
}

impl NdjsonDecoder {
    /// Feed raw bytes; returns every complete line decoded so far.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<AppResult<ChatChunk>> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=pos).collect();
            if let Some(item) = parse_line(&line) {
                out.push(item);
            }
        }
        if self.buf.len() > MAX_LINE_BYTES {
            self.buf.clear();
            out.push(Err(malformed("line too long")));
        }
        out
    }

    /// Decode any trailing line that was not newline-terminated.
    pub fn finish(&mut self) -> Option<AppResult<ChatChunk>> {
        let rest = std::mem::take(&mut self.buf);
        parse_line(&rest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content(chunk: &ChatChunk) -> &str {
        chunk
            .message
            .as_ref()
            .and_then(|m| m.content.as_deref())
            .unwrap_or("")
    }

    #[test]
    fn decodes_lines_split_across_chunks() {
        let mut d = NdjsonDecoder::default();
        let a = d.push(br#"{"message":{"role":"assistant","content":"Hel"#);
        assert!(a.is_empty());
        let b = d.push(
            b"lo\"},\"done\":false}\n{\"message\":{\"content\":\" world\"},\"done\":false}\n",
        );
        let texts: Vec<_> = b
            .iter()
            .map(|r| content(r.as_ref().unwrap()).to_string())
            .collect();
        assert_eq!(texts, vec!["Hello", " world"]);
    }

    #[test]
    fn handles_utf8_split_mid_character() {
        let line = "{\"message\":{\"content\":\"❄️ ice\"},\"done\":false}\n".as_bytes();
        let mut d = NdjsonDecoder::default();
        let (first, second) = line.split_at(25); // splits inside the snowflake
        assert!(d.push(first).is_empty());
        let out = d.push(second);
        assert_eq!(content(out[0].as_ref().unwrap()), "❄️ ice");
    }

    #[test]
    fn parses_thinking_done_and_stats() {
        let mut d = NdjsonDecoder::default();
        let out = d.push(
            b"{\"message\":{\"content\":\"\",\"thinking\":\"Okay\"},\"done\":false}\r\n\
              {\"done\":true,\"done_reason\":\"stop\",\"eval_count\":12,\"eval_duration\":5000000}\n",
        );
        let first = out[0].as_ref().unwrap();
        assert_eq!(
            first.message.as_ref().unwrap().thinking.as_deref(),
            Some("Okay")
        );
        let last = out[1].as_ref().unwrap();
        assert!(last.done);
        assert_eq!(last.done_reason.as_deref(), Some("stop"));
        assert_eq!(last.eval_count, Some(12));
    }

    #[test]
    fn skips_blank_lines_and_reports_malformed_json() {
        let mut d = NdjsonDecoder::default();
        let out = d.push(b"\n\n{oops}\n{\"done\":true}\n");
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].as_ref().unwrap_err().kind, ErrorKind::Malformed);
        assert!(out[1].as_ref().unwrap().done);
    }

    #[test]
    fn finish_flushes_unterminated_line() {
        let mut d = NdjsonDecoder::default();
        assert!(d.push(b"{\"done\":true}").is_empty());
        assert!(d.finish().unwrap().unwrap().done);
        assert!(d.finish().is_none());
    }

    #[test]
    fn parses_mid_stream_error_objects() {
        let mut d = NdjsonDecoder::default();
        let out = d.push(b"{\"error\":\"model runner crashed\"}\n");
        assert_eq!(
            out[0].as_ref().unwrap().error.as_deref(),
            Some("model runner crashed")
        );
    }
}
