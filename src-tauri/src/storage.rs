use crate::domain::models::*;
use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

pub struct Storage {
    db: Connection,
}

impl Storage {
    pub fn new(db_path: &str) -> Result<Self, String> {
        let db_path = Path::new(db_path);
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let db = Connection::open(db_path).map_err(|e| e.to_string())?;

        // Enable foreign keys
        db.execute("PRAGMA foreign_keys = ON", [])
            .map_err(|e| e.to_string())?;

        // Create tables
        db.execute(
            "CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                workspace_path TEXT NOT NULL,
                model TEXT NOT NULL,
                mode TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                name TEXT
            )",
            [],
        )
        .map_err(|e| e.to_string())?;

        if let Err(e) = db.execute("ALTER TABLE sessions ADD COLUMN name TEXT", []) {
            let message = e.to_string();
            if !message.contains("duplicate column name") {
                return Err(message);
            }
        }

        db.execute(
            "CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT,
                tool_calls TEXT,
                tool_call_id TEXT,
                attachments TEXT,
                timestamp TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
            [],
        )
        .map_err(|e| e.to_string())?;

        if let Err(e) = db.execute("ALTER TABLE messages ADD COLUMN attachments TEXT", []) {
            let message = e.to_string();
            if !message.contains("duplicate column name") {
                return Err(message);
            }
        }

