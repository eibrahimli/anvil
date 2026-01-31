use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::PathBuf;
use tokio::fs;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;
use serde::Serialize;

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
}

impl ReadFileTool {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }
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

        let path = self.workspace_root.join(path_str);

        // Simple sandbox check
        if !path.starts_with(&self.workspace_root) {
            return Err("Access denied: Path is outside workspace".to_string());
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
        
        let content = input.get("content")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'content' parameter")?;

        let path = self.workspace_root.join(path_str);

        if !path.starts_with(&self.workspace_root) {
            return Err("Access denied: Path is outside workspace".to_string());
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
                if let Some(pattern) = response.pattern {
                    let mut config = self.permission_manager.lock().await;
                    config.write.rules.push(crate::config::manager::PermissionRule {
                        pattern,
                        action: crate::config::Action::Allow,
                    });
                }
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
        
        let edits_val = input.get("edits")
            .and_then(|v| v.as_array())
            .ok_or("Missing 'edits' parameter")?;

        let path = self.workspace_root.join(path_str);

        if !path.starts_with(&self.workspace_root) {
            return Err("Access denied: Path is outside workspace".to_string());
        }

        if !path.exists() {
            return Err(format!("File does not exist: {}", path_str));
        }

        let original_content = fs::read_to_string(&path).await
            .map_err(|e| format!("Failed to read file: {}", e))?;
        
        let mut new_content = original_content.clone();

        for edit in edits_val {
            let old_text = edit.get("old_text").and_then(|v| v.as_str())
                .ok_or("Invalid edit block: missing old_text")?;
            let replace_text = edit.get("new_text").and_then(|v| v.as_str())
                .ok_or("Invalid edit block: missing new_text")?;

            if !new_content.contains(old_text) {
                return Err(format!("Could not find exact match for search block in {}. Ensure old_text matches the file content exactly, including whitespace.", path_str));
            }

            // Check if it's unique
            if new_content.matches(old_text).count() > 1 {
                return Err(format!("Search block is not unique in {}. Provide more context in old_text.", path_str));
            }

            new_content = new_content.replace(old_text, replace_text);
        }

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
                if let Some(pattern) = response.pattern {
                    let mut config = self.permission_manager.lock().await;
                    config.edit.rules.push(crate::config::manager::PermissionRule {
                        pattern,
                        action: crate::config::Action::Allow,
                    });
                }
            }
            // --------------------------
        }

        match fs::write(path, new_content).await {
            Ok(_) => Ok(json!({ "status": "success", "message": format!("Applied {} edit(s) to {}", edits_val.len(), path_str) })),
            Err(e) => Err(format!("Failed to write file: {}", e)),
        }
    }
}

