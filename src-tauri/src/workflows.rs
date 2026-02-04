use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStep {
    pub id: String,
    pub title: String,
    pub command: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub requires_approval: Option<bool>,
    #[serde(default)]
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub steps: Vec<WorkflowStep>,
    #[serde(default)]
    pub version: u32,
    pub created_at: String,
    pub updated_at: String,
}

impl Workflow {
    pub fn touch(mut self) -> Self {
        let now = Utc::now().to_rfc3339();
        if self.created_at.trim().is_empty() {
            self.created_at = now.clone();
        }
        self.updated_at = now;
        if self.version == 0 {
            self.version = 1;
        }
        self
    }
}

pub fn workflows_dir(workspace_path: &Path) -> PathBuf {
    workspace_path.join(".anvil").join("workflows")
}

pub async fn ensure_workflows_dir(workspace_path: &Path) -> Result<PathBuf, String> {
    let dir = workflows_dir(workspace_path);
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Failed to create workflows directory: {}", e))?;
    Ok(dir)
}

pub async fn list_workflows(workspace_path: &Path) -> Result<Vec<Workflow>, String> {
    let dir = ensure_workflows_dir(workspace_path).await?;
    let mut entries = fs::read_dir(&dir)
        .await
        .map_err(|e| format!("Failed to read workflows directory: {}", e))?;
    let mut workflows = Vec::new();

    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let content = fs::read_to_string(&path)
            .await
            .map_err(|e| format!("Failed to read workflow: {}", e))?;
        let workflow: Workflow = serde_json::from_str(&content)
            .map_err(|e| format!("Invalid workflow JSON: {}", e))?;
        workflows.push(workflow);
    }

    Ok(workflows)
}

pub async fn load_workflow(workspace_path: &Path, workflow_id: &str) -> Result<Workflow, String> {
    let dir = ensure_workflows_dir(workspace_path).await?;
    let path = dir.join(format!("{}.json", workflow_id));
    let content = fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read workflow: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Invalid workflow JSON: {}", e))
}

pub async fn save_workflow(workspace_path: &Path, workflow: Workflow) -> Result<Workflow, String> {
    let dir = ensure_workflows_dir(workspace_path).await?;
    let normalized = workflow.touch();
    let path = dir.join(format!("{}.json", normalized.id));
    let content = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("Failed to serialize workflow: {}", e))?;
    fs::write(&path, content)
        .await
        .map_err(|e| format!("Failed to save workflow: {}", e))?;
    Ok(normalized)
}

pub async fn delete_workflow(workspace_path: &Path, workflow_id: &str) -> Result<(), String> {
    let dir = ensure_workflows_dir(workspace_path).await?;
    let path = dir.join(format!("{}.json", workflow_id));
    if !path.exists() {
        return Err("Workflow not found".to_string());
    }
    fs::remove_file(&path)
        .await
        .map_err(|e| format!("Failed to delete workflow: {}", e))?;
    Ok(())
}
