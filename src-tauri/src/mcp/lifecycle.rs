//! MCP Server Lifecycle Management
//!
//! This module provides functionality for tracking and managing MCP server states,
//! including connection status, health monitoring, and lifecycle operations.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// Server lifecycle states
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerState {
    /// Server is not connected
    Disconnected,
    /// Server is attempting to connect
    Connecting,
    /// Server is connected and ready
    Connected,
    /// Server connection failed
    Failed,
    /// Server is reconnecting after failure
    Reconnecting,
    /// Server has been explicitly disabled
    Disabled,
}

impl Default for ServerState {
    fn default() -> Self {
        ServerState::Disconnected
    }
}

impl std::fmt::Display for ServerState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ServerState::Disconnected => write!(f, "disconnected"),
            ServerState::Connecting => write!(f, "connecting"),
            ServerState::Connected => write!(f, "connected"),
            ServerState::Failed => write!(f, "failed"),
            ServerState::Reconnecting => write!(f, "reconnecting"),
            ServerState::Disabled => write!(f, "disabled"),
        }
    }
}

/// Server lifecycle information
#[derive(Debug, Clone)]
pub struct ServerLifecycle {
    /// Server name
    pub name: String,
    /// Current state
    pub state: ServerState,
    /// Last connection attempt time
    pub last_connect_attempt: Option<Instant>,
    /// Last successful connection time
    pub last_connected_at: Option<Instant>,
    /// Connection failure count
    pub failure_count: u32,
    /// Last error message (if any)
    pub last_error: Option<String>,
    /// Number of successful reconnections
    pub reconnection_count: u32,
}

/// Serializable version of ServerLifecycle for API responses
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ServerLifecycleInfo {
    /// Server name
    pub name: String,
    /// Current state
    pub state: ServerState,
    /// Connection failure count
    pub failure_count: u32,
    /// Last error message (if any)
    pub last_error: Option<String>,
    /// Number of successful reconnections
    pub reconnection_count: u32,
    /// Whether currently connected
    pub is_connected: bool,
}

impl ServerLifecycle {
    /// Create a new server lifecycle tracker
    pub fn new(name: String) -> Self {
        Self {
            name,
            state: ServerState::Disconnected,
            last_connect_attempt: None,
            last_connected_at: None,
            failure_count: 0,
            last_error: None,
            reconnection_count: 0,
        }
    }

    /// Mark server as connecting
    pub fn mark_connecting(&mut self) {
        self.state = ServerState::Connecting;
        self.last_connect_attempt = Some(Instant::now());
    }

    /// Mark server as connected
    pub fn mark_connected(&mut self) {
        self.state = ServerState::Connected;
        self.last_connected_at = Some(Instant::now());
        self.failure_count = 0;
        self.last_error = None;
    }

    /// Mark server as failed
    pub fn mark_failed(&mut self, error: String) {
        self.state = ServerState::Failed;
        self.failure_count += 1;
        self.last_error = Some(error);
    }

    /// Mark server as reconnecting
    pub fn mark_reconnecting(&mut self) {
        self.state = ServerState::Reconnecting;
        self.reconnection_count += 1;
        self.last_connect_attempt = Some(Instant::now());
    }

    /// Mark server as disabled
    pub fn mark_disabled(&mut self) {
        self.state = ServerState::Disabled;
    }

    /// Mark server as disconnected
    pub fn mark_disconnected(&mut self) {
        self.state = ServerState::Disconnected;
    }

    /// Check if server is in a connected state
    pub fn is_connected(&self) -> bool {
        self.state == ServerState::Connected
    }

    /// Check if server should attempt reconnection
    pub fn should_reconnect(&self, max_failures: u32) -> bool {
        match self.state {
            ServerState::Failed | ServerState::Disconnected => {
                self.failure_count < max_failures
            }
            _ => false,
        }
    }

    /// Get time since last connection attempt
    pub fn time_since_last_attempt(&self) -> Option<Duration> {
        self.last_connect_attempt.map(|t| t.elapsed())
    }

    /// Get time since last successful connection
    pub fn time_since_connected(&self) -> Option<Duration> {
        self.last_connected_at.map(|t| t.elapsed())
    }
}

