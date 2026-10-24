//! Tracks in-flight generations so they can be cancelled by id.

use std::collections::HashMap;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult, ErrorKind};

#[derive(Default)]
pub struct GenerationRegistry {
    active: Mutex<HashMap<String, CancellationToken>>,
}

/// Removes the generation from the registry when dropped, so cleanup happens
/// on every exit path (success, error, cancel, or panic).
pub struct GenerationGuard<'a> {
    registry: &'a GenerationRegistry,
    id: String,
    token: CancellationToken,
}

impl GenerationGuard<'_> {
    pub fn token(&self) -> &CancellationToken {
        &self.token
    }
}

impl Drop for GenerationGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.registry.active.lock() {
            active.remove(&self.id);
        }
    }
}

impl GenerationRegistry {
    pub fn register(&self, id: &str) -> AppResult<GenerationGuard<'_>> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| AppError::internal("Generation registry lock poisoned."))?;
        if active.contains_key(id) {
            return Err(AppError::new(
                ErrorKind::Busy,
                "A response with this id is already being generated.",
            ));
        }
        let token = CancellationToken::new();
        active.insert(id.to_owned(), token.clone());
        Ok(GenerationGuard {
            registry: self,
            id: id.to_owned(),
            token,
        })
    }

    /// Request cancellation. Returns `false` if no such generation is running.
    pub fn cancel(&self, id: &str) -> bool {
        let Ok(active) = self.active.lock() else {
            return false;
        };
        match active.get(id) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    #[cfg(test)]
    pub fn active_count(&self) -> usize {
        self.active.lock().map(|a| a.len()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_cancel_and_cleanup() {
        let registry = GenerationRegistry::default();
        {
            let guard = registry.register("a").unwrap();
            assert_eq!(registry.active_count(), 1);
            assert!(!guard.token().is_cancelled());
            assert!(registry.cancel("a"));
            assert!(guard.token().is_cancelled());
        }
        assert_eq!(registry.active_count(), 0, "guard drop must unregister");
        assert!(!registry.cancel("a"));
    }

    #[test]
    fn duplicate_ids_are_rejected() {
        let registry = GenerationRegistry::default();
        let _guard = registry.register("a").unwrap();
        assert_eq!(registry.register("a").err().unwrap().kind, ErrorKind::Busy);
    }
}
