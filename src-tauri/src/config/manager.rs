use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Default model to use
pub const DEFAULT_MODEL: &str = "gpt-4";

/// Provider configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderConfig {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub timeout: Option<u64>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Permission action types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Allow,
    Ask,
    Deny,
}

impl Default for Action {
    fn default() -> Self {
        Action::Ask
    }
}

/// Permission configuration for a specific tool
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolPermission {
    #[serde(default)]
    pub default: Action,
    #[serde(default)]
    pub rules: HashMap<String, Action>,
}

/// Permission configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PermissionConfig {
    #[serde(default)]
    pub bash: ToolPermission,
    #[serde(default)]
    pub edit: ToolPermission,
    #[serde(default)]
    pub read: ToolPermission,
    #[serde(default)]
    pub write: ToolPermission,
    #[serde(default)]
    pub external_directory: Option<HashMap<String, Action>>,
}

/// Agent configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentConfig {
    pub model: Option<String>,
    pub provider: Option<String>,
    #[serde(default)]
    pub instructions: Vec<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// LSP configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LspConfig {
    pub enabled: Option<bool>,
    pub servers: Option<Vec<String>>,
}

/// MCP (Model Context Protocol) configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpConfig {
    pub enabled: Option<bool>,
    pub servers: Option<Vec<String>>,
}

/// Main configuration structure
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    /// Default model for the agent
    pub model: Option<String>,

    /// Provider configurations
    #[serde(default)]
    pub provider: HashMap<String, ProviderConfig>,

    /// Permission settings
    #[serde(default)]
    pub permission: PermissionConfig,

    /// External instruction/rule files
    #[serde(default)]
    pub instructions: Vec<String>,

    /// Agent-specific configurations
    #[serde(default)]
    pub agent: HashMap<String, AgentConfig>,

    /// LSP configuration
    pub lsp: Option<LspConfig>,

    /// MCP configuration
    pub mcp: Option<McpConfig>,
}

/// Configuration manager that handles loading and merging configs
pub struct ConfigManager {
    global_config: Option<Config>,
    local_config: Option<Config>,
    merged_config: Config,
}

impl ConfigManager {
    /// Create a new ConfigManager
    pub fn new() -> Self {
        Self {
            global_config: None,
            local_config: None,
            merged_config: Config::default(),
        }
    }

    /// Load configuration from both global and local sources
    pub fn load(&mut self, workspace_path: Option<&Path>) -> Result<(), ConfigError> {
        // Load global config
        self.global_config = self.load_global_config()?;

        // Load local config
        self.local_config = if let Some(path) = workspace_path {
            self.load_local_config(path)?
        } else {
            None
        };

        // Merge configs (local overrides global)
        self.merged_config = self.merge_configs();

        Ok(())
    }

    /// Get the merged configuration
    pub fn config(&self) -> &Config {
        &self.merged_config
    }

    /// Get global config path (~/.config/anvil/anvil.json)
    fn global_config_path() -> Option<PathBuf> {
        dirs::config_dir().map(|dir| dir.join("anvil").join("anvil.json"))
    }

    /// Get local config path (.anvil/anvil.json)
    fn local_config_path(workspace: &Path) -> PathBuf {
        workspace.join(".anvil").join("anvil.json")
    }

    /// Load global configuration
    fn load_global_config(&self) -> Result<Option<Config>, ConfigError> {
        if let Some(path) = Self::global_config_path() {
            if path.exists() {
                let content =
                    fs::read_to_string(&path).map_err(|e| ConfigError::IoError(e.kind()))?;
                let config: Config = serde_json::from_str(&content)
                    .map_err(|e| ConfigError::ParseError(e.to_string()))?;
                return Ok(Some(config));
            }
        }
        Ok(None)
    }

    /// Load local workspace configuration
    fn load_local_config(&self, workspace: &Path) -> Result<Option<Config>, ConfigError> {
        let path = Self::local_config_path(workspace);
        if path.exists() {
            let content = fs::read_to_string(&path).map_err(|e| ConfigError::IoError(e.kind()))?;
            let config: Config = serde_json::from_str(&content)
                .map_err(|e| ConfigError::ParseError(e.to_string()))?;
            Ok(Some(config))
        } else {
            Ok(None)
        }
    }

