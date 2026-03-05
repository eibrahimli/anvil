// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod domain;
pub mod adapters;
pub mod app_state;
pub mod commands;
pub mod terminal;
pub mod storage;
pub mod config;
pub mod mcp;
pub mod workflows;

use app_state::AppState;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You're greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            // Initialize storage
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app data directory");
            let db_path = app_data_dir.join("anvil.db");
            
            if let Err(e) = app.state::<AppState>().init_storage(db_path.to_str().expect("Invalid UTF-8 path")) {
                eprintln!("Failed to initialize storage: {}", e);
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
        greet, 
        commands::create_session, 
        commands::chat, 
        commands::stream_chat,
        commands::stop_stream,
        commands::read_file,
        commands::write_workspace_file,
        commands::write_global_file,
        commands::oauth_device_start,
        commands::oauth_device_poll,
        commands::oauth_pkce_start,
        commands::oauth_pkce_poll,
        commands::oauth_store_tokens,
        commands::oauth_clear_tokens,
        commands::oauth_token_status,
        commands::oauth_get_access_token,
        commands::list_openai_models,
        commands::list_ollama_models,
        commands::spawn_terminal,
        commands::write_terminal,
        commands::resize_terminal,
        commands::get_cwd,
        commands::get_home_dir,
        commands::get_config_dir,
        commands::confirm_action,
        commands::save_session,
        commands::load_session,
        commands::list_sessions,
        commands::export_session,
        commands::start_local_session_share,
        commands::stop_local_session_share,
        commands::import_session,
        commands::write_export_file,
        commands::delete_session,
        commands::rename_session,
        commands::git_status_summary,
        commands::git_file_at_head,
        commands::replay_session,
        commands::init_orchestrator,
        commands::add_agent_to_orchestrator,
        commands::remove_agent_from_orchestrator,
        commands::create_task,
        commands::process_tasks,
        commands::cancel_task,
        commands::retry_task,
        commands::set_orchestrator_execution_mode,
        commands::get_orchestrator_execution_mode,
        commands::get_all_tasks,
        commands::get_task_status,
        commands::open_file_in_editor,
        commands::resolve_question,
        commands::read_todos,
        commands::write_todo,
        commands::get_file_tree,
        commands::search,
        commands::test_mcp_connection,
        commands::list_mcp_tools,
        commands::load_mcp_config,
        commands::list_mcp_tools,
        commands::load_mcp_config,
        commands::get_all_mcp_tools,
        commands::call_mcp_tool,
        commands::save_permission_config,
        commands::save_mcp_config,
        commands::list_workflows,
        commands::load_workflow,
        commands::save_workflow,
        commands::delete_workflow,
        commands::store_api_key,
        commands::get_api_key,
        commands::delete_api_key,
        commands::list_stored_providers,
        commands::get_setting,
        commands::set_setting,
        commands::list_models,
        commands::upsert_model,
        commands::delete_model,
        commands::parse_ast
     ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
