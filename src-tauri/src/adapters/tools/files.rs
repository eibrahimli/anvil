use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tokio::fs;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;
use serde::{Serialize, Deserialize};

fn expand_tilde(input: &str) -> String {
    if input.starts_with("~") {
        if let Some(home) = dirs::home_dir() {
            return input.replacen("~", &home.to_string_lossy(), 1);
        }
    }
    input.to_string()
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component),
        }
    }
    normalized
}

fn canonicalize_or_normalize(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| normalize_path(path))
}

fn path_variants(input: &str, workspace_root: &Path) -> Vec<String> {
    if input.trim().is_empty() {
        return Vec::new();
    }

    let expanded = expand_tilde(input);
    let path = if Path::new(&expanded).is_absolute() {
        PathBuf::from(&expanded)
    } else {
        workspace_root.join(&expanded)
    };

    let normalized = normalize_path(&path);
    let mut variants = Vec::new();
    let absolute = normalized.to_string_lossy().to_string();
    if !absolute.is_empty() {
        variants.push(absolute.clone());
    }

    if normalized.starts_with(workspace_root) {
        if let Ok(relative) = normalized.strip_prefix(workspace_root) {
            let relative = relative.to_string_lossy().to_string();
            if !relative.is_empty() {
                variants.push(relative);
            }
        }
    }

    variants
}

fn add_allow_rule_with_variants(
    rules: &mut Vec<crate::config::manager::PermissionRule>,
    pattern: String,
    suggested_pattern: &str,
    workspace_root: &Path,
) {
    if pattern.trim().is_empty() {
        return;
    }

    let mut push_rule = |value: String| {
        if value.trim().is_empty() {
            return;
        }
        let exists = rules.iter().any(|rule| {
            rule.pattern == value && rule.action == crate::config::Action::Allow
        });
        if !exists {
            rules.push(crate::config::manager::PermissionRule {
                pattern: value,
                action: crate::config::Action::Allow,
            });
        }
    };

    push_rule(pattern.clone());

    if pattern == suggested_pattern {
        for variant in path_variants(suggested_pattern, workspace_root) {
            if variant != pattern {
                push_rule(variant);
            }
        }
    }
}

#[derive(Serialize, Clone)]
struct ConfirmationRequest {
    id: String,
    session_id: String,
    #[serde(rename = "type")]
    type_: String,
    file_path: String,
    old_content: Option<String>,
    new_content: String,
    suggested_pattern: String,
}

pub struct ReadFileTool {
    pub workspace_root: PathBuf,
    pub permission_manager: Arc<tokio::sync::Mutex<crate::config::PermissionConfig>>,
    pub session_id: String,
    pub app: AppHandle,
    pub pending_confirmations: Arc<Mutex<HashMap<String, oneshot::Sender<crate::domain::models::ConfirmationResponse>>>>,
}

impl ReadFileTool {
    pub fn new(
        workspace_root: PathBuf,
        session_id: String,
        app: AppHandle,
        pending_confirmations: Arc<Mutex<HashMap<String, oneshot::Sender<crate::domain::models::ConfirmationResponse>>>>,
        permission_manager: Arc<tokio::sync::Mutex<crate::config::PermissionConfig>>,
    ) -> Self {
        Self { workspace_root, permission_manager, session_id, app, pending_confirmations }
    }
}

#[derive(Serialize, Clone)]
struct PermissionConfirmationRequest {
    id: String,
    session_id: String,
    #[serde(rename = "type")]
    type_: String,
    tool_name: String,
    input: String,
    suggested_pattern: String,
}