    /// Merge global and local configs (local takes precedence)
    fn merge_configs(&self) -> Config {
        let mut merged = Config::default();

        // Start with global config if it exists
        if let Some(ref global) = self.global_config {
            merged = global.clone();
        }

        // Apply local config overrides
        if let Some(ref local) = self.local_config {
            // Override model
            if local.model.is_some() {
                merged.model = local.model.clone();
            }

            // Merge providers (local overrides per-provider)
            for (key, value) in &local.provider {
                merged.provider.insert(key.clone(), value.clone());
            }

            // Merge permissions
            merged.permission = Self::merge_permissions(&merged.permission, &local.permission);

            // Merge instructions (local adds to global)
            let mut combined_instructions = merged.instructions.clone();
            combined_instructions.extend(local.instructions.clone());
            merged.instructions = combined_instructions;

            // Merge agent configs
            for (key, value) in &local.agent {
                merged.agent.insert(key.clone(), value.clone());
            }

            // Override LSP config
            if local.lsp.is_some() {
                merged.lsp = local.lsp.clone();
            }

            // Override MCP config
            if local.mcp.is_some() {
                merged.mcp = local.mcp.clone();
            }
        }

        // Set defaults for missing values
        if merged.model.is_none() {
            merged.model = Some(DEFAULT_MODEL.to_string());
        }

        merged
    }

    /// Merge two permission configurations
    fn merge_permissions(global: &PermissionConfig, local: &PermissionConfig) -> PermissionConfig {
        PermissionConfig {
            bash: Self::merge_tool_permissions(&global.bash, &local.bash),
            edit: Self::merge_tool_permissions(&global.edit, &local.edit),
            read: Self::merge_tool_permissions(&global.read, &local.read),
            write: Self::merge_tool_permissions(&global.write, &local.write),
            external_directory: local
                .external_directory
                .clone()
                .or_else(|| global.external_directory.clone()),
        }
    }

    /// Merge two tool permission configurations
    fn merge_tool_permissions(global: &ToolPermission, local: &ToolPermission) -> ToolPermission {
        let mut merged_rules = global.rules.clone();
        for (key, value) in &local.rules {
            merged_rules.insert(key.clone(), value.clone());
        }

        ToolPermission {
            default: if local.default != Action::Ask {
                local.default.clone()
            } else {
                global.default.clone()
            },
            rules: merged_rules,
        }
    }

    /// Save config to a file
    pub fn save_config(config: &Config, path: &Path) -> Result<(), ConfigError> {
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| ConfigError::IoError(e.kind()))?;
        }

        let json = serde_json::to_string_pretty(config)
            .map_err(|e| ConfigError::ParseError(e.to_string()))?;

        fs::write(path, json).map_err(|e| ConfigError::IoError(e.kind()))?;

        Ok(())
    }

    /// Create default global config with .env protection
    pub fn create_default_global_config() -> Config {
        let mut config = Config::default();

        // Set default model
        config.model = Some(DEFAULT_MODEL.to_string());

        // Set up default read permissions to protect .env files
        let mut read_rules = HashMap::new();
        read_rules.insert("*.env".to_string(), Action::Deny);
        read_rules.insert("*.env.*".to_string(), Action::Deny);
        read_rules.insert("*.env.example".to_string(), Action::Allow);

        config.permission.read = ToolPermission {
            default: Action::Ask,
            rules: read_rules,
        };

        // Default bash permissions: ask for everything
        config.permission.bash = ToolPermission {
            default: Action::Ask,
            rules: HashMap::new(),
        };

        config
    }
}

impl Default for ConfigManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Configuration errors
#[derive(Debug, Clone, PartialEq)]
pub enum ConfigError {
    IoError(std::io::ErrorKind),
    ParseError(String),
    NotFound,
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::IoError(kind) => write!(f, "IO error: {:?}", kind),
            ConfigError::ParseError(msg) => write!(f, "Parse error: {}", msg),
            ConfigError::NotFound => write!(f, "Config file not found"),
        }
    }
}

impl std::error::Error for ConfigError {}

