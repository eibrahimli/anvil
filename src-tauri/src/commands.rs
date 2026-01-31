use crate::app_state::AppState;
use crate::adapters::openai::OpenAIAdapter;
use crate::adapters::gemini::GeminiAdapter;
use crate::adapters::anthropic::AnthropicAdapter;
use crate::adapters::ollama::OllamaAdapter;
use crate::adapters::tools::{files::ReadFileTool, files::WriteFileTool, files::EditFileTool, bash::BashTool, git::GitTool, search::SearchTool, symbols::SymbolsTool, glob::GlobTool, list::ListTool, web::WebFetchTool, patch::PatchTool, question::QuestionTool, todo::TodoWriteTool};
use crate::domain::agent::Agent;
use crate::domain::orchestrator::{Orchestrator, Task, TaskStatus};
use crate::domain::models::{AgentSession, AgentPermissions, ModelId, AgentMode, AgentRole};
use crate::domain::ports::ModelAdapter;
use std::collections::HashSet;
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
        Arc::new(SearchTool::new(path.clone())),
        Arc::new(EditFileTool::new(
            path.clone(),
            app.clone(),
            state.pending_confirmations.clone()
        )),
        Arc::new(SymbolsTool::new(path.clone())),
        Arc::new(GlobTool::new(path.clone())),
        Arc::new(ListTool::new(path.clone())),
        Arc::new(WebFetchTool::new()),
        Arc::new(PatchTool::new(path.clone())),
        Arc::new(QuestionTool::new(app.clone())),
        Arc::new(TodoWriteTool::new(path.clone())),
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
        Arc::new(SearchTool::new(path.clone())),
        Arc::new(EditFileTool::new(
            path.clone(),
            app.clone(),
            state.pending_confirmations.clone()
        )),
        Arc::new(SymbolsTool::new(path.clone())),
        Arc::new(GlobTool::new(path.clone())),
        Arc::new(ListTool::new(path.clone())),
        Arc::new(WebFetchTool::new()),
        Arc::new(PatchTool::new(path.clone())),
        Arc::new(QuestionTool::new(app.clone())),
        Arc::new(TodoWriteTool::new(path.clone())),
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
        Arc::new(SearchTool::new(path.clone())),
        Arc::new(EditFileTool::new(
            path.clone(),
            app.clone(),
            state.pending_confirmations.clone()
        )),
        Arc::new(SymbolsTool::new(path.clone())),
        Arc::new(GlobTool::new(path.clone())),
        Arc::new(ListTool::new(path.clone())),
        Arc::new(WebFetchTool::new()),
        Arc::new(PatchTool::new(path.clone())),
        Arc::new(QuestionTool::new(app.clone())),
        Arc::new(TodoWriteTool::new(path.clone())),
    ];

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