#[async_trait]
impl Tool for ReadFileTool {
    fn name(&self) -> &'static str {
        "read_file"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "read_file",
            "description": "Read the contents of a file",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to the file relative to workspace root"
                    }
                },
                "required": ["path"]
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let path_str = input.get("path")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'path' parameter")?;

        // Expand ~ to home directory
        let expanded_path_str = expand_tilde(path_str);

        // Construct target path (handle absolute vs relative)
        let path = if std::path::Path::new(&expanded_path_str).is_absolute() {
            PathBuf::from(expanded_path_str.clone())
        } else {
            self.workspace_root.join(&expanded_path_str)
        };

        // Check if path is allowed (Workspace OR External)
        let location_action = {
            let config = self.permission_manager.lock().await;
            config.check_path_access(&path, &self.workspace_root)
        };
        
        if location_action == crate::config::Action::Deny {
            return Err("Access denied: Path is outside workspace and not allowed by config".to_string());
        }

        if location_action == crate::config::Action::Ask {
            let request_id = Uuid::new_v4().to_string();
            let (tx, rx) = oneshot::channel();

            {
                let mut map = self.pending_confirmations.lock().unwrap();
                map.insert(request_id.clone(), tx);
            }

            let suggested_pattern = canonicalize_or_normalize(&path).to_string_lossy().to_string();
            let event = PermissionConfirmationRequest {
                id: request_id.clone(),
                session_id: self.session_id.clone(),
                type_: "permission".to_string(),
                tool_name: "read_file".to_string(),
                input: expanded_path_str.clone(),
                suggested_pattern: suggested_pattern.clone(),
            };

            self.app.emit("request-confirmation", &event)
                .map_err(|e| format!("Failed to emit confirmation event: {}", e))?;

            let response = rx.await.map_err(|_| "Confirmation channel closed without response".to_string())?;

            if !response.allowed {
                return Err("User denied file read.".to_string());
            }

            if response.always {
                let pattern = response.pattern.unwrap_or(suggested_pattern);
                let mut config = self.permission_manager.lock().await;
                let rules = config.external_directory.get_or_insert_with(HashMap::new);
                rules.insert(pattern, crate::config::Action::Allow);
            }
        }

        // Check if specific file is allowed (e.g. .env protection)
        let action = {
            let config = self.permission_manager.lock().await;
            config.read.evaluate(path_str)
        };
        
        match action {
            crate::config::Action::Deny => {
                return Err("Access denied: Permission denied for this file type".to_string());
            }
            crate::config::Action::Ask => {
                let request_id = Uuid::new_v4().to_string();
                let (tx, rx) = oneshot::channel();

                {
                    let mut map = self.pending_confirmations.lock().unwrap();
                    map.insert(request_id.clone(), tx);
                }

                let suggested_pattern = path_str.to_string();
                let event = PermissionConfirmationRequest {
                    id: request_id.clone(),
                    session_id: self.session_id.clone(),
                    type_: "permission".to_string(),
                    tool_name: "read_file".to_string(),
                    input: path_str.to_string(),
                    suggested_pattern: suggested_pattern.clone(),
                };

                self.app.emit("request-confirmation", &event)
                    .map_err(|e| format!("Failed to emit confirmation event: {}", e))?;

                let response = rx.await.map_err(|_| "Confirmation channel closed without response".to_string())?;

                if !response.allowed {
                    return Err("User denied file read.".to_string());
                }

                if response.always {
                    let pattern = response.pattern.unwrap_or(suggested_pattern.clone());
                    let mut config = self.permission_manager.lock().await;
                    add_allow_rule_with_variants(
                        &mut config.read.rules,
                        pattern,
                        &suggested_pattern,
                        &self.workspace_root,
                    );
                }
            }
            crate::config::Action::Allow => {}
        }

        match fs::read_to_string(path).await {
            Ok(content) => Ok(json!({ "content": content })),
            Err(e) => Err(format!("Failed to read file: {}", e)),
        }
    }
}

pub struct WriteFileTool {
    pub workspace_root: PathBuf,
    pub session_id: String,
    pub app: AppHandle,
    pub pending_confirmations: Arc<Mutex<HashMap<String, oneshot::Sender<crate::domain::models::ConfirmationResponse>>>>,
    pub permission_manager: Arc<tokio::sync::Mutex<crate::config::PermissionConfig>>,
}

impl WriteFileTool {
    pub fn new(
        workspace_root: PathBuf,
        session_id: String,
        app: AppHandle,
        pending_confirmations: Arc<Mutex<HashMap<String, oneshot::Sender<crate::domain::models::ConfirmationResponse>>>>,
        permission_manager: Arc<tokio::sync::Mutex<crate::config::PermissionConfig>>,
    ) -> Self {
        Self { 
            workspace_root,
            session_id,
            app,
            pending_confirmations,
            permission_manager,
        }
    }
}