// Add dirs dependency for cross-platform config directory support
use dirs;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert!(config.model.is_none());
        assert!(config.provider.is_empty());
    }

    #[test]
    fn test_config_parse() {
        let json = r#"{
            "model": "gpt-4",
            "provider": {
                "openai": {
                    "api_key": "test-key"
                }
            },
            "permission": {
                "bash": {
                    "default": "ask",
                    "rules": {
                        "git status *": "allow"
                    }
                }
            }
        }"#;

        let config: Config = serde_json::from_str(json).unwrap();
        assert_eq!(config.model, Some("gpt-4".to_string()));
        assert!(config.provider.contains_key("openai"));
        assert_eq!(config.permission.bash.default, Action::Ask);
        assert!(config.permission.bash.rules.contains_key("git status *"));
    }

    #[test]
    fn test_config_save_and_load() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("anvil.json");

        let mut config = Config::default();
        config.model = Some("gpt-4".to_string());

        ConfigManager::save_config(&config, &config_path).unwrap();

        let content = fs::read_to_string(&config_path).unwrap();
        let loaded: Config = serde_json::from_str(&content).unwrap();

        assert_eq!(loaded.model, Some("gpt-4".to_string()));
    }

    #[test]
    fn test_merge_configs() {
        let mut manager = ConfigManager::new();

        // Create global config
        let mut global = Config::default();
        global.model = Some("gpt-3.5".to_string());
        global.provider.insert(
            "openai".to_string(),
            ProviderConfig {
                api_key: Some("global-key".to_string()),
                base_url: None,
                timeout: None,
                extra: HashMap::new(),
            },
        );

        // Create local config
        let mut local = Config::default();
        local.model = Some("gpt-4".to_string());
        local.provider.insert(
            "anthropic".to_string(),
            ProviderConfig {
                api_key: Some("local-key".to_string()),
                base_url: None,
                timeout: None,
                extra: HashMap::new(),
            },
        );

        manager.global_config = Some(global);
        manager.local_config = Some(local);

        let merged = manager.merge_configs();

        // Local should override model
        assert_eq!(merged.model, Some("gpt-4".to_string()));
        // Both providers should be present
        assert!(merged.provider.contains_key("openai"));
        assert!(merged.provider.contains_key("anthropic"));
    }

    #[test]
    fn test_permission_merge() {
        let global_perm = PermissionConfig {
            bash: ToolPermission {
                default: Action::Ask,
                rules: {
                    let mut m = HashMap::new();
                    m.insert("git status *".to_string(), Action::Allow);
                    m
                },
            },
            ..Default::default()
        };

        let local_perm = PermissionConfig {
            bash: ToolPermission {
                default: Action::Deny,
                rules: {
                    let mut m = HashMap::new();
                    m.insert("git push *".to_string(), Action::Ask);
                    m
                },
            },
            ..Default::default()
        };

        let merged = ConfigManager::merge_permissions(&global_perm, &local_perm);

        // Local default should win
        assert_eq!(merged.bash.default, Action::Deny);
        // Both rules should be present
        assert_eq!(merged.bash.rules.get("git status *"), Some(&Action::Allow));
        assert_eq!(merged.bash.rules.get("git push *"), Some(&Action::Ask));
    }

    #[test]
    fn test_default_global_config() {
        let config = ConfigManager::create_default_global_config();

        assert_eq!(config.model, Some(DEFAULT_MODEL.to_string()));
        assert_eq!(
            config.permission.read.rules.get("*.env"),
            Some(&Action::Deny)
        );
        assert_eq!(
            config.permission.read.rules.get("*.env.example"),
            Some(&Action::Allow)
        );
    }

    #[test]
    fn test_load_from_workspace() {
        let temp_dir = TempDir::new().unwrap();
        let anvil_dir = temp_dir.path().join(".anvil");
        fs::create_dir_all(&anvil_dir).unwrap();

        let config_content = r#"{
            "model": "claude-3",
            "provider": {
                "anthropic": {
                    "api_key": "sk-ant-test123"
                }
            }
        }"#;

        let config_path = anvil_dir.join("anvil.json");
        fs::write(&config_path, config_content).unwrap();

        let mut manager = ConfigManager::new();
        manager.load(Some(temp_dir.path())).unwrap();

        let config = manager.config();
        assert_eq!(config.model, Some("claude-3".to_string()));
        assert!(config.provider.contains_key("anthropic"));
    }
}
