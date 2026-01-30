use crate::domain::models::*;
use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};
use serde::Serialize;
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
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
            [],
        )
        .map_err(|e| e.to_string())?;

        db.execute(
            "CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT,
                tool_calls TEXT,
                tool_call_id TEXT,
                timestamp TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
            [],
        )
        .map_err(|e| e.to_string())?;

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

        Ok(Storage { db })
    }

    pub fn save_session(&self, session: &AgentSession) -> Result<(), String> {
        let tx = self.db.unchecked_transaction().map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT OR REPLACE INTO sessions (id, workspace_path, model, mode, created_at)
             VALUES (?1, ?2, ?3, ?4, datetime('now'))",
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

        // Insert all messages
        for message in &session.messages {
            let tool_calls_json = message
                .tool_calls
                .as_ref()
                .and_then(|t| serde_json::to_string(t).ok())
                .unwrap_or_default();

            tx.execute(
                "INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, timestamp)
                 VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
                params![
                    session.id.to_string(),
                    format!("{:?}", message.role),
                    message.content.clone().unwrap_or_default(),
                    tool_calls_json,
                    message.tool_call_id.clone(),
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
                    "SELECT role, content, tool_calls, tool_call_id 
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

                    Ok(Message {
                        role,
                        content,
                        tool_calls,
                        tool_call_id,
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
            workspace_path: workspace_path.into(),
            model: ModelId(model),
            mode: agent_mode,
            messages,
            permissions: AgentPermissions {
                allowed: std::collections::HashSet::new(),
            },
        })
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionMetadata>, String> {
        let mut stmt = self.db.prepare(
            "SELECT s.id, s.workspace_path, s.model, s.mode, s.created_at, COUNT(m.id) as message_count
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
                    message_count: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;

        sessions
            .collect::<SqliteResult<Vec<_>>>()
            .map_err(|e| e.to_string())
    }

    pub fn delete_session(&self, session_id: &str) -> Result<(), String> {
        self.db
            .execute("DELETE FROM sessions WHERE id = ?1", params![session_id])
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
    pub message_count: i64,
}