#[async_trait]
impl Tool for WriteFileTool {
    fn name(&self) -> &'static str {
        "write_file"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "write_file",
            "description": "Overwrite a file with new content",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to the file relative to workspace root"
                    },
                    "content": {
                        "type": "string",
                        "description": "New content for the file"
                    }
                },
                "required": ["path", "content"]
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let path_str = input.get("path")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'path' parameter")?;
        
        // Expand ~ to home directory
        let expanded_path_str = expand_tilde(path_str);

        let content = input.get("content")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'content' parameter")?;

        // Construct target path (handle absolute vs relative)
        let path = if std::path::Path::new(&expanded_path_str).is_absolute() {
            PathBuf::from(expanded_path_str)
        } else {
            self.workspace_root.join(expanded_path_str)
        };

        // Check if path is allowed (Workspace OR External)
        let allowed_location = {
            let config = self.permission_manager.lock().await;
            config.check_path_access(&path, &self.workspace_root) == crate::config::Action::Allow
        };
        
        if !allowed_location {
            return Err("Access denied: Path is outside workspace and not allowed by config".to_string());
        }

        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await.map_err(|e| format!("Failed to create directories: {}", e))?;
        }

        // Check if allowed by permission manager
        let allowed = {
            let config = self.permission_manager.lock().await;
            config.write.evaluate(path_str) == crate::config::Action::Allow
        };

        if !allowed {
            // --- Confirmation Logic ---
            let old_content = if path.exists() {
                Some(fs::read_to_string(&path).await.unwrap_or_default())
            } else {
                None
            };

            let request_id = Uuid::new_v4().to_string();
            println!("WriteFileTool: Requesting confirmation for id={} session={}", request_id, self.session_id);
            let (tx, rx) = oneshot::channel();

            {
                let mut map = self.pending_confirmations.lock().unwrap();
                map.insert(request_id.clone(), tx);
            }

            let event = ConfirmationRequest {
                id: request_id.clone(),
                session_id: self.session_id.clone(),
                type_: "diff".to_string(),
                file_path: path_str.to_string(),
                old_content,
                new_content: content.to_string(),
                suggested_pattern: path_str.to_string(),
            };

            self.app.emit("request-confirmation", &event)
                .map_err(|e| format!("Failed to emit confirmation event: {}", e))?;

            // Wait for user response
            // This blocks the tool execution (and thus the agent step) until frontend responds
            let response = rx.await.map_err(|_| "Confirmation channel closed without response".to_string())?;

            if !response.allowed {
                return Err("User denied file write.".to_string());
            }

            if response.always {
                let pattern = response.pattern.unwrap_or_else(|| path_str.to_string());
                let mut config = self.permission_manager.lock().await;
                add_allow_rule_with_variants(
                    &mut config.write.rules,
                    pattern,
                    path_str,
                    &self.workspace_root,
                );
            }
            // --------------------------
        }

        match fs::write(path, content).await {
            Ok(_) => Ok(json!({ "status": "success" })),
            Err(e) => Err(format!("Failed to write file: {}", e)),
        }
    }
}

pub struct EditFileTool {
    pub workspace_root: PathBuf,
    pub session_id: String,
    pub app: AppHandle,
    pub pending_confirmations: Arc<Mutex<HashMap<String, oneshot::Sender<crate::domain::models::ConfirmationResponse>>>>,
    pub permission_manager: Arc<tokio::sync::Mutex<crate::config::PermissionConfig>>,
}

#[derive(Deserialize, Clone)]
struct EditBlock {
    old_text: String,
    new_text: String,
    #[serde(default)]
    occurrence: Option<usize>,
    #[serde(default)]
    replace_all: Option<bool>,
}

fn replace_nth_occurrence(
    content: &str,
    old_text: &str,
    new_text: &str,
    occurrence: usize,
) -> Result<String, String> {
    let mut match_iter = content.match_indices(old_text).enumerate();
    while let Some((index, (start, _))) = match_iter.next() {
        if index == occurrence {
            let mut updated = String::with_capacity(content.len() - old_text.len() + new_text.len());
            updated.push_str(&content[..start]);
            updated.push_str(new_text);
            updated.push_str(&content[start + old_text.len()..]);
            return Ok(updated);
        }
    }

    Err(format!("Search block occurrence {} not found.", occurrence))
}

