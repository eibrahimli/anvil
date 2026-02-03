use crate::mcp::error::{McpError, Result};
use crate::mcp::transport::{Transport, StdioTransport, HttpTransport};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::HashMap;

/// MCP server configuration
#[derive(Debug, Clone)]
pub struct McpServerConfig {
    pub server_name: String,
    pub transport_type: TransportType,
    pub command: Option<Vec<String>>,
    pub url: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub headers: Option<HashMap<String, String>>,
    pub enabled: bool,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TransportType {
    Stdio,
    Http,
}

/// Tool information from MCP server
#[derive(Debug, Clone)]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// Server capabilities from MCP
#[derive(Debug, Clone)]
pub struct ServerCapabilities {
    pub tools: Option<Value>,
    pub resources: Option<Value>,
    pub prompts: Option<Value>,
}

/// MCP Client for connecting to and interacting with MCP servers
pub struct McpClient {
    config: McpServerConfig,
    transport: Arc<tokio::sync::Mutex<dyn Transport>>,
    tools: Arc<RwLock<HashMap<String, McpTool>>>,
    capabilities: Arc<RwLock<Option<ServerCapabilities>>>,
    initialized: Arc<RwLock<bool>>,
}

impl McpClient {
    /// Create a new MCP client
    pub async fn new(config: McpServerConfig) -> Result<Self> {
        let transport_mutex: Arc<tokio::sync::Mutex<dyn Transport>> = match &config.transport_type {
            TransportType::Stdio => {
                let command = config.command.clone()
                    .ok_or(McpError::Config("Missing command for stdio transport".to_string()))?;
                let env = config.env.clone().unwrap_or_default();
                let transport = StdioTransport::new(command, env).await?;
                Arc::new(tokio::sync::Mutex::new(transport))
            }
            TransportType::Http => {
                let url = config.url.clone()
                    .ok_or(McpError::Config("Missing URL for HTTP transport".to_string()))?;
                let headers = config.headers.clone().unwrap_or_default();
                let transport = HttpTransport::new(url, headers).await?;
                Arc::new(tokio::sync::Mutex::new(transport))
            }
        };

        Ok(Self {
            config,
            transport: transport_mutex,
            tools: Arc::new(RwLock::new(HashMap::new())),
            capabilities: Arc::new(RwLock::new(None)),
            initialized: Arc::new(RwLock::new(false)),
        })
    }

