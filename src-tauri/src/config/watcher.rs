use notify::{Watcher, RecursiveMode, Event, EventKind};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use crate::config::ConfigManager;
use crate::domain::agent::Agent;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;
use tokio::sync::Mutex;

pub fn start_config_watcher(
    agents: Arc<Mutex<HashMap<Uuid, Arc<Mutex<Agent>>>>>,
    config_watchers: Arc<std::sync::Mutex<HashSet<PathBuf>>>,
    workspace_path: PathBuf,
) {
    // Check if we are already watching this workspace
    {
        let mut watchers = config_watchers.lock().unwrap();
        if watchers.contains(&workspace_path) {
            return;
        }
        watchers.insert(workspace_path.clone());
    }

    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        
        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                     let _ = tx.blocking_send(());
                }
            }
        }).unwrap();

        let watch_target = workspace_path.join(".anvil");
        if let Err(e) = std::fs::create_dir_all(&watch_target) {
            eprintln!("Failed to create config directory {:?}: {}", watch_target, e);
            return;
        }
        
        if let Err(e) = watcher.watch(&watch_target, RecursiveMode::NonRecursive) {
            eprintln!("Failed to watch config directory {:?}: {}", watch_target, e);
            return;
        }

        println!("Started watching config at {:?}", watch_target);

        // Debounce loop
        while let Some(_) = rx.recv().await {
            tokio::time::sleep(Duration::from_millis(500)).await;
            while rx.try_recv().is_ok() {}

            println!("Config change detected in {:?}, reloading...", workspace_path);
            
            let mut manager = ConfigManager::new();
            if let Ok(_) = manager.load(Some(&workspace_path)) {
                let new_config = manager.config();
                
                let agents_map = agents.lock().await;
                for (_, agent_arc) in agents_map.iter() {
                    let agent = agent_arc.lock().await;
                    if agent.session.workspace_path == workspace_path {
                        let mut perms = agent.permission_manager.lock().await;
                        *perms = new_config.permission.clone();
                        println!("Updated permissions for agent {}", agent.session.id);
                    }
                }
            }
        }
    });
}