fn apply_edits_to_content(
    original_content: &str,
    edits: &[EditBlock],
    path_label: &str,
) -> Result<String, String> {
    let mut updated_content = original_content.to_string();

    for edit in edits {
        if edit.old_text.is_empty() {
            return Err("Invalid edit block: old_text cannot be empty".to_string());
        }

        let matches: Vec<usize> = updated_content.match_indices(&edit.old_text)
            .map(|(idx, _)| idx)
            .collect();

        if matches.is_empty() {
            return Err(format!(
                "Could not find exact match for search block in {}. Ensure old_text matches the file content exactly, including whitespace.",
                path_label
            ));
        }

        if edit.replace_all.unwrap_or(false) {
            if edit.occurrence.is_some() {
                return Err("Invalid edit block: replace_all cannot be combined with occurrence".to_string());
            }
            updated_content = updated_content.replace(&edit.old_text, &edit.new_text);
            continue;
        }

        let occurrence = match edit.occurrence {
            Some(index) => index,
            None => {
                if matches.len() > 1 {
                    return Err(format!(
                        "Search block is not unique in {}. Provide more context in old_text or specify occurrence.",
                        path_label
                    ));
                }
                0
            }
        };

        updated_content = replace_nth_occurrence(&updated_content, &edit.old_text, &edit.new_text, occurrence)?;
    }

    Ok(updated_content)
}

impl EditFileTool {
    pub fn new(
        workspace_root: PathBuf,
        session_id: String,
        app: AppHandle,
        pending_confirmations: Arc<Mutex<HashMap<String, oneshot::Sender<crate::domain::models::ConfirmationResponse>>>>,
        permission_manager: Arc<tokio::sync::Mutex<crate::config::PermissionConfig>>,
    ) -> Self {
        Self {
            workspace_root,
            session_id,
            app,
            pending_confirmations,
            permission_manager,
        }
    }
}

