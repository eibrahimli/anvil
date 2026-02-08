use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use crate::config::{SkillLoader, SkillDiscovery, PermissionConfig, Action};
use async_trait::async_trait;
use serde::{Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use tokio::sync::Mutex;
use uuid::Uuid;

pub struct SkillTool {
    workspace_root: PathBuf,
    permission_manager: Arc<Mutex<PermissionConfig>>,
    session_id: String,
    app: Option<AppHandle>,
    pending_confirmations: Option<Arc<StdMutex<HashMap<String, oneshot::Sender<crate::domain::models::ConfirmationResponse>>>>>,
}

impl SkillTool {
    pub fn new(
        workspace_root: PathBuf,
        session_id: String,
        app: AppHandle,
        pending_confirmations: Arc<StdMutex<HashMap<String, oneshot::Sender<crate::domain::models::ConfirmationResponse>>>>,
        permission_manager: Arc<Mutex<PermissionConfig>>,
    ) -> Self {
        Self {
            workspace_root,
            permission_manager,
            session_id,
            app: Some(app),
            pending_confirmations: Some(pending_confirmations),
        }
    }

    #[cfg(test)]
    pub fn new_for_test(workspace_root: PathBuf, permission_manager: Arc<Mutex<PermissionConfig>>) -> Self {
        Self {
            workspace_root,
            permission_manager,
            session_id: String::new(),
            app: None,
            pending_confirmations: None,
        }
    }
    
    /// Check if a skill is allowed to be used
    async fn check_skill_permission(&self, skill_name: &str) -> Action {
        let config = self.permission_manager.lock().await;
        config.skill.evaluate(skill_name)
    }

    async fn request_confirmation(
        &self,
        skill_name: &str,
    ) -> Result<crate::domain::models::ConfirmationResponse, String> {
        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();

        let Some(pending) = self.pending_confirmations.as_ref() else {
            return Err("Confirmation unavailable for skill invocation.".to_string());
        };
        let Some(app) = self.app.as_ref() else {
            return Err("Confirmation unavailable for skill invocation.".to_string());
        };

        {
            let mut map = pending.lock().unwrap();
            map.insert(request_id.clone(), tx);
        }

        let event = PermissionConfirmationRequest {
            id: request_id.clone(),
            session_id: self.session_id.clone(),
            type_: "permission".to_string(),
            tool_name: "skill".to_string(),
            input: skill_name.to_string(),
            suggested_pattern: skill_name.to_string(),
        };

        app.emit("request-confirmation", &event)
            .map_err(|e| format!("Failed to emit confirmation event: {}", e))?;

        rx.await.map_err(|_| "Confirmation channel closed without response".to_string())
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
impl Tool for SkillTool {
    fn name(&self) -> &'static str {
        "skill"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "skill",
            "description": "Invoke reusable skills from SKILL.md files. Skills provide specialized capabilities like code review, release management, or pattern enforcement.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["list", "invoke"],
                        "description": "Action to perform: 'list' to show available skills, 'invoke' to use a skill"
                    },
                    "skill_name": {
                        "type": "string",
                        "description": "Name of the skill to invoke (required when action='invoke')"
                    },
                    "context": {
                        "type": "string",
                        "description": "Additional context to provide to the skill (optional)"
                    }
                },
                "required": ["action"]
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let action = input.get("action")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'action' parameter")?;

        match action {
            "list" => self.list_skills().await,
            "invoke" => self.invoke_skill(&input).await,
            _ => Err(format!("Unknown action: {}", action))
        }
    }
}

impl SkillTool {
    async fn list_skills(&self) -> ToolResult {
        let skills = SkillDiscovery::discover(&self.workspace_root)
            .map_err(|e| e.to_string())?;

        let mut skill_list: Vec<Value> = Vec::new();
        
        for skill in skills {
            // Check permission for this skill
            let action = self.check_skill_permission(&skill.name).await;
            
            // Only show allowed skills (denied skills are hidden)
            if action != Action::Deny {
                // Try to load skill to get description
                let description = match SkillLoader::load(&skill) {
                    Ok(loaded) => loaded.metadata.description,
                    Err(_) => "No description available".to_string()
                };

                skill_list.push(json!({
                    "name": skill.name,
                    "source": match skill.source {
                        crate::config::SkillSource::Project => "project",
                        crate::config::SkillSource::Global => "global",
                    },
                    "description": description,
                    "permission": match action {
                        Action::Allow => "allowed",
                        Action::Ask => "requires_confirmation",
                        _ => "unknown"
                    }
                }));
            }
        }

        Ok(json!({
            "skills": skill_list,
            "count": skill_list.len()
        }))
    }

