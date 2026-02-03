//! MCP Tool Adapter - Wraps MCP tools to work with Anvil's Tool trait

use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use crate::mcp::{McpClient, McpServerConfig, McpTool};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Adapter that wraps an MCP tool to implement Anvil's Tool trait
pub struct McpToolAdapter {
    server_name: String,
    tool_name: String,
    description: String,
    input_schema: Value,
    config: McpServerConfig,
    client: Arc<Mutex<Option<McpClient>>>,
}

impl McpToolAdapter {
    pub fn new(server_name: String, mcp_tool: McpTool, config: McpServerConfig) -> Self {
        Self {
            server_name: server_name.clone(),
            tool_name: mcp_tool.name.clone(),
            description: mcp_tool.description.clone(),
            input_schema: mcp_tool.input_schema.clone(),
            config,
            client: Arc::new(Mutex::new(None)),
        }
    }

    /// Get the full tool name with server prefix
    pub fn full_name(&self) -> String {
        format!("{}_{}", self.server_name, self.tool_name)
    }

    /// Connect to the MCP server
    async fn ensure_connected(&self) -> Result<(), String> {
        let mut client_guard = self.client.lock().await;
        
        if client_guard.is_none() || !client_guard.as_ref().unwrap().is_connected() {
            // Create new connection
            let client = McpClient::new(self.config.clone()).await
                .map_err(|e| format!("Failed to create MCP client: {}", e))?;
            
            client.initialize().await
                .map_err(|e| format!("Failed to initialize MCP: {}", e))?;
            
            *client_guard = Some(client);
        }
        
        Ok(())
    }
}

#[async_trait]
impl Tool for McpToolAdapter {
    fn name(&self) -> &'static str {
        // This is tricky because we need a static string, but our name is dynamic
        // We'll leak the string to make it static (acceptable for tool names that live for the program duration)
        Box::leak(self.full_name().into_boxed_str())
    }

    fn schema(&self) -> Value {
        // Build schema in the format expected by LLMs (OpenAI/Anthropic function calling format)
        // If input_schema is an object with properties, use it directly
        // Otherwise wrap it
        let properties = if self.input_schema.get("properties").is_some() {
            self.input_schema.clone()
        } else {
            json!({
                "type": "object",
                "properties": {}
            })
        };
        
        let cleaned_properties = clean_schema(properties);

        json!({
            "name": self.full_name(),
            "description": format!("{} [MCP Server: {}]", self.description, self.server_name),
            "parameters": cleaned_properties
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        // Connect to MCP server
        self.ensure_connected().await
            .map_err(|e| format!("MCP connection failed: {}", e))?;
        
        let client_guard = self.client.lock().await;
        let client = client_guard.as_ref()
            .ok_or("MCP client not available")?;

        // Call the tool
        let result: Value = client.call_tool(&self.tool_name, input).await
            .map_err(|e| format!("MCP tool call failed: {}", e))?;
        
        Ok(result)
    }
}

// Helper to clean schema for LLM compatibility
fn clean_schema(mut schema: Value) -> Value {
    if let Some(obj) = schema.as_object_mut() {
        // Remove forbidden fields
        obj.remove("$schema");
        obj.remove("additionalProperties");
        obj.remove("title"); // Often not needed and can cause issues
        
        // Recursively clean properties
        if let Some(props) = obj.get_mut("properties") {
            if let Some(props_obj) = props.as_object_mut() {
                for (_, prop) in props_obj.iter_mut() {
                    *prop = clean_schema(prop.clone());
                }
            }
        }
        
        // Recursively clean array items
        if let Some(items) = obj.get_mut("items") {
            *items = clean_schema(items.clone());
        }
    }
    schema
}

/// Load MCP tools from configuration and create adapters
pub async fn load_mcp_tools(
    workspace_path: &std::path::PathBuf,
) -> Result<Vec<Arc<dyn Tool>>, String> {
    use crate::config::ConfigManager;
    
    eprintln!("🔧 Loading MCP tools from: {:?}", workspace_path);
    
    let mut tools: Vec<Arc<dyn Tool>> = vec![];
    
    let mut config_manager = ConfigManager::new();
    let _ = config_manager.load(Some(workspace_path));
    let config = config_manager.config();
    
    eprintln!("🔧 MCP config present: {}", config.mcp.is_some());
    
    if let Some(mcp_config) = &config.mcp {
        eprintln!("🔧 MCP enabled: {:?}", mcp_config.enabled);
        if mcp_config.enabled.unwrap_or(false) {
            let servers = mcp_config.get_servers();
            eprintln!("🔧 Found {} MCP servers", servers.len());
            
            for server in servers {
                eprintln!("🔧 Processing server: {} (enabled: {})", server.name, server.enabled);
                if !server.enabled {
                    continue;
                }
                
                let mcp_client_config = McpServerConfig {
                    server_name: server.name.clone(),
                    transport_type: server.transport_type.clone(),
                    command: server.command.clone(),
                    url: server.url.clone(),
                    env: server.env.clone(),
                    headers: server.headers.clone(),
                    enabled: server.enabled,
                    timeout_ms: server.timeout_ms,
                };
                
                // Connect and get tools
                match McpClient::new(mcp_client_config.clone()).await {
                    Ok(client) => {
                        if let Err(e) = client.initialize().await {
                            eprintln!("⚠️  Failed to initialize MCP server {}: {}", server.name, e);
                            continue;
                        }
                        
                        let mcp_tools = client.get_tools().await;
                        
                        for mcp_tool in mcp_tools {
                            let adapter = McpToolAdapter::new(
                                server.name.clone(),
                                mcp_tool,
                                mcp_client_config.clone(),
                            );
                            tools.push(Arc::new(adapter));
                        }
                        
                        let _ = client.close().await;
                    }
                    Err(e) => {
                        eprintln!("⚠️  Failed to connect to MCP server {}: {}", server.name, e);
                    }
                }
            }
        }
    }
    
    Ok(tools)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::TransportType;

    #[test]
    fn test_mcp_tool_adapter_name() {
        let mcp_tool = McpTool {
            name: "get-sum".to_string(),
            description: "Add two numbers".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "a": {"type": "number"},
                    "b": {"type": "number"}
                }
            }),
        };
        
        let config = McpServerConfig {
            server_name: "everything".to_string(),
            transport_type: TransportType::Stdio,
            command: Some(vec!["echo".to_string()]),
            url: None,
            env: None,
            headers: None,
            enabled: true,
            timeout_ms: 30000,
        };
        
        let adapter = McpToolAdapter::new("everything".to_string(), mcp_tool, config);
        assert_eq!(adapter.full_name(), "everything_get-sum");
    }
}