/// Manages lifecycle state for all MCP servers
#[derive(Debug, Clone)]
pub struct McpLifecycleManager {
    servers: Arc<RwLock<HashMap<String, ServerLifecycle>>>,
    max_reconnection_attempts: u32,
}

impl McpLifecycleManager {
    /// Create a new lifecycle manager
    pub fn new() -> Self {
        Self {
            servers: Arc::new(RwLock::new(HashMap::new())),
            max_reconnection_attempts: 3,
        }
    }

    /// Create with custom reconnection limit
    pub fn with_max_reconnections(max_attempts: u32) -> Self {
        Self {
            servers: Arc::new(RwLock::new(HashMap::new())),
            max_reconnection_attempts: max_attempts,
        }
    }

    /// Register a server for lifecycle tracking
    pub async fn register_server(&self, name: String) {
        let mut servers = self.servers.write().await;
        if !servers.contains_key(&name) {
            servers.insert(name.clone(), ServerLifecycle::new(name));
        }
    }

    /// Get lifecycle info for a server
    pub async fn get_server(&self, name: &str) -> Option<ServerLifecycle> {
        let servers = self.servers.read().await;
        servers.get(name).cloned()
    }

    /// Get all server lifecycles
    pub async fn get_all_servers(&self) -> Vec<ServerLifecycle> {
        let servers = self.servers.read().await;
        servers.values().cloned().collect()
    }

    /// Update server state to connecting
    pub async fn mark_connecting(&self, name: &str) {
        let mut servers = self.servers.write().await;
        if let Some(server) = servers.get_mut(name) {
            server.mark_connecting();
        }
    }

    /// Update server state to connected
    pub async fn mark_connected(&self, name: &str) {
        let mut servers = self.servers.write().await;
        if let Some(server) = servers.get_mut(name) {
            server.mark_connected();
        }
    }

    /// Update server state to failed
    pub async fn mark_failed(&self, name: &str, error: String) {
        let mut servers = self.servers.write().await;
        if let Some(server) = servers.get_mut(name) {
            server.mark_failed(error);
        }
    }

    /// Update server state to reconnecting
    pub async fn mark_reconnecting(&self, name: &str) {
        let mut servers = self.servers.write().await;
        if let Some(server) = servers.get_mut(name) {
            server.mark_reconnecting();
        }
    }

    /// Update server state to disabled
    pub async fn mark_disabled(&self, name: &str) {
        let mut servers = self.servers.write().await;
        if let Some(server) = servers.get_mut(name) {
            server.mark_disabled();
        }
    }

    /// Update server state to disconnected
    pub async fn mark_disconnected(&self, name: &str) {
        let mut servers = self.servers.write().await;
        if let Some(server) = servers.get_mut(name) {
            server.mark_disconnected();
        }
    }

    /// Get servers that need reconnection
    pub async fn get_servers_needing_reconnect(&self) -> Vec<String> {
        let servers = self.servers.read().await;
        servers
            .iter()
            .filter(|(_, lifecycle)| lifecycle.should_reconnect(self.max_reconnection_attempts))
            .map(|(name, _)| name.clone())
            .collect()
    }

    /// Remove a server from tracking
    pub async fn remove_server(&self, name: &str) {
        let mut servers = self.servers.write().await;
        servers.remove(name);
    }

    /// Clear all server tracking
    pub async fn clear_all(&self) {
        let mut servers = self.servers.write().await;
        servers.clear();
    }

    /// Get count of servers in each state
    pub async fn get_state_summary(&self) -> HashMap<String, usize> {
        let servers = self.servers.read().await;
        let mut summary: HashMap<String, usize> = HashMap::new();

        for lifecycle in servers.values() {
            let state_str = lifecycle.state.to_string();
            *summary.entry(state_str).or_insert(0) += 1;
        }

        summary
    }

    /// Get list of connected servers
    pub async fn get_connected_servers(&self) -> Vec<String> {
        let servers = self.servers.read().await;
        servers
            .iter()
            .filter(|(_, lifecycle)| lifecycle.is_connected())
            .map(|(name, _)| name.clone())
            .collect()
    }