#[async_trait]
impl Tool for EditFileTool {
    fn name(&self) -> &'static str {
        "edit_file"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "edit_file",
            "description": "Apply partial edits to a file using search/replace blocks. This is more efficient than overwriting the whole file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to the file relative to workspace root"
                    },
                    "edits": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "old_text": {
                                    "type": "string",
                                    "description": "The exact text to find in the file"
                                },
                                "new_text": {
                                    "type": "string",
                                    "description": "The text to replace it with"
                                },
                                "occurrence": {
                                    "type": "integer",
                                    "description": "0-based occurrence to replace if old_text appears multiple times"
                                },
                                "replace_all": {
                                    "type": "boolean",
                                    "description": "Replace all occurrences of old_text"
                                }
                            },
                            "required": ["old_text", "new_text"]
                        },
                        "description": "A list of search/replace blocks"
                    }
                },
                "required": ["path", "edits"]
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let path_str = input.get("path")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'path' parameter")?;
        
        // Expand ~ to home directory
        let expanded_path_str = expand_tilde(path_str);

        let edits_val = input.get("edits")
            .and_then(|v| v.as_array())
            .ok_or("Missing 'edits' parameter")?;

        // Construct target path (handle absolute vs relative)
        let path = if std::path::Path::new(&expanded_path_str).is_absolute() {
            PathBuf::from(expanded_path_str)
        } else {
            self.workspace_root.join(expanded_path_str)
        };

        // Check if path is allowed (Workspace OR External)
        let allowed_location = {
            let config = self.permission_manager.lock().await;
            config.check_path_access(&path, &self.workspace_root) == crate::config::Action::Allow
        };
        
        if !allowed_location {
            return Err("Access denied: Path is outside workspace and not allowed by config".to_string());
        }

        if !path.exists() {
            return Err(format!("File does not exist: {}", path_str));
        }

        let original_content = fs::read_to_string(&path).await
            .map_err(|e| format!("Failed to read file: {}", e))?;
        
        let edits: Vec<EditBlock> = edits_val
            .iter()
            .map(|edit| serde_json::from_value(edit.clone())
                .map_err(|e| format!("Invalid edit block: {}", e)))
            .collect::<Result<Vec<_>, _>>()?;

        let new_content = apply_edits_to_content(&original_content, &edits, path_str)?;

        // Check if allowed by permission manager
        let allowed = {
            let config = self.permission_manager.lock().await;
            config.edit.evaluate(path_str) == crate::config::Action::Allow
        };

        if !allowed {
            // --- Confirmation Logic ---
            let request_id = Uuid::new_v4().to_string();
            println!("EditFileTool: Requesting confirmation for id={} session={}", request_id, self.session_id);
            let (tx, rx) = oneshot::channel();

            {
                let mut map = self.pending_confirmations.lock().unwrap();
                map.insert(request_id.clone(), tx);
            }

            let event = ConfirmationRequest {
                id: request_id.clone(),
                session_id: self.session_id.clone(),
                type_: "diff".to_string(),
                file_path: path_str.to_string(),
                old_content: Some(original_content),
                new_content: new_content.clone(),
                suggested_pattern: path_str.to_string(),
            };

            self.app.emit("request-confirmation", &event)
                .map_err(|e| format!("Failed to emit confirmation event: {}", e))?;

            let response = rx.await.map_err(|_| "Confirmation channel closed without response".to_string())?;

            if !response.allowed {
                return Err("User denied file edit.".to_string());
            }

            if response.always {
                let pattern = response.pattern.unwrap_or_else(|| path_str.to_string());
                let mut config = self.permission_manager.lock().await;
                add_allow_rule_with_variants(
                    &mut config.edit.rules,
                    pattern,
                    path_str,
                    &self.workspace_root,
                );
            }
            // --------------------------
        }

        match fs::write(path, new_content).await {
            Ok(_) => Ok(json!({ "status": "success", "message": format!("Applied {} edit(s) to {}", edits_val.len(), path_str) })),
            Err(e) => Err(format!("Failed to write file: {}", e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_edits_to_content, EditBlock};

    #[test]
    fn apply_edits_single_match() {
        let content = "alpha\nbeta\ngamma";
        let edits = vec![EditBlock {
            old_text: "beta".to_string(),
            new_text: "theta".to_string(),
            occurrence: None,
            replace_all: None,
        }];

        let updated = apply_edits_to_content(content, &edits, "test.txt").unwrap();
        assert!(updated.contains("theta"));
        assert!(!updated.contains("beta"));
    }

    #[test]
    fn apply_edits_requires_occurrence_when_multiple() {
        let content = "dup\nvalue\ndup";
        let edits = vec![EditBlock {
            old_text: "dup".to_string(),
            new_text: "swap".to_string(),
            occurrence: None,
            replace_all: None,
        }];

        let err = apply_edits_to_content(content, &edits, "test.txt").unwrap_err();
        assert!(err.contains("not unique"));
    }

    #[test]
    fn apply_edits_occurrence_replaces_specific_match() {
        let content = "dup\nvalue\ndup";
        let edits = vec![EditBlock {
            old_text: "dup".to_string(),
            new_text: "swap".to_string(),
            occurrence: Some(1),
            replace_all: None,
        }];

        let updated = apply_edits_to_content(content, &edits, "test.txt").unwrap();
        assert_eq!(updated, "dup\nvalue\nswap");
    }

    #[test]
    fn apply_edits_replace_all() {
        let content = "dup\nvalue\ndup";
        let edits = vec![EditBlock {
            old_text: "dup".to_string(),
            new_text: "swap".to_string(),
            occurrence: None,
            replace_all: Some(true),
        }];

        let updated = apply_edits_to_content(content, &edits, "test.txt").unwrap();
        assert_eq!(updated, "swap\nvalue\nswap");
    }

    #[test]
    fn apply_edits_empty_old_text_fails() {
        let content = "data";
        let edits = vec![EditBlock {
            old_text: "".to_string(),
            new_text: "swap".to_string(),
            occurrence: None,
            replace_all: None,
        }];

        let err = apply_edits_to_content(content, &edits, "test.txt").unwrap_err();
        assert!(err.contains("old_text cannot be empty"));
    }
}
