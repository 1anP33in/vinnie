//! Directory names skipped by the explorer, search, and analysis.
//! The list lives in settings, so users can change it.

use std::collections::HashSet;

pub const DEFAULT_IGNORED_DIRECTORIES: &[&str] = &[
    "node_modules",
    ".git",
    ".vscode",
    ".idea",
    "bin",
    "obj",
    "dist",
    "build",
    "__pycache__",
    "target",
];

#[derive(Debug, Clone)]
pub struct IgnoreRules {
    names: HashSet<String>,
}

impl IgnoreRules {
    pub fn new<I: IntoIterator<Item = S>, S: AsRef<str>>(names: I) -> Self {
        Self {
            names: names
                .into_iter()
                .map(|n| n.as_ref().trim().to_ascii_lowercase())
                .filter(|n| !n.is_empty())
                .collect(),
        }
    }

    /// Directory names are matched case-insensitively, as on Windows.
    pub fn is_ignored_dir(&self, name: &str) -> bool {
        self.names.contains(&name.to_ascii_lowercase())
    }
}

impl Default for IgnoreRules {
    fn default() -> Self {
        Self::new(DEFAULT_IGNORED_DIRECTORIES)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_case_insensitively() {
        let rules = IgnoreRules::default();
        assert!(rules.is_ignored_dir("node_modules"));
        assert!(rules.is_ignored_dir("Node_Modules"));
        assert!(!rules.is_ignored_dir("src"));
        let custom = IgnoreRules::new(["vendor", " "]);
        assert!(custom.is_ignored_dir("VENDOR"));
        assert!(!custom.is_ignored_dir("node_modules"));
    }
}