    /// Get list of failed servers
    pub async fn get_failed_servers(&self) -> Vec<(String, Option<String>)> {
        let servers = self.servers.read().await;
        servers
            .iter()
            .filter(|(_, lifecycle)| lifecycle.state == ServerState::Failed)
            .map(|(name, lifecycle)| (name.clone(), lifecycle.last_error.clone()))
            .collect()
    }
}

impl Default for McpLifecycleManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_server_lifecycle_transitions() {
        let manager = McpLifecycleManager::new();

        // Register server
        manager.register_server("test-server".to_string()).await;

        // Test connecting
        manager.mark_connecting("test-server").await;
        let server = manager.get_server("test-server").await.unwrap();
        assert_eq!(server.state, ServerState::Connecting);
        assert!(server.last_connect_attempt.is_some());

        // Test connected
        manager.mark_connected("test-server").await;
        let server = manager.get_server("test-server").await.unwrap();
        assert_eq!(server.state, ServerState::Connected);
        assert!(server.last_connected_at.is_some());
        assert_eq!(server.failure_count, 0);

        // Test failed
        manager.mark_failed("test-server", "Connection refused".to_string()).await;
        let server = manager.get_server("test-server").await.unwrap();
        assert_eq!(server.state, ServerState::Failed);
        assert_eq!(server.failure_count, 1);
        assert_eq!(server.last_error, Some("Connection refused".to_string()));

        // Test reconnecting
        manager.mark_reconnecting("test-server").await;
        let server = manager.get_server("test-server").await.unwrap();
        assert_eq!(server.state, ServerState::Reconnecting);
        assert_eq!(server.reconnection_count, 1);

        // Test connected again (resets failure count)
        manager.mark_connected("test-server").await;
        let server = manager.get_server("test-server").await.unwrap();
        assert_eq!(server.failure_count, 0);
    }

    #[tokio::test]
    async fn test_should_reconnect() {
        let manager = McpLifecycleManager::new();
        manager.register_server("test-server".to_string()).await;

        // Should reconnect when disconnected
        manager.mark_disconnected("test-server").await;
        let needs_reconnect = manager.get_servers_needing_reconnect().await;
        assert!(needs_reconnect.contains(&"test-server".to_string()));

        // Should not reconnect after max failures
        for _ in 0..3 {
            manager.mark_failed("test-server", "error".to_string()).await;
        }
        let needs_reconnect = manager.get_servers_needing_reconnect().await;
        assert!(!needs_reconnect.contains(&"test-server".to_string()));
    }

    #[tokio::test]
    async fn test_disabled_server() {
        let manager = McpLifecycleManager::new();
        manager.register_server("test-server".to_string()).await;

        manager.mark_disabled("test-server").await;
        let server = manager.get_server("test-server").await.unwrap();
        assert_eq!(server.state, ServerState::Disabled);
        assert!(!server.should_reconnect(3));
    }

    #[tokio::test]
    async fn test_state_summary() {
        let manager = McpLifecycleManager::new();

        manager.register_server("server1".to_string()).await;
        manager.register_server("server2".to_string()).await;
        manager.register_server("server3".to_string()).await;

        manager.mark_connected("server1").await;
        manager.mark_failed("server2", "error".to_string()).await;
        manager.mark_connecting("server3").await;

        let summary = manager.get_state_summary().await;
        assert_eq!(summary.get("connected"), Some(&1));
        assert_eq!(summary.get("failed"), Some(&1));
        assert_eq!(summary.get("connecting"), Some(&1));
    }

    #[tokio::test]
    async fn test_get_connected_servers() {
        let manager = McpLifecycleManager::new();

        manager.register_server("server1".to_string()).await;
        manager.register_server("server2".to_string()).await;
        manager.register_server("server3".to_string()).await;

        manager.mark_connected("server1").await;
        manager.mark_connected("server2").await;
        manager.mark_failed("server3", "error".to_string()).await;

        let connected = manager.get_connected_servers().await;
        assert_eq!(connected.len(), 2);
        assert!(connected.contains(&"server1".to_string()));
        assert!(connected.contains(&"server2".to_string()));
    }
}
