//! Application error type shared by every command.
//!
//! Errors cross the IPC boundary as `{ kind, message }` so the frontend can
//! choose a friendly presentation per kind without parsing message text.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// Input failed validation at the command boundary.
    Validation,
    /// A referenced record does not exist.
    NotFound,
    /// SQLite or persistence failure.
    Database,
    /// Ollama could not be reached (connection refused, DNS, etc.).
    Unreachable,
    /// Ollama did not respond in time.
    Timeout,
    /// Ollama returned a non-success HTTP status.
    Http,
    /// The requested model is not installed.
    ModelNotFound,
    /// Ollama returned data we could not understand.
    Malformed,
    /// The stream ended before the response completed.
    Interrupted,
    /// A generation with the same id is already running.
    Busy,
    /// Filesystem failure.
    Io,
    /// Unexpected internal failure.
    Internal,
    /// The path is outside the workspace or otherwise not allowed.
    Forbidden,
    /// The command is blocked by the command policy.
    Blocked,
    /// The permission settings deny this operation for the assistant.
    PermissionDenied,
    /// The operation needs explicit user approval first.
    ApprovalRequired,
    /// The file changed since it was read (external modification).
    Conflict,
    /// The selected model cannot use tools.
    ToolsUnsupported,
    /// No project folder is selected (or it is unavailable).
    NoWorkspace,
}

#[derive(Debug, Clone, Serialize, thiserror::Error, PartialEq, Eq)]
#[error("{message}")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Validation, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::NotFound, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Forbidden, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Conflict, message)
    }

    /// Wrap an I/O error with the (workspace-relative) path it concerns.
    pub fn io(path: &str, err: &std::io::Error) -> Self {
        let message = match err.kind() {
            std::io::ErrorKind::NotFound => format!("{path} does not exist."),
            std::io::ErrorKind::PermissionDenied => {
                format!("Windows denied access to {path}. It may be read-only or open in another program.")
            }
            std::io::ErrorKind::AlreadyExists => format!("{path} already exists."),
            _ => format!("Could not access {path}: {err}"),
        };
        let kind = if err.kind() == std::io::ErrorKind::NotFound {
            ErrorKind::NotFound
        } else {
            ErrorKind::Io
        };
        Self::new(kind, message)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        log::error!("database error: {err}");
        match err {
            rusqlite::Error::QueryReturnedNoRows => AppError::not_found("Record not found."),
            other => AppError::new(
                ErrorKind::Database,
                format!("The local database reported an error: {other}"),
            ),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::new(ErrorKind::Io, err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_kind_and_message() {
        let err = AppError::new(ErrorKind::ModelNotFound, "model 'x' not found");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "model_not_found");
        assert_eq!(json["message"], "model 'x' not found");
    }

    #[test]
    fn no_rows_maps_to_not_found() {
        let err: AppError = rusqlite::Error::QueryReturnedNoRows.into();
        assert_eq!(err.kind, ErrorKind::NotFound);
    }
}
