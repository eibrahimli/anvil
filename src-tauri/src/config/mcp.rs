use crate::config::ConfigManager;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// MCP server configuration from anvil.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfigFile {
    #[serde(rename = "type")]
    pub transport_type: String,
    pub command: Option<Vec<String>>,
    pub url: Option<String>,
    pub environment: Option<HashMap<String, String>>,
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "30000")]
    pub timeout: u64,
}

/// MCP configuration from anvil.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfigFile {
    pub servers: HashMap<String, McpServerConfigFile>,
}

/// Parsed MCP configuration ready for use
#[derive(Debug, Clone)]
pub struct McpConfig {
    pub servers: Vec<McpServerConfigParsed>,
}

#[derive(Debug, Clone)]
pub struct McpServerConfigParsed {
    pub name: String,
    pub transport_type: crate::mcp::TransportType,
    pub command: Option<Vec<String>>,
    pub url: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub headers: Option<HashMap<String, String>>,
    pub enabled: bool,
    pub timeout_ms: u64,
}

impl McpConfigFile {
    /// Load MCP config from anvil.json value
    pub fn from_anvil_json(mcp_value: &Value) -> Option<Self> {
        mcp_value.get("servers").and_then(|_| {
            // We'll parse the whole object
            serde_json::from_value::<McpConfigFile>(mcp_value.clone()).ok()
        })
    }

    /// Convert to parsed config with resolved environment variables
    pub fn to_parsed(&self) -> McpConfig {
        let mut servers = Vec::new();

        for (name, server_config) in &self.servers {
            let transport_type = match server_config.transport_type.as_str() {
                "local" => crate::mcp::TransportType::Stdio,
                "remote" => crate::mcp::TransportType::Http,
                _ => continue, // Skip invalid transport types
            };

            let env = server_config.environment.as_ref().map(|env_map| {
                let mut resolved = HashMap::new();
                for (key, value) in env_map {
                    resolved.insert(key.clone(), resolve_env_var(value));
                }
                resolved
            });

            let headers = server_config.headers.as_ref().map(|headers_map| {
                let mut resolved = HashMap::new();
                for (key, value) in headers_map {
                    resolved.insert(key.clone(), resolve_env_var(value));
                }
                resolved
            });

            servers.push(McpServerConfigParsed {
                name: name.clone(),
                transport_type,
                command: server_config.command.clone(),
                url: server_config.url.clone(),
                env,
                headers,
                enabled: server_config.enabled,
                timeout_ms: server_config.timeout,
            });
        }

        McpConfig { servers }
    }
}

/// Resolve environment variable placeholders like {env:VAR_NAME}
fn resolve_env_var(value: &str) -> String {
    if value.starts_with("{env:") && value.ends_with('}') {
        let var_name = &value[5..value.len() - 1];
        std::env::var(var_name).unwrap_or_else(|_| value.to_string())
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_env_var_resolution() {
        std::env::set_var("TEST_VAR", "resolved_value");

        let result = resolve_env_var("{env:TEST_VAR}");
        assert_eq!(result, "resolved_value");

        let result2 = resolve_env_var("plain_value");
        assert_eq!(result2, "plain_value");

        let result3 = resolve_env_var("{env:NONEXISTENT}");
        assert_eq!(result3, "{env:NONEXISTENT}");
    }

    #[test]
    fn test_mcp_config_parsing() {
        let json_str = r#"{
            "servers": {
                "github": {
                    "type": "local",
                    "command": ["npx", "-y", "@modelcontextprotocol/server-git"],
                    "environment": {
                        "GITHUB_TOKEN": "{env:GITHUB_TOKEN}"
                    },
                    "enabled": true,
                    "timeout": 30000
                }
            }
        }"#;

        let value: Value = serde_json::from_str(json_str).unwrap();
        let config = McpConfigFile::from_anvil_json(&value);

        assert!(config.is_some());
        let config = config.unwrap();
        assert_eq!(config.servers.len(), 1);

        let parsed = config.to_parsed();
        assert_eq!(parsed.servers.len(), 1);
        assert_eq!(parsed.servers[0].name, "github");
        assert_eq!(parsed.servers[0].enabled, true);
    }

    #[test]
    fn test_http_transport_type() {
        let json_str = r#"{
            "servers": {
                "remote": {
                    "type": "remote",
                    "url": "https://example.com/mcp",
                    "enabled": true
                }
            }
        }"#;

        let value: Value = serde_json::from_str(json_str).unwrap();
        let config = McpConfigFile::from_anvil_json(&value).unwrap();
        let parsed = config.to_parsed();

        assert_eq!(
            parsed.servers[0].transport_type,
            crate::mcp::TransportType::Http
        );
    }
}
