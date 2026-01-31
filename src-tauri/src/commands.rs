use crate::app_state::AppState;
use crate::adapters::openai::OpenAIAdapter;
use crate::adapters::gemini::GeminiAdapter;
use crate::adapters::anthropic::AnthropicAdapter;
use crate::adapters::ollama::OllamaAdapter;
use crate::adapters::tools::{files::ReadFileTool, files::WriteFileTool, bash::BashTool, git::GitTool};
use crate::domain::agent::Agent;
use crate::domain::models::{AgentSession, AgentPermissions, ModelId, AgentMode};
use crate::domain::ports::ModelAdapter;
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{State, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Serialize)]
pub struct FileNode {
    name: String,
    path: String,
    kind: String,
    children: Option<Vec<FileNode>>,
}

fn read_dir_recursive(path: &std::path::Path) -> Vec<FileNode> {
    let mut nodes = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = path.is_dir();
            let kind = if is_dir { "directory" } else { "file" }.to_string();

            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }

            let children = if is_dir {
                Some(read_dir_recursive(&path))
            } else {
                None
            };

            nodes.push(FileNode {
                name,
                path: path.to_string_lossy().to_string(),
                kind,
                children,
            });
        }
    }
    nodes.sort_by(|a, b| {
        if a.kind == b.kind {
            a.name.cmp(&b.name)
        } else if a.kind == "directory" {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });
    nodes
}

#[tauri::command]
pub fn get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_file_tree(path: String) -> Result<Vec<FileNode>, String> {
    let root = PathBuf::from(path);
    if !root.exists() {
        return Err("Path does not exist".to_string());
    }
    
    let result = tokio::task::spawn_blocking(move || {
        read_dir_recursive(&root)
    }).await.map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn spawn_terminal(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut terminal = state.terminal.lock().map_err(|_| "Failed to lock terminal")?;
    terminal.spawn(app)
}

#[tauri::command]
pub fn write_terminal(
    state: State<'_, AppState>,
    data: String,
) -> Result<(), String> {
    let terminal = state.terminal.lock().map_err(|_| "Failed to lock terminal")?;
    terminal.write(data)
}

#[tauri::command]
pub fn resize_terminal(
    state: State<'_, AppState>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let terminal = state.terminal.lock().map_err(|_| "Failed to lock terminal")?;
    terminal.resize(cols, rows)
}

#[tauri::command]
pub async fn create_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_path: String,
    api_key: String,
    provider: String,
    model_id: String,
) -> Result<String, String> {
    let id = Uuid::new_v4();
    let path = PathBuf::from(&workspace_path);

    if !path.exists() {
        return Err("Workspace path does not exist".to_string());
    }

    let model: Arc<dyn ModelAdapter> = match provider.as_str() {
        "openai" => Arc::new(OpenAIAdapter::new(api_key.clone())),
        "gemini" => Arc::new(GeminiAdapter::new(api_key.clone(), model_id.clone())),
        "anthropic" => Arc::new(AnthropicAdapter::new(api_key.clone(), model_id.clone())),
        "ollama" => Arc::new(OllamaAdapter::new(None)),
        _ => return Err(format!("Unsupported provider: {}", provider)),
    };

    let tools = vec![
        Arc::new(ReadFileTool::new(path.clone())) as Arc<dyn crate::domain::ports::Tool>,
        Arc::new(WriteFileTool::new(
            path.clone(), 
            app.clone(), 
            state.pending_confirmations.clone()
        )),
        Arc::new(BashTool::new(
            path.clone(),
            app.clone(),
            state.pending_confirmations.clone()
        )),
        Arc::new(GitTool::new(path.clone())),
    ];

    let new_session = AgentSession {
        id,
        workspace_path: path.clone(),
        model: ModelId(model_id.clone()),
        mode: AgentMode::Build,
        messages: vec![],
        permissions: AgentPermissions { allowed: HashSet::new() },
    };

    let agent = Agent::new(new_session.clone(), model.clone(), tools);

    let mut agents = state.agents.lock().map_err(|_| "Failed to lock state")?;
    agents.insert(id, Arc::new(Mutex::new(agent)));

    Ok(id.to_string())
}

#[tauri::command]
pub async fn chat(
    state: State<'_, AppState>,
    session_id: String,
    message: String,
    model_id: Option<String>,
    api_key: Option<String>,
    mode: Option<String>,
) -> Result<String, String> {
    let uuid = Uuid::parse_str(&session_id).map_err(|_| "Invalid UUID")?;

    let agent_arc = {
        let agents = state.agents.lock().map_err(|_| "Failed to lock state")?;
        agents.get(&uuid).cloned().ok_or("Session not found".to_string())?
    };

    let mut agent = agent_arc.lock().await;

    if let Some(m) = mode {
        let new_mode = match m.to_lowercase().as_str() {
            "plan" => AgentMode::Plan,
            "research" => AgentMode::Research,
            _ => AgentMode::Build,
        };
        agent.update_mode(new_mode);
    }

    if let (Some(m_id), Some(key)) = (model_id, api_key) {
        let adapter: Arc<dyn ModelAdapter> = if m_id.starts_with("gemini") {
            Arc::new(GeminiAdapter::new(key, m_id.clone()))
        } else if m_id.starts_with("claude") {
            Arc::new(AnthropicAdapter::new(key, m_id.clone()))
        } else {
            Arc::new(OpenAIAdapter::new(key))
        };
        
        agent.update_model(adapter, ModelId(m_id));
    }
    
    agent.step(Some(message)).await
}