    /// Initialize MCP connection
    pub async fn initialize(&self) -> Result<()> {
        if *self.initialized.read().await {
            return Ok(());
        }

        let init_request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {
                    "tools": {},
                    "resources": {},
                    "prompts": {}
                },
                "clientInfo": {
                    "name": "anvil",
                    "version": "0.1.0"
                }
            }
        });

        {
            let transport = self.transport.lock().await;
            let response = transport.send_request(init_request).await?;

            if let Some(result) = response.get("result") {
                let capabilities = ServerCapabilities {
                    tools: result.get("tools").cloned(),
                    resources: result.get("resources").cloned(),
                    prompts: result.get("prompts").cloned(),
                };
                *self.capabilities.write().await = Some(capabilities);
            }
            // Lock released here at end of scope
        }

        // Send initialized notification (no response expected)
        let initialized_notif = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });

        {
            let transport = self.transport.lock().await;
            // Use send_raw for notifications since they don't expect a response
            let _ = transport.send_raw(serde_json::to_string(&initialized_notif).unwrap()).await;
            // Lock released here at end of scope
        }

        *self.initialized.write().await = true;

        self.discover_tools().await?;

        Ok(())
    }

    /// List available tools from MCP server
    async fn discover_tools(&self) -> Result<()> {
        let list_tools_request = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list"
        });

        let response = {
            let transport = self.transport.lock().await;
            transport.send_request(list_tools_request).await?
        };

        if let Some(result) = response.get("result") {
            if let Some(tools_array) = result.get("tools").and_then(|v| v.as_array()) {
                let mut tools_map = HashMap::new();
                for tool_json in tools_array {
                    if let Some(name) = tool_json.get("name").and_then(|v| v.as_str()) {
                        let tool = McpTool {
                            name: name.to_string(),
                            description: tool_json.get("description")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            input_schema: tool_json.get("inputSchema")
                                .cloned()
                                .unwrap_or(json!({})),
                        };
                        tools_map.insert(name.to_string(), tool);
                    }
                }
                *self.tools.write().await = tools_map;
            }
        }

        Ok(())
    }

    /// Get all available tools
    pub async fn get_tools(&self) -> Vec<McpTool> {
        self.tools.read().await.values().cloned().collect()
    }

    /// Get a specific tool by name
    pub async fn get_tool(&self, name: &str) -> Option<McpTool> {
        self.tools.read().await.get(name).cloned()
    }

    /// Call a tool on the MCP server
    pub async fn call_tool(&self, tool_name: &str, arguments: Value) -> Result<Value> {
        if !*self.initialized.read().await {
            self.initialize().await?;
        }

        let call_request = json!({
            "jsonrpc": "2.0",
            "id": self.generate_request_id(),
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments
            }
        });

        let transport = self.transport.lock().await;
        let response = transport.send_request(call_request).await?;

        if let Some(result) = response.get("result") {
            Ok(result.clone())
        } else {
            Err(McpError::Protocol("Invalid tool call response".to_string()))
        }
    }

    /// List resources from MCP server
    pub async fn list_resources(&self) -> Result<Value> {
        if !*self.initialized.read().await {
            self.initialize().await?;
        }

        let request = json!({
            "jsonrpc": "2.0",
            "id": self.generate_request_id(),
            "method": "resources/list"
        });

        let transport = self.transport.lock().await;
        let response = transport.send_request(request).await?;

        response.get("result")
            .cloned()
            .ok_or(McpError::Protocol("Invalid resources/list response".to_string()))
    }

    /// Read a resource from the MCP server
    pub async fn read_resource(&self, uri: &str) -> Result<Value> {
        if !*self.initialized.read().await {
            self.initialize().await?;
        }

        let request = json!({
            "jsonrpc": "2.0",
            "id": self.generate_request_id(),
            "method": "resources/read",
            "params": {
                "uri": uri
            }
        });

        let transport = self.transport.lock().await;
        let response = transport.send_request(request).await?;

        response.get("result")
            .cloned()
            .ok_or(McpError::Protocol("Invalid resources/read response".to_string()))
    }

    /// List prompts from the MCP server
    pub async fn list_prompts(&self) -> Result<Value> {
        if !*self.initialized.read().await {
            self.initialize().await?;
        }

        let request = json!({
            "jsonrpc": "2.0",
            "id": self.generate_request_id(),
            "method": "prompts/list"
        });

        let transport = self.transport.lock().await;
        let response = transport.send_request(request).await?;

        response.get("result")
            .cloned()
            .ok_or(McpError::Protocol("Invalid prompts/list response".to_string()))
    }

    /// Get a prompt from the MCP server
    pub async fn get_prompt(&self, name: &str, arguments: Option<Value>) -> Result<Value> {
        if !*self.initialized.read().await {
            self.initialize().await?;
        }

        let mut params = json!({ "name": name });
        if let Some(args) = arguments {
            params["arguments"] = args;
        }

        let request = json!({
            "jsonrpc": "2.0",
            "id": self.generate_request_id(),
            "method": "prompts/get",
            "params": params
        });

        let transport = self.transport.lock().await;
        let response = transport.send_request(request).await?;

        response.get("result")
            .cloned()
            .ok_or(McpError::Protocol("Invalid prompts/get response".to_string()))
    }

    /// Send a ping to check server health
    pub async fn ping(&self) -> Result<Value> {
        let request = json!({
            "jsonrpc": "2.0",
            "id": self.generate_request_id(),
            "method": "ping"
        });

        let transport = self.transport.lock().await;
        let response = transport.send_request(request).await?;

        response.get("result")
            .cloned()
            .ok_or(McpError::Protocol("Invalid ping response".to_string()))
    }

    /// Close MCP connection
    pub async fn close(&self) -> Result<()> {
        let mut transport = self.transport.lock().await;
        transport.close().await
    }

    /// Check if connected
    pub fn is_connected(&self) -> bool {
        if let Ok(transport) = self.transport.try_lock() {
            transport.is_connected()
        } else {
            false
        }
    }

    /// Get server name
    pub fn server_name(&self) -> &str {
        &self.config.server_name
    }

    /// Get capabilities
    pub async fn get_capabilities(&self) -> Option<ServerCapabilities> {
        self.capabilities.read().await.clone()
    }

    /// Generate a unique request ID
    fn generate_request_id(&self) -> i64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_config_validation() {
        let config = McpServerConfig {
            server_name: "test".to_string(),
            transport_type: TransportType::Stdio,
            command: Some(vec!["echo".to_string()]),
            url: None,
            env: None,
            headers: None,
            enabled: true,
            timeout_ms: 30000,
        };

        assert_eq!(config.server_name, "test");
        assert_eq!(config.transport_type, TransportType::Stdio);
    }

    #[tokio::test]
    async fn test_config_missing_command() {
        let config = McpServerConfig {
            server_name: "test".to_string(),
            transport_type: TransportType::Stdio,
            command: None,
            url: None,
            env: None,
            headers: None,
            enabled: true,
            timeout_ms: 30000,
        };

        let result = McpClient::new(config).await;
        assert!(result.is_err());
    }
}
