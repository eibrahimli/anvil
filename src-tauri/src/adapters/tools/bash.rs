use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::PathBuf;
use tokio::process::Command;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;
use serde::Serialize;

#[derive(Serialize, Clone)]
struct ShellConfirmationRequest {
    id: String,
    session_id: String,
    #[serde(rename = "type")]
    type_: String,
    command: String,
    suggested_pattern: String,
}

pub struct BashTool {
    pub workspace_root: PathBuf,
    pub session_id: String,
    pub app: AppHandle,
    pub pending_confirmations: Arc<Mutex<HashMap<String, oneshot::Sender<crate::domain::models::ConfirmationResponse>>>>,
    pub permission_manager: Arc<tokio::sync::Mutex<crate::config::PermissionConfig>>,
}

impl BashTool {
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
impl Tool for BashTool {
    fn name(&self) -> &'static str {
        "bash"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "bash",
            "description": "Execute a shell command",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The command to execute"
                    }
                },
                "required": ["command"]
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let command_str = input.get("command")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'command' parameter")?;

        // Check if allowed by permission manager
        let allowed = {
            let config = self.permission_manager.lock().await;
            config.bash.evaluate(command_str) == crate::config::Action::Allow
        };

        if !allowed {
            // --- Confirmation Logic ---
            let request_id = Uuid::new_v4().to_string();
            println!("BashTool: Requesting confirmation for id={} session={}", request_id, self.session_id);
            let (tx, rx) = oneshot::channel();

            {
                let mut map = self.pending_confirmations.lock().unwrap();
                map.insert(request_id.clone(), tx);
            }

            let suggested_pattern = if command_str.contains(' ') {
                format!("{}*", command_str.split(' ').next().unwrap_or(command_str))
            } else {
                command_str.to_string()
            };

            let event = ShellConfirmationRequest {
                id: request_id.clone(),
                session_id: self.session_id.clone(),
                type_: "shell".to_string(),
                command: command_str.to_string(),
                suggested_pattern,
            };

            self.app.emit("request-confirmation", &event)
                .map_err(|e| format!("Failed to emit confirmation event: {}", e))?;

            // Wait for user response
            let response = rx.await.map_err(|_| "Confirmation channel closed without response".to_string())?;

            if !response.allowed {
                return Err("User denied shell command execution.".to_string());
            }

            if response.always {
                if let Some(pattern) = response.pattern {
                    let mut config = self.permission_manager.lock().await;
                    config.bash.rules.push(crate::config::manager::PermissionRule {
                        pattern,
                        action: crate::config::Action::Allow,
                    });
                }
            }
            // --------------------------
        }

        // Use sh -c to execute the command string
        let output = Command::new("sh")
            .arg("-c")
            .arg(command_str)
            .current_dir(&self.workspace_root)
            .output()
            .await
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        Ok(json!({
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": output.status.code(),
        }))
    }
}
