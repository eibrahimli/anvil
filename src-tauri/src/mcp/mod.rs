//! MCP (Model Context Protocol) implementation for Anvil
//!
//! This module provides MCP client functionality to connect to external MCP servers
//! and use their tools, resources, and prompts.
//!
//! # Example
//! ```no_run
//! use anvil::mcp::{McpClient, McpServerConfig, TransportType};
//!
//! let config = McpServerConfig {
//!     server_name: "github".to_string(),
//!     transport_type: TransportType::Stdio,
//!     command: Some(vec!["npx".to_string(), "-y".to_string(), "@modelcontextprotocol/server-github".to_string()]),
//!     url: None,
//!     env: None,
//!     headers: None,
//!     enabled: true,
//!     timeout_ms: 30000,
//! };
//!
//! let client = McpClient::new(config).await?;
//! client.initialize().await?;
//!
//! let tools = client.get_tools().await;
//! for tool in tools {
//!     println!("Tool: {} - {}", tool.name, tool.description);
//! }
//! ```

pub mod client;
pub mod error;
pub mod lifecycle;
pub mod transport;

#[cfg(test)]
pub mod integration_tests;

pub use client::{McpClient, McpServerConfig, McpTool, ServerCapabilities, TransportType};
pub use error::{McpError, Result};
pub use lifecycle::{McpLifecycleManager, ServerLifecycle, ServerState};
pub use transport::{HttpTransport, StdioTransport, Transport};

