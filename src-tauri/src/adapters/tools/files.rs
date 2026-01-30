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
    #[serde(rename = "type")]
    type_: String,
    file_path: String,
    old_content: Option<String>,
    new_content: String,
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
    pub app: AppHandle,
    pub pending_confirmations: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
}

impl WriteFileTool {
    pub fn new(
        workspace_root: PathBuf,
        app: AppHandle,
        pending_confirmations: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    ) -> Self {
        Self { 
            workspace_root,
            app,
            pending_confirmations,
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

        // --- Confirmation Logic ---
        let old_content = if path.exists() {
            Some(fs::read_to_string(&path).await.unwrap_or_default())
        } else {
            None
        };

        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();

        {
            let mut map = self.pending_confirmations.lock().unwrap();
            map.insert(request_id.clone(), tx);
        }

        let event = ConfirmationRequest {
            id: request_id.clone(),
            type_: "diff".to_string(),
            file_path: path_str.to_string(),
            old_content,
            new_content: content.to_string(),
        };

        self.app.emit("request-confirmation", &event)
            .map_err(|e| format!("Failed to emit confirmation event: {}", e))?;

        // Wait for user response
        // This blocks the tool execution (and thus the agent step) until frontend responds
        let allowed = rx.await.map_err(|_| "Confirmation channel closed without response".to_string())?;

        if !allowed {
            return Err("User denied file write.".to_string());
        }
        // --------------------------

        match fs::write(path, content).await {
            Ok(_) => Ok(json!({ "status": "success" })),
            Err(e) => Err(format!("Failed to write file: {}", e)),
        }
    }
}
