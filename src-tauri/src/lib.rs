// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod domain;
pub mod adapters;
pub mod app_state;
pub mod commands;
pub mod terminal;
pub mod storage;
pub mod config;

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
        commands::read_file,
        commands::spawn_terminal,
        commands::write_terminal,
        commands::resize_terminal,
        commands::get_cwd,
        commands::confirm_action,
        commands::save_session,
        commands::load_session,
        commands::list_sessions,
        commands::delete_session,
        commands::replay_session,
        commands::init_orchestrator,
        commands::add_agent_to_orchestrator,
        commands::create_task,
        commands::process_tasks,
        commands::get_all_tasks,
        commands::get_task_status,
        commands::open_file_in_editor,
        commands::resolve_question,
        commands::read_todos,
        commands::write_todo,
        commands::get_file_tree,
        commands::search
    ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
