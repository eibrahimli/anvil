use crate::domain::agent::Agent;
use crate::storage::Storage;
use crate::terminal::TerminalManager;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub struct AppState {
    pub agents: Mutex<HashMap<Uuid, Arc<tokio::sync::Mutex<Agent>>>>,
    pub terminal: Mutex<TerminalManager>,
    pub pending_confirmations: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>>,
    pub storage: Arc<Mutex<Option<Storage>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            agents: Mutex::new(HashMap::new()),
            terminal: Mutex::new(TerminalManager::new()),
            pending_confirmations: Arc::new(Mutex::new(HashMap::new())),
            storage: Arc::new(Mutex::new(None)),
        }
    }
}

    pub fn init_storage(&self, db_path: &str) -> Result<(), String> {
        let mut storage_guard = self.storage.lock().map_err(|e| e.to_string())?;
        if storage_guard.is_some() {
            return Ok(());
        }

        let storage = Storage::new(db_path).expect("Failed to initialize storage");

        *storage_guard = Some(storage);
        Ok(())
    }

    pub fn with_storage<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&Storage) -> Result<R, String>,
    {
        let storage_guard = self.storage.lock().map_err(|e| e.to_string())?;
        match storage_guard.as_ref() {
            Some(storage) => f(storage),
            None => Err("Storage not initialized".to_string()),
        }
    }
}