        // Create indexes for better performance
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)",
            [],
        )
        .map_err(|e| e.to_string())?;

        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC)",
            [],
        )
        .map_err(|e| e.to_string())?;

        // Settings table (key-value store)
        db.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
            [],
        )
        .map_err(|e| e.to_string())?;

        // Models cache table
        db.execute(
            "CREATE TABLE IF NOT EXISTS models (
                id TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                name TEXT NOT NULL,
                context_window INTEGER,
                is_custom INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
            [],
        )
        .map_err(|e| e.to_string())?;

        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider)",
            [],
        )
        .map_err(|e| e.to_string())?;

        Ok(Storage { db })
    }

    pub fn save_session(&self, session: &AgentSession) -> Result<(), String> {
        let tx = self.db.unchecked_transaction().map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO sessions (id, workspace_path, model, mode, created_at, name)
             VALUES (?1, ?2, ?3, ?4, datetime('now'), (SELECT name FROM sessions WHERE id = ?1))
             ON CONFLICT(id) DO UPDATE SET
                workspace_path = excluded.workspace_path,
                model = excluded.model,
                mode = excluded.mode,
                created_at = excluded.created_at,
                name = COALESCE(sessions.name, excluded.name)",
            params![
                session.id.to_string(),
                session.workspace_path.to_string_lossy(),
                session.model.0,
                format!("{:?}", session.mode),
            ],
        )
        .map_err(|e| e.to_string())?;

        // Clear existing messages for this session
        tx.execute(
            "DELETE FROM messages WHERE session_id = ?1",
            params![session.id.to_string()],
        )
        .map_err(|e| e.to_string())?;

        // Insert all messages except System messages (they're reconstructed on replay)
        for message in &session.messages {
            // Skip System messages - they contain workspace state that's recreated on session replay
            if matches!(message.role, Role::System) {
                continue;
            }

            let tool_calls_json = message
                .tool_calls
                .as_ref()
                .and_then(|t| serde_json::to_string(t).ok())
                .unwrap_or_default();

            let attachments_json = message
                .attachments
                .as_ref()
                .and_then(|a| serde_json::to_string(a).ok())
                .unwrap_or_default();

            tx.execute(
                "INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, attachments, timestamp)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
                params![
                    session.id.to_string(),
                    format!("{:?}", message.role),
                    message.content.clone().unwrap_or_default(),
                    tool_calls_json,
                    message.tool_call_id.clone(),
                    attachments_json,
                ],
            ).map_err(|e| e.to_string())?;
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_session(&self, session_id: &str) -> Result<AgentSession, String> {
        let session_data: Option<(String, String, String)> = self
            .db
            .query_row(
                "SELECT workspace_path, model, mode FROM sessions WHERE id = ?1",
                params![session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|e: rusqlite::Error| e.to_string())?;

        let (workspace_path, model, mode) = session_data.ok_or("Session not found")?;

        let uuid = Uuid::parse_str(session_id).map_err(|_| "Invalid session ID")?;

        let messages: Vec<Message> = {
            let mut stmt = self
                .db
                .prepare(
                    "SELECT role, content, tool_calls, tool_call_id, attachments 
                 FROM messages 
                 WHERE session_id = ?1 
                 ORDER BY id ASC",
                )
                .map_err(|e: rusqlite::Error| e.to_string())?;

            let message_iter = stmt
                .query_map(params![session_id], |row| {
                    let role_str: String = row.get(0)?;
                    let role = match role_str.as_str() {
                        "System" => Role::System,
                        "User" => Role::User,
                        "Assistant" => Role::Assistant,
                        "Tool" => Role::Tool,
                        _ => Role::System,
                    };

                    let content: Option<String> = row.get(1)?;
                    let content = if content.as_deref() == Some("") {
                        None
                    } else {
                        content
                    };

                    let tool_calls_str: Option<String> = row.get(2)?;
                    let tool_calls = tool_calls_str.and_then(|s| serde_json::from_str(&s).ok());

                    let tool_call_id: Option<String> = row.get(3)?;
                    let tool_call_id = if tool_call_id.as_deref() == Some("") {
                        None
                    } else {
                        tool_call_id
                    };

                    let attachments_str: Option<String> = row.get(4)?;
                    let attachments = attachments_str.and_then(|s| serde_json::from_str(&s).ok());

                    Ok(Message {
                        role,
                        content,
                        tool_calls,
                        tool_call_id,
                        attachments,
                    })
                })
                .map_err(|e| e.to_string())?;

            message_iter
                .collect::<SqliteResult<Vec<_>>>()
                .map_err(|e| e.to_string())?
        };

        let agent_mode = match mode.as_str() {
            "Plan" => AgentMode::Plan,
            "Research" => AgentMode::Research,
            _ => AgentMode::Build,
        };

        Ok(AgentSession {
            id: uuid,
            workspace_path: workspace_path.clone().into(),
            model: ModelId(model),
            mode: agent_mode,
            messages,
            permissions: AgentPermissions {
                config: {
                    let mut config_manager = crate::config::ConfigManager::new();
                    let _ = config_manager.load(Some(&std::path::Path::new(&workspace_path)));
                    config_manager.config().permission.clone()
                },
            },
        })
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionMetadata>, String> {
        let mut stmt = self.db.prepare(
            "SELECT s.id, s.workspace_path, s.model, s.mode, s.created_at, s.name, COUNT(m.id) as message_count
             FROM sessions s
             LEFT JOIN messages m ON s.id = m.session_id
             GROUP BY s.id
             ORDER BY s.created_at DESC"
        ).map_err(|e: rusqlite::Error| e.to_string())?;

        let sessions = stmt
            .query_map([], |row| {
                let mode_str: String = row.get(3)?;
                let mode = match mode_str.as_str() {
                    "Plan" => "Plan".to_string(),
                    "Research" => "Research".to_string(),
                    _ => "Build".to_string(),
                };

                Ok(SessionMetadata {
                    id: row.get(0)?,
                    workspace_path: row.get(1)?,
                    model: row.get(2)?,
                    mode,
                    created_at: row.get(4)?,
                    name: row.get(5)?,
                    message_count: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        sessions
            .collect::<SqliteResult<Vec<_>>>()
            .map_err(|e| e.to_string())
    }

    pub fn export_session(&self, session_id: &str) -> Result<SessionExport, String> {
        let session_data: Option<(String, String, String, String, String, Option<String>)> = self
            .db
            .query_row(
                "SELECT id, workspace_path, model, mode, created_at, name FROM sessions WHERE id = ?1",
                params![session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )
            .optional()
            .map_err(|e: rusqlite::Error| e.to_string())?;

        let (id, workspace_path, model, mode, created_at, name) =
            session_data.ok_or("Session not found")?;

        let messages: Vec<ExportMessage> = {
            let mut stmt = self
                .db
                .prepare(
                    "SELECT role, content, tool_calls, tool_call_id, attachments, timestamp
                     FROM messages
                     WHERE session_id = ?1
                     ORDER BY id ASC",
                )
                .map_err(|e: rusqlite::Error| e.to_string())?;

            let message_iter = stmt
                .query_map(params![session_id], |row| {
                    let role: String = row.get(0)?;
                    let content: Option<String> = row.get(1)?;
                    let content = if content.as_deref() == Some("") {
                        None
                    } else {
                        content
                    };

                    let tool_calls_str: Option<String> = row.get(2)?;
                    let tool_calls = match tool_calls_str {
                        Some(value) if !value.trim().is_empty() => {
                            serde_json::from_str(&value).ok()
                        }
                        _ => None,
                    };

                    let tool_call_id: Option<String> = row.get(3)?;
                    let tool_call_id = if tool_call_id.as_deref() == Some("") {
                        None
                    } else {
                        tool_call_id
                    };

                    let attachments_str: Option<String> = row.get(4)?;
                    let attachments = match attachments_str {
                        Some(value) if !value.trim().is_empty() => {
                            serde_json::from_str(&value).ok()
                        }
                        _ => None,
                    };

                    let timestamp: String = row.get(5)?;

                    Ok(ExportMessage {
                        role,
                        content,
                        tool_calls,
                        tool_call_id,
                        attachments,
                        timestamp,
                    })
                })
                .map_err(|e| e.to_string())?;

            message_iter
                .collect::<SqliteResult<Vec<_>>>()
                .map_err(|e| e.to_string())?
        };

        Ok(SessionExport {
            id,
            workspace_path,
            model,
            mode,
            created_at,
            name,
            messages,
        })
    }

    pub fn import_session(
        &self,
        export: &SessionExport,
        workspace_override: Option<String>,
    ) -> Result<String, String> {
        let new_id = Uuid::new_v4().to_string();
        let workspace_path = workspace_override.unwrap_or_else(|| export.workspace_path.clone());

        let tx = self.db.unchecked_transaction().map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO sessions (id, workspace_path, model, mode, created_at, name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                new_id,
                workspace_path,
                export.model.clone(),
                export.mode.clone(),
                export.created_at.clone(),
                export.name.clone(),
            ],
        )
        .map_err(|e| e.to_string())?;

        for message in &export.messages {
            let content = message.content.clone().unwrap_or_default();
            let tool_calls_json = message
                .tool_calls
                .as_ref()
                .and_then(|value| serde_json::to_string(value).ok())
                .unwrap_or_default();
            let attachments_json = message
                .attachments
                .as_ref()
                .and_then(|value| serde_json::to_string(value).ok())
                .unwrap_or_default();

            tx.execute(
                "INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, attachments, timestamp)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    new_id,
                    message.role.clone(),
                    content,
                    tool_calls_json,
                    message.tool_call_id.clone(),
                    attachments_json,
                    message.timestamp.clone(),
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(new_id)
    }

    pub fn delete_session(&self, session_id: &str) -> Result<(), String> {
        self.db
            .execute("DELETE FROM sessions WHERE id = ?1", params![session_id])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn rename_session(&self, session_id: &str, name: Option<String>) -> Result<(), String> {
        let normalized = name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        self.db
            .execute(
                "UPDATE sessions SET name = ?1 WHERE id = ?2",
                params![normalized, session_id],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        self.db
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e: rusqlite::Error| e.to_string())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.db
            .execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
                params![key, value],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn list_models(&self, provider: Option<&str>) -> Result<Vec<StoredModel>, String> {
        if let Some(prov) = provider {
            let prov = prov.to_string();
            let mut stmt = self.db.prepare(
                "SELECT id, provider, name, context_window, is_custom FROM models WHERE provider = ?1 ORDER BY name"
            ).map_err(|e: rusqlite::Error| e.to_string())?;
            let iter = stmt.query_map(params![prov], |row| {
                Ok(StoredModel {
                    id: row.get(0)?,
                    provider: row.get(1)?,
                    name: row.get(2)?,
                    context_window: row.get(3)?,
                    is_custom: row.get::<_, i64>(4).map(|v| v != 0)?,
                })
            }).map_err(|e| e.to_string())?;
            return iter.collect::<SqliteResult<Vec<_>>>().map_err(|e| e.to_string());
        }
        let mut stmt = self.db.prepare(
            "SELECT id, provider, name, context_window, is_custom FROM models ORDER BY provider, name"
        ).map_err(|e: rusqlite::Error| e.to_string())?;
        let iter = stmt.query_map([], |row| {
            Ok(StoredModel {
                id: row.get(0)?,
                provider: row.get(1)?,
                name: row.get(2)?,
                context_window: row.get(3)?,
                is_custom: row.get::<_, i64>(4).map(|v| v != 0)?,
            })
        }).map_err(|e| e.to_string())?;
        iter.collect::<SqliteResult<Vec<_>>>().map_err(|e| e.to_string())
    }

    pub fn upsert_model(&self, model: &StoredModel) -> Result<(), String> {
        self.db
            .execute(
                "INSERT INTO models (id, provider, name, context_window, is_custom, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
                 ON CONFLICT(id) DO UPDATE SET
                    provider = excluded.provider,
                    name = excluded.name,
                    context_window = excluded.context_window,
                    is_custom = excluded.is_custom,
                    updated_at = datetime('now')",
                params![
                    model.id,
                    model.provider,
                    model.name,
                    model.context_window,
                    model.is_custom as i64,
                ],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn delete_model(&self, id: &str) -> Result<(), String> {
        self.db
            .execute("DELETE FROM models WHERE id = ?1", params![id])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn get_session_summary(&self, session_id: &str) -> Result<Option<String>, String> {
        let summary: Option<String> = self
            .db
            .query_row(
                "SELECT content 
             FROM messages 
             WHERE session_id = ?1 AND role = 'User'
             ORDER BY id ASC 
             LIMIT 1",
                params![session_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e: rusqlite::Error| e.to_string())?;

        Ok(summary)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionMetadata {
    pub id: String,
    pub workspace_path: String,
    pub model: String,
    pub mode: String,
    pub created_at: String,
    pub name: Option<String>,
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportMessage {
    pub role: String,
    pub content: Option<String>,
    pub tool_calls: Option<serde_json::Value>,
    pub tool_call_id: Option<String>,
    pub attachments: Option<serde_json::Value>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredModel {
    pub id: String,
    pub provider: String,
    pub name: String,
    pub context_window: Option<i64>,
    pub is_custom: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionExport {
    pub id: String,
    pub workspace_path: String,
    pub model: String,
    pub mode: String,
    pub created_at: String,
    pub name: Option<String>,
    pub messages: Vec<ExportMessage>,
}
