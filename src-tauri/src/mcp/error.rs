use thiserror::Error;

#[derive(Debug, Error)]
pub enum McpError {
    #[error("Transport error: {0}")]
    Transport(String),

    #[error("Protocol error: {0}")]
    Protocol(String),

    #[error("JSON-RPC error: {code} - {message}")]
    JsonRpc { code: i32, message: String },

    #[error("Tool not found: {0}")]
    ToolNotFound(String),

    #[error("Connection failed: {0}")]
    Connection(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Authentication error: {0}")]
    Auth(String),
}

pub type Result<T> = std::result::Result<T, McpError>;
