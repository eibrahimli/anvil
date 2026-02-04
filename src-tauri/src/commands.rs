use crate::app_state::AppState;
use crate::adapters::openai::OpenAIAdapter;
use crate::adapters::gemini::GeminiAdapter;
use crate::adapters::anthropic::AnthropicAdapter;
use crate::adapters::ollama::OllamaAdapter;
use crate::adapters::tools::{files::ReadFileTool, files::WriteFileTool, files::EditFileTool, bash::BashTool, git::GitTool, search::SearchTool, symbols::SymbolsTool, glob::GlobTool, list::ListTool, web::WebFetchTool, patch::PatchTool, question::QuestionTool, todo::TodoWriteTool, todoread::TodoReadTool, skill::SkillTool, lsp::LspTool, mcp_tool::load_mcp_tools};
use crate::domain::agent::Agent;
use crate::domain::orchestrator::{Orchestrator, Task, TaskStatus};
use crate::domain::models::{AgentSession, AgentPermissions, ModelId, AgentMode, AgentRole};
use crate::domain::ports::ModelAdapter;
use crate::config::manager::{Config, PermissionConfig};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{State, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;
use serde_json::{json, Value};

#[tauri::command]
pub fn get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_file_in_editor(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let content = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;

    let reason = format!("Agent opened file.");
    let line_start = 1; // Placeholder for now
    let line_end = 1;

    // Emit event to frontend so Editor can follow/open tab
    let _ = app.emit("file-opened-by-agent", json!({
        "path": path,
        "reason": reason,
        "line_start": line_start,
        "line_end": line_end
    }));

    Ok(content)
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

    let mut config_manager = crate::config::ConfigManager::new();
    let _ = config_manager.load(Some(&path));
    let config = config_manager.config();
    let permission_manager = Arc::new(tokio::sync::Mutex::new(config.permission.clone()));

    let mut tools: Vec<Arc<dyn crate::domain::ports::Tool>> = vec![
        Arc::new(ReadFileTool::new(path.clone(), permission_manager.clone())),
        Arc::new(WriteFileTool::new(
            path.clone(),
            id.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(BashTool::new(
            path.clone(),
            id.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(GitTool::new(path.clone())),
        Arc::new(SearchTool::new(path.clone())),
        Arc::new(LspTool::new(path.clone(), permission_manager.clone(), config.lsp.clone())),
        Arc::new(EditFileTool::new(
            path.clone(),
            id.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(SymbolsTool::new(path.clone())),
        Arc::new(GlobTool::new(path.clone(), permission_manager.clone())),
        Arc::new(ListTool::new(path.clone(), permission_manager.clone())),
        Arc::new(WebFetchTool::new()),
        Arc::new(PatchTool::new(path.clone())),
        Arc::new(QuestionTool::new(app.clone())),
        Arc::new(TodoWriteTool::new(path.clone())),
        Arc::new(TodoReadTool::new(path.clone())),
        Arc::new(SkillTool::new(path.clone(), permission_manager.clone())),
    ];

    // Load MCP tools from configuration
    match load_mcp_tools(&path).await {
        Ok(mcp_tools) => {
            tools.extend(mcp_tools);
        }
        Err(e) => {
            println!("⚠️  Warning: Failed to load MCP tools: {}", e);
        }
    }

    let new_session = AgentSession {
        id,
        workspace_path: path.clone(),
        model: ModelId(model_id.clone()),
        mode: AgentMode::Build,
        messages: vec![],
        permissions: AgentPermissions { 
            config: config.permission.clone() 
        },
    };

    let agent = Agent::new(new_session.clone(), model.clone(), tools, permission_manager);

    let mut agents = state.agents.lock().await;
    agents.insert(id, Arc::new(Mutex::new(agent)));

    crate::config::start_config_watcher(
        state.agents.clone(),
        state.config_watchers.clone(),
        path.clone(),
    );

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
        let agents = state.agents.lock().await;
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
        let agents = state.agents.lock().await;
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
    session_id: String,
    allowed: bool,
    always: bool,
    pattern: Option<String>,
) -> Result<(), String> {
    println!("Confirming action: id={}, session={}, allowed={}, always={}, pattern={:?}", id, session_id, allowed, always, pattern);
    let mut map = state.pending_confirmations.lock().map_err(|_| "Failed to lock")?;
    if let Some(tx) = map.remove(&id) {
        let _ = tx.send(crate::domain::models::ConfirmationResponse {
            allowed,
            always,
            pattern,
        });
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
        let agents = state.agents.lock().await;
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

    let mut config_manager = crate::config::ConfigManager::new();
    let _ = config_manager.load(Some(&path));
    let config = config_manager.config();
    let permission_manager = Arc::new(tokio::sync::Mutex::new(config.permission.clone()));

    let mut tools: Vec<Arc<dyn crate::domain::ports::Tool>> = vec![
        Arc::new(ReadFileTool::new(path.clone(), permission_manager.clone())),
        Arc::new(WriteFileTool::new(
            path.clone(),
            uuid.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(BashTool::new(
            path.clone(),
            uuid.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(GitTool::new(path.clone())),
        Arc::new(SearchTool::new(path.clone())),
        Arc::new(LspTool::new(path.clone(), permission_manager.clone(), config.lsp.clone())),
        Arc::new(EditFileTool::new(
            path.clone(),
            uuid.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(SymbolsTool::new(path.clone())),
        Arc::new(GlobTool::new(path.clone(), permission_manager.clone())),
        Arc::new(ListTool::new(path.clone(), permission_manager.clone())),
        Arc::new(WebFetchTool::new()),
        Arc::new(PatchTool::new(path.clone())),
        Arc::new(QuestionTool::new(app.clone())),
        Arc::new(TodoWriteTool::new(path.clone())),
        Arc::new(TodoReadTool::new(path.clone())),
        Arc::new(SkillTool::new(path.clone(), permission_manager.clone())),
    ];

    // Load MCP tools from configuration
    match load_mcp_tools(&path).await {
        Ok(mcp_tools) => {
            tools.extend(mcp_tools);
        }
        Err(e) => {
            println!("⚠️  Warning: Failed to load MCP tools: {}", e);
        }
    }

    let new_session = AgentSession {
        id: uuid,
        workspace_path: path.clone(),
        model: ModelId(model_id_value),
        mode: original_session.mode,
        messages: original_session.messages,
        permissions: AgentPermissions { 
            config: config.permission.clone() 
        },
    };

    let agent = Agent::new(new_session, model, tools, permission_manager);

    let mut agents = state.agents.lock().await;
    agents.insert(uuid, Arc::new(Mutex::new(agent)));

    crate::config::start_config_watcher(
        state.agents.clone(),
        state.config_watchers.clone(),
        path.clone(),
    );

    Ok(uuid.to_string())
}

#[tauri::command]
pub async fn init_orchestrator(
    state: State<'_, AppState>,
    workspace_path: String,
) -> Result<(), String> {
    let mut orchestrator_guard: tokio::sync::MutexGuard<Option<Orchestrator>> = state.orchestrator.lock().await;
    if orchestrator_guard.is_none() {
        *orchestrator_guard = Some(Orchestrator::new(PathBuf::from(workspace_path)));
    }
    Ok(())
}

#[tauri::command]
pub async fn add_agent_to_orchestrator(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    agent_id: String,
    role: String,
    model_id: String,
    api_key: String,
    provider: String,
    workspace_path: String,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|_| "Invalid Agent UUID")?;
    let role_enum = match role.to_lowercase().as_str() {
        "coder" => AgentRole::Coder,
        "reviewer" => AgentRole::Reviewer,
        "planner" => AgentRole::Planner,
        "debugger" => AgentRole::Debugger,
        _ => AgentRole::Generic,
    };

    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    let model: Arc<dyn ModelAdapter> = match provider.as_str() {
        "openai" => Arc::new(OpenAIAdapter::new(api_key.clone())),
        "gemini" => Arc::new(GeminiAdapter::new(api_key.clone(), model_id.clone())),
        "anthropic" => Arc::new(AnthropicAdapter::new(api_key.clone(), model_id.clone())),
        "ollama" => Arc::new(OllamaAdapter::new(None)),
        _ => return Err(format!("Unsupported provider: {}", provider)),
    };

    let path = PathBuf::from(workspace_path);
    
    let mut config_manager = crate::config::ConfigManager::new();
    let _ = config_manager.load(Some(&path));
    let config = config_manager.config();
    let permission_manager = Arc::new(tokio::sync::Mutex::new(config.permission.clone()));

    let mut tools: Vec<Arc<dyn crate::domain::ports::Tool>> = vec![
        Arc::new(ReadFileTool::new(path.clone(), permission_manager.clone())),
        Arc::new(WriteFileTool::new(
            path.clone(),
            agent_id.clone(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(BashTool::new(
            path.clone(),
            agent_id.clone(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(GitTool::new(path.clone())),
        Arc::new(SearchTool::new(path.clone())),
        Arc::new(LspTool::new(path.clone(), permission_manager.clone(), config.lsp.clone())),
        Arc::new(EditFileTool::new(
            path.clone(),
            agent_id.clone(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(SymbolsTool::new(path.clone())),
        Arc::new(GlobTool::new(path.clone(), permission_manager.clone())),
        Arc::new(ListTool::new(path.clone(), permission_manager.clone())),
        Arc::new(WebFetchTool::new()),
        Arc::new(PatchTool::new(path.clone())),
        Arc::new(QuestionTool::new(app.clone())),
        Arc::new(TodoWriteTool::new(path.clone())),
        Arc::new(TodoReadTool::new(path.clone())),
        Arc::new(SkillTool::new(path.clone(), permission_manager.clone())),
    ];

    // Load MCP tools from configuration
    match load_mcp_tools(&path).await {
        Ok(mcp_tools) => {
            tools.extend(mcp_tools);
        }
        Err(e) => {
            println!("⚠️  Warning: Failed to load MCP tools: {}", e);
        }
    }

    orchestrator.add_agent(uuid, role_enum, model, tools, AgentMode::Build).await
}

#[tauri::command]
pub async fn create_task(
    state: State<'_, AppState>,
    description: String,
) -> Result<String, String> {
    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    let task_id = orchestrator.create_task(description).await;
    Ok(task_id.to_string())
}

#[tauri::command]
pub async fn process_tasks(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    orchestrator.process_tasks().await
}

#[tauri::command]
pub async fn get_all_tasks(
    state: State<'_, AppState>,
) -> Result<Vec<Task>, String> {
    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    Ok(orchestrator.get_all_tasks().await)
}

#[tauri::command]
pub async fn get_task_status(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<TaskStatus, String> {
    let uuid = Uuid::parse_str(&task_id).map_err(|_| "Invalid Task UUID")?;
    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    let status = orchestrator.get_task_status(uuid).await;
    status.ok_or("Task not found".to_string())
}

#[tauri::command]
pub fn resolve_question(
    question_id: String,
    answers: Value,
) -> Result<(), String> {
    crate::adapters::tools::question::QuestionTool::resolve_question(question_id, answers)
}

#[tauri::command]
pub async fn read_todos(
    workspace_path: String,
    filter: Option<String>,
) -> Result<Value, String> {
    use crate::adapters::tools::todoread::TodoReadTool;
    use crate::domain::ports::Tool;
    
    let path = PathBuf::from(&workspace_path);
    let tool = TodoReadTool::new(path);
    
    let filter_str = filter.unwrap_or_else(|| "all".to_string());
    
    let input = json!({
        "filter": filter_str
    });
    
    tool.execute(input).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_todo(
    workspace_path: String,
    action: String,
    id: Option<String>,
    content: Option<String>,
    status: Option<String>,
    priority: Option<String>,
) -> Result<Value, String> {
    use crate::adapters::tools::todo::TodoWriteTool;
    use crate::domain::ports::Tool;
    
    let path = PathBuf::from(&workspace_path);
    let tool = TodoWriteTool::new(path);
    
    let mut input = json!({
        "action": action
    });
    
    if let Some(id_val) = id {
        input["id"] = json!(id_val);
    }
    
    if let Some(content_val) = content {
        input["content"] = json!(content_val);
    }
    
    if let Some(status_val) = status {
        input["status"] = json!(status_val);
    }
    
    if let Some(priority_val) = priority {
        input["priority"] = json!(priority_val);
    }
    
    tool.execute(input).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_file_tree(path: String) -> Result<Vec<serde_json::Value>, String> {
    use crate::adapters::tools::list::ListTool;
    use crate::domain::ports::Tool;
    
    let path_buf = PathBuf::from(&path);
    let permission_manager = std::sync::Arc::new(tokio::sync::Mutex::new(crate::config::PermissionConfig::default()));
    let tool = ListTool::new(path_buf.clone(), permission_manager);
    
    let input = serde_json::json!({
        "path": ".",
        "depth": 10,
        "show_hidden": false,
        "filter": "all"
    });
    
    let result = tool.execute(input).await.map_err(|e| e.to_string())?;
    
    // Convert list entries to file tree format
    let entries = result.get("entries")
        .and_then(|e| e.as_array())
        .ok_or("Failed to get entries")?;
    
    let nodes: Vec<serde_json::Value> = entries.iter().map(|entry| {
        let kind = entry.get("kind").and_then(|k| k.as_str()).unwrap_or("file");
        let name = entry.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
        let entry_path = entry.get("path").and_then(|p| p.as_str()).unwrap_or("");
        
        serde_json::json!({
            "name": name,
            "path": format!("{}/{}", path, entry_path),
            "kind": kind,
            "children": null
        })
    }).collect();
    
    Ok(nodes)
}

#[tauri::command]
pub async fn search(
    workspace_path: String,
    pattern: String,
) -> Result<serde_json::Value, String> {
    use crate::adapters::tools::search::SearchTool;
    use crate::domain::ports::Tool;
    
    let path = PathBuf::from(&workspace_path);
    let tool = SearchTool::new(path);
    
    let input = serde_json::json!({
        "pattern": pattern,
        "path": "."
    });
    
    tool.execute(input).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_skills(
    workspace_path: String,
) -> Result<serde_json::Value, String> {
    use crate::config::SkillDiscovery;
    
    let path = PathBuf::from(&workspace_path);
    let skills = SkillDiscovery::discover(&path)
        .map_err(|e| e.to_string())?;
    
    let skill_list: Vec<serde_json::Value> = skills.iter().map(|skill| {
        serde_json::json!({
            "name": skill.name,
            "path": skill.path.to_string_lossy().to_string(),
            "source": match skill.source {
                crate::config::SkillSource::Project => "project",
                crate::config::SkillSource::Global => "global",
            }
        })
    }).collect();
    
    Ok(serde_json::json!({
        "skills": skill_list,
        "count": skill_list.len()
    }))
}

/// Test MCP connection to a server
#[tauri::command]
pub async fn test_mcp_connection(
    transport_type: String,
    command: Option<Vec<String>>,
    url: Option<String>,
    env: Option<std::collections::HashMap<String, String>>,
) -> Result<serde_json::Value, String> {
    use crate::mcp::{McpClient, McpServerConfig, TransportType};
    
    let transport = match transport_type.to_lowercase().as_str() {
        "stdio" => TransportType::Stdio,
        "http" => TransportType::Http,
        _ => return Err(format!("Invalid transport type: {}. Use 'stdio' or 'http'", transport_type)),
    };
    
    let config = McpServerConfig {
        server_name: "test-server".to_string(),
        transport_type: transport,
        command,
        url,
        env,
        headers: None,
        enabled: true,
        timeout_ms: 30000,
    };
    
    println!("🔌 Creating MCP client...");
    let client = McpClient::new(config).await
        .map_err(|e| format!("Failed to create MCP client: {}", e))?;
    
    println!("🔌 Initializing MCP connection...");
    client.initialize().await
        .map_err(|e| format!("Failed to initialize: {}", e))?;
    
    println!("✅ MCP connection initialized!");
    
    // Get capabilities
    let caps = client.get_capabilities().await;
    println!("📋 Server capabilities: {:?}", caps);
    
    // List tools
    let tools = client.get_tools().await;
    println!("📦 Found {} tools:", tools.len());
    for tool in &tools {
        println!("  - {}: {}", tool.name, tool.description);
    }
    
    // Close connection
    let _ = client.close().await;
    println!("🔌 Connection closed");
    
    Ok(serde_json::json!({
        "success": true,
        "tool_count": tools.len(),
        "tools": tools.iter().map(|t| serde_json::json!({
            "name": t.name,
            "description": t.description
        })).collect::<Vec<_>>()
    }))
}

/// List tools from an MCP server without full initialization
#[tauri::command]
pub async fn list_mcp_tools(
    transport_type: String,
    command: Option<Vec<String>>,
    url: Option<String>,
) -> Result<serde_json::Value, String> {
    use crate::mcp::{McpClient, McpServerConfig, TransportType};
    
    let transport = match transport_type.to_lowercase().as_str() {
        "stdio" => TransportType::Stdio,
        "http" => TransportType::Http,
        _ => return Err(format!("Invalid transport type: {}. Use 'stdio' or 'http'", transport_type)),
    };
    
    let config = McpServerConfig {
        server_name: "tools-server".to_string(),
        transport_type: transport,
        command,
        url,
        env: None,
        headers: None,
        enabled: true,
        timeout_ms: 30000,
    };
    
    let client = McpClient::new(config).await
        .map_err(|e| format!("Failed to create MCP client: {}", e))?;
    
    client.initialize().await
        .map_err(|e| format!("Failed to initialize: {}", e))?;
    
    let tools = client.get_tools().await;
    
    let _ = client.close().await;
    
    Ok(serde_json::json!({
        "success": true,
        "count": tools.len(),
        "tools": tools.iter().map(|t| serde_json::json!({
            "name": t.name,
            "description": t.description
        })).collect::<Vec<_>>()
    }))
}

/// Load MCP configuration from anvil.json
    #[tauri::command]
    pub async fn load_mcp_config(
        _state: State<'_, AppState>,
        workspace_path: String,
    ) -> Result<serde_json::Value, String> {
        let path = PathBuf::from(&workspace_path);
        
        let mut config_manager = crate::config::ConfigManager::new();
        let _ = config_manager.load(Some(&path));
        let config = config_manager.config();
        
        let mcp_config = config.mcp.as_ref();
    
    let enabled_servers: Vec<serde_json::Value> = if let Some(mcp) = mcp_config {
        let servers = mcp.get_servers();
        
        servers.iter().filter(|s| s.enabled).map(|server| {
            serde_json::json!({
                "name": server.name,
                "transport_type": match server.transport_type {
                    crate::mcp::TransportType::Stdio => "stdio",
                    crate::mcp::TransportType::Http => "http",
                },
                "enabled": server.enabled,
                "timeout_ms": server.timeout_ms,
                "command": server.command,
                "url": server.url,
                "env": server.env,
                "headers": server.headers
            })
        }).collect()
    } else {
        Vec::new()
    };
    
    let mcp_enabled = mcp_config
        .and_then(|m| m.enabled)
        .unwrap_or(false);
    
    Ok(serde_json::json!({
        "enabled": mcp_enabled,
        "server_count": enabled_servers.len(),
        "servers": enabled_servers
    }))
}

/// Get all MCP tools from configured servers
    #[tauri::command]
    pub async fn get_all_mcp_tools(
        _state: State<'_, AppState>,
        workspace_path: String,
    ) -> Result<serde_json::Value, String> {
        let path = PathBuf::from(&workspace_path);
        
        let mut config_manager = crate::config::ConfigManager::new();
        let _ = config_manager.load(Some(&path));
        let config = config_manager.config();
    
    let mcp_config = config.mcp.as_ref();
    
    if mcp_config.is_none() || mcp_config.and_then(|m| m.enabled).unwrap_or(false) {
        return Ok(serde_json::json!({
            "enabled": false,
            "tools": []
        }));
    }
    
    let mcp = mcp_config.unwrap();
    let servers = mcp.get_servers();
    let enabled_servers: Vec<_> = servers.iter().filter(|s| s.enabled).collect();
    
    let mut all_tools = Vec::new();
    let mut tool_server_map = std::collections::HashMap::new();
    
    for server in &enabled_servers {
        match server.transport_type {
            crate::mcp::TransportType::Stdio => {
                if let Some(command) = &server.command {
                    let mcp_config = crate::mcp::McpServerConfig {
                        server_name: server.name.clone(),
                        transport_type: crate::mcp::TransportType::Stdio,
                        command: Some(command.clone()),
                        url: None,
                        env: server.env.clone(),
                        headers: None,
                        enabled: true,
                        timeout_ms: server.timeout_ms,
                    };
                    
                    match crate::mcp::McpClient::new(mcp_config).await {
                        Ok(client) => {
                            if let Err(e) = client.initialize().await {
                                println!("⚠️  Failed to connect to {}: {}", server.name, e);
                            } else {
                                let tools = client.get_tools().await;
                                for tool in &tools {
                                    let prefixed_name = format!("{}_{}", server.name, tool.name);
                                    tool_server_map.insert(prefixed_name.clone(), server.name.clone());
                                    all_tools.push(serde_json::json!({
                                        "name": prefixed_name,
                                        "original_name": tool.name,
                                        "server": server.name,
                                        "description": tool.description,
                                        "input_schema": tool.input_schema
                                    }));
                                }
                            }
                            let _ = client.close().await;
                        }
                        Err(e) => {
                            println!("⚠️  Failed to create client for {}: {}", server.name, e);
                        }
                    }
                }
            }
            crate::mcp::TransportType::Http => {
                // HTTP servers support - similar to stdio but with URL
                if let Some(url) = &server.url {
                    let mcp_config = crate::mcp::McpServerConfig {
                        server_name: server.name.clone(),
                        transport_type: crate::mcp::TransportType::Http,
                        command: None,
                        url: Some(url.clone()),
                        env: None,
                        headers: server.headers.clone(),
                        enabled: true,
                        timeout_ms: server.timeout_ms,
                    };
                    
                    match crate::mcp::McpClient::new(mcp_config).await {
                        Ok(client) => {
                            if let Err(e) = client.initialize().await {
                                println!("⚠️  Failed to connect to {}: {}", server.name, e);
                            } else {
                                let tools = client.get_tools().await;
                                for tool in &tools {
                                    let prefixed_name = format!("{}_{}", server.name, tool.name);
                                    tool_server_map.insert(prefixed_name.clone(), server.name.clone());
                                    all_tools.push(serde_json::json!({
                                        "name": prefixed_name,
                                        "original_name": tool.name,
                                        "server": server.name,
                                        "description": tool.description,
                                        "input_schema": tool.input_schema
                                    }));
                                }
                            }
                            let _ = client.close().await;
                        }
                        Err(e) => {
                            println!("⚠️  Failed to create client for {}: {}", server.name, e);
                        }
                    }
                }
            }
        }
    }
    
    Ok(serde_json::json!({
        "enabled": true,
        "tool_count": all_tools.len(),
        "servers": enabled_servers.len(),
        "tools": all_tools
    }))
}

/// Call an MCP tool with arguments
#[tauri::command]
pub async fn call_mcp_tool(
    transport_type: String,
    command: Option<Vec<String>>,
    url: Option<String>,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use crate::mcp::{McpClient, McpServerConfig, TransportType};
    
    let transport = match transport_type.to_lowercase().as_str() {
        "stdio" => TransportType::Stdio,
        "http" => TransportType::Http,
        _ => return Err(format!("Invalid transport type: {}. Use 'stdio' or 'http'", transport_type)),
    };
    
    let config = McpServerConfig {
        server_name: "tool-caller".to_string(),
        transport_type: transport,
        command,
        url,
        env: None,
        headers: None,
        enabled: true,
        timeout_ms: 30000,
    };
    
    let client = McpClient::new(config).await
        .map_err(|e| format!("Failed to create MCP client: {}", e))?;
    
    client.initialize().await
        .map_err(|e| format!("Failed to initialize: {}", e))?;
    
    let result = client.call_tool(&tool_name, arguments).await
        .map_err(|e| format!("Failed to call tool: {}", e))?;
    
    let _ = client.close().await;
    
    Ok(serde_json::json!({
        "success": true,
        "result": result
    }))
}

/// Save MCP configuration to anvil.json
#[tauri::command]
pub async fn save_mcp_config(
    workspace_path: String,
    config: serde_json::Value,
) -> Result<(), String> {
    let path = PathBuf::from(&workspace_path).join(".anvil").join("anvil.json");
    
    // Ensure directory exists
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    
    // Load existing config or create new
    let mut root_config: serde_json::Value = if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        serde_json::json!({})
    };
    
    // Update MCP section
    // config received is the McpConfig object (enabled, servers, etc.)
    // We need to put it under "mcp" key
    if let Some(obj) = root_config.as_object_mut() {
        obj.insert("mcp".to_string(), config);
    } else {
        return Err("Invalid anvil.json format: root is not an object".to_string());
    }
    
    // Write back
    let json = serde_json::to_string_pretty(&root_config).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    
    Ok(())
}

/// Save permission configuration to anvil.json
#[tauri::command]
pub async fn save_permission_config(
    workspace_path: String,
    config: PermissionConfig,
) -> Result<(), String> {
    let path = PathBuf::from(&workspace_path).join(".anvil").join("anvil.json");
    
    // Ensure directory exists
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    
    // Load existing config or create new
    let mut root_config: serde_json::Value = if path.exists() {
        let content =
                std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        serde_json::json!({})
    };
    
    // Update permission field
    if let Some(obj) = root_config.as_object_mut() {
        obj.insert("permission".to_string(), serde_json::to_value(config).map_err(|e| e.to_string())?);
    } else {
        return Err("Invalid anvil.json format: root is not an object".to_string());
    }
    
    // Write back
    let json = serde_json::to_string_pretty(&root_config).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())?;
    
    Ok(())
}

/// Load permission configuration from anvil.json
#[tauri::command]
pub async fn load_permission_config(
    workspace_path: String,
) -> Result<Option<PermissionConfig>, String> {
    let path = PathBuf::from(&workspace_path).join(".anvil").join("anvil.json");
    
    if !path.exists() {
        return Ok(None);
    }
    
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let config = serde_json::from_str::<Config>(&content)
        .map_err(|e| e.to_string())?;
    
    Ok(Some(config.permission))
}