    async fn invoke_skill(&self, input: &Value) -> ToolResult {
        let skill_name = input.get("skill_name")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'skill_name' parameter for invoke action")?;

        // Check permission before invoking
        let permission = self.check_skill_permission(skill_name).await;
        match permission {
            Action::Deny => {
                return Err(format!("Permission denied: Skill '{}' is not allowed", skill_name));
            }
            Action::Ask => {
                let response = self.request_confirmation(skill_name).await?;
                if !response.allowed {
                    return Err(format!("Skill '{}' denied by user.", skill_name));
                }
                if response.always {
                    let pattern = response.pattern.unwrap_or(skill_name.to_string());
                    let mut config = self.permission_manager.lock().await;
                    config.skill.rules.push(crate::config::PermissionRule {
                        pattern,
                        action: Action::Allow,
                    });
                }
            }
            Action::Allow => {}
        }

        let context = input.get("context")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // Find the skill
        let skills = SkillDiscovery::discover(&self.workspace_root)
            .map_err(|e| e.to_string())?;

        let skill = skills.iter()
            .find(|s| s.name == skill_name)
            .ok_or_else(|| format!("Skill '{}' not found", skill_name))?;

        // Load the skill
        let loaded = SkillLoader::load(skill)
            .map_err(|e| format!("Failed to load skill: {}", e))?;

        // Build skill context
        let skill_context = if context.is_empty() {
            loaded.content.clone()
        } else {
            format!("{}\n\n## User Context\n{}", loaded.content, context)
        };

        Ok(json!({
            "skill_name": loaded.metadata.name,
            "description": loaded.metadata.description,
            "content": skill_context,
            "license": loaded.metadata.license,
            "compatibility": loaded.metadata.compatibility,
            "message": format!("Skill '{}' loaded successfully. Use this context to guide your response.", skill_name)
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // Helper function to create a permission config with skills allowed by default
    fn test_permission_config() -> PermissionConfig {
        let mut config = PermissionConfig::default();
        config.skill.default = Action::Allow;
        config
    }

    #[tokio::test]
    async fn test_skill_list() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        // Create a test skill
        let skill_dir = workspace.join(".anvil").join("skills").join("test-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), r#"---
name: test-skill
description: A test skill for unit testing
---

## What I do
Test things.
"#).unwrap();

        fs::create_dir(workspace.join(".git")).unwrap();

        let permission_manager = Arc::new(Mutex::new(test_permission_config()));
        let tool = SkillTool::new_for_test(workspace, permission_manager);
        let input = json!({"action": "list"});
        let result = tool.execute(input).await.unwrap();

        let skills = result.get("skills").unwrap().as_array().unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].get("name").unwrap().as_str().unwrap(), "test-skill");
        assert_eq!(skills[0].get("description").unwrap().as_str().unwrap(), "A test skill for unit testing");
    }

    #[tokio::test]
    async fn test_skill_invoke() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        // Create a test skill
        let skill_dir = workspace.join(".anvil").join("skills").join("my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), r#"---
name: my-skill
description: My test skill
license: MIT
---

## Instructions
Do something useful.
"#).unwrap();

        fs::create_dir(workspace.join(".git")).unwrap();

        let permission_manager = Arc::new(Mutex::new(test_permission_config()));
        let tool = SkillTool::new_for_test(workspace, permission_manager);
        let input = json!({
            "action": "invoke",
            "skill_name": "my-skill",
            "context": "Additional user context here"
        });
        let result = tool.execute(input).await.unwrap();

        assert_eq!(result.get("skill_name").unwrap().as_str().unwrap(), "my-skill");
        assert_eq!(result.get("description").unwrap().as_str().unwrap(), "My test skill");
        assert!(result.get("content").unwrap().as_str().unwrap().contains("Do something useful"));
        assert!(result.get("content").unwrap().as_str().unwrap().contains("Additional user context"));
        assert_eq!(result.get("license").unwrap().as_str().unwrap(), "MIT");
    }

    #[tokio::test]
    async fn test_skill_invoke_not_found() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        let permission_manager = Arc::new(Mutex::new(test_permission_config()));
        let tool = SkillTool::new_for_test(workspace, permission_manager);
        let input = json!({
            "action": "invoke",
            "skill_name": "nonexistent"
        });
        let result = tool.execute(input).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not found") || err.contains("Permission denied"));
    }

    #[tokio::test]
    async fn test_skill_permission_deny() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        // Create a test skill
        let skill_dir = workspace.join(".anvil").join("skills").join("secret-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), r#"---
name: secret-skill
description: A secret skill
---

## Secret
This is secret.
"#).unwrap();

        fs::create_dir(workspace.join(".git")).unwrap();

        // Create permission config that denies this skill
        let mut config = PermissionConfig::default();
        config.skill.rules.push(crate::config::PermissionRule {
            pattern: "secret-*".to_string(),
            action: Action::Deny,
        });
        
        let permission_manager = Arc::new(Mutex::new(config));
        let tool = SkillTool::new_for_test(workspace, permission_manager);
        
        // List should not show denied skill
        let list_result = tool.execute(json!({"action": "list"})).await.unwrap();
        let skills = list_result.get("skills").unwrap().as_array().unwrap();
        assert_eq!(skills.len(), 0);
        
        // Invoke should fail
        let input = json!({
            "action": "invoke",
            "skill_name": "secret-skill"
        });
        let result = tool.execute(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Permission denied"));
    }
}