#[tauri::command]
pub async fn stream_chat(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    message: String,
    model_id: Option<String>,
    api_key: Option<String>,
    mode: Option<String>,
) -> Result<String, String> {
    let uuid = Uuid::parse_str(&session_id).map_err(|_| "Invalid UUID")?;

    let agent_arc = {
        let agents = state.agents.lock().map_err(|_| "Failed to lock state")?;
        agents.get(&uuid).cloned().ok_or("Session not found".to_string())?
    };

    let mut agent = agent_arc.lock().await;

    if let Some(m) = mode {
        let new_mode = match m.to_lowercase().as_str() {
            "plan" => AgentMode::Plan,
            "research" => AgentMode::Research,
            _ => AgentMode::Build,
        };
        agent.update_mode(new_mode);
    }

    if let (Some(m_id), Some(key)) = (model_id, api_key) {
        let adapter: Arc<dyn ModelAdapter> = if m_id.starts_with("gemini") {
            Arc::new(GeminiAdapter::new(key, m_id.clone()))
        } else if m_id.starts_with("claude") {
            Arc::new(AnthropicAdapter::new(key, m_id.clone()))
        } else {
            Arc::new(OpenAIAdapter::new(key))
        };
        
        agent.update_model(adapter, ModelId(m_id));
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(100);

    let app_handle = app.clone();
    tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            let _ = app_handle.emit("chat-token", chunk);
        }
    });
    
    agent.step_stream(Some(message), tx).await
}

#[tauri::command]
pub async fn confirm_action(
    state: State<'_, AppState>,
    id: String,
    allowed: bool,
) -> Result<(), String> {
    let mut map = state.pending_confirmations.lock().map_err(|_| "Failed to lock")?;
    if let Some(tx) = map.remove(&id) {
        let _ = tx.send(allowed);
        Ok(())
    } else {
        Err("Confirmation ID not found or already processed".to_string())
    }
}

#[tauri::command]
pub async fn save_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&session_id).map_err(|_| "Invalid UUID")?;

    let agent_arc = {
        let agents = state.agents.lock().map_err(|_| "Failed to lock state")?;
        agents.get(&uuid).cloned().ok_or("Session not found".to_string())?
    };

    let agent = agent_arc.lock().await;
    let session = agent.get_session();

    state.with_storage(|storage| storage.save_session(&session))
}

#[tauri::command]
pub async fn load_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<AgentSession, String> {
    state.with_storage(|storage| storage.load_session(&session_id))
}

#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<crate::storage::SessionMetadata>, String> {
    state.with_storage(|storage| storage.list_sessions())
}

#[tauri::command]
pub async fn delete_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.with_storage(|storage| storage.delete_session(&session_id))
}

#[tauri::command]
pub async fn replay_session(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    session_id: String,
    model_id: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    let original_session = state.with_storage(|storage| storage.load_session(&session_id))?;

    let uuid = Uuid::new_v4();
    let path = original_session.workspace_path.clone();
    
    let api_key = api_key.unwrap_or_default();
    let model_id_value = model_id.unwrap_or_else(|| original_session.model.0.clone());
    
    let provider = if model_id_value.starts_with("llama")
        || model_id_value.starts_with("mistral")
        || model_id_value.starts_with("codellama")
        || model_id_value.starts_with("deepseek") {
        "ollama".to_string()
    } else if model_id_value.starts_with("gemini") {
        "gemini".to_string()
    } else if model_id_value.starts_with("claude") {
        "anthropic".to_string()
    } else {
        "openai".to_string()
    };

    let model: Arc<dyn ModelAdapter> = match provider.as_str() {
        "openai" => Arc::new(OpenAIAdapter::new(api_key.clone())),
        "gemini" => Arc::new(GeminiAdapter::new(api_key.clone(), model_id_value.clone())),
        "anthropic" => Arc::new(AnthropicAdapter::new(api_key.clone(), model_id_value.clone())),
        "ollama" => Arc::new(OllamaAdapter::new(None)),
        _ => return Err(format!("Unsupported provider: {}", provider)),
    };

    let tools = vec![
        Arc::new(ReadFileTool::new(path.clone())) as Arc<dyn crate::domain::ports::Tool>,
        Arc::new(WriteFileTool::new(
            path.clone(),
            app.clone(),
            state.pending_confirmations.clone()
        )),
        Arc::new(BashTool::new(
            path.clone(),
            app.clone(),
            state.pending_confirmations.clone()
        )),
        Arc::new(GitTool::new(path.clone())),
    ];

    let new_session = AgentSession {
        id: uuid,
        workspace_path: path.clone(),
        model: ModelId(model_id_value),
        mode: original_session.mode,
        messages: original_session.messages,
        permissions: AgentPermissions { allowed: HashSet::new() },
    };

    let agent = Agent::new(new_session, model, tools);

    let mut agents = state.agents.lock().map_err(|_| "Failed to lock state")?;
    agents.insert(uuid, Arc::new(Mutex::new(agent)));

    Ok(uuid.to_string())
}
