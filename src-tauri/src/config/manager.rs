use serde::de::{self, Deserializer};
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRule {
    pub pattern: String,
    pub action: Action,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ToolPermission {
    #[serde(default)]
    pub default: Action,
    #[serde(default)]
    pub rules: Vec<PermissionRule>,
}

impl ToolPermission {
    fn from_json_value(value: serde_json::Value) -> Result<Self, String> {
        match value {
            serde_json::Value::String(_) => {
                let action: Action = serde_json::from_value(value)
                    .map_err(|e| format!("Invalid permission action: {}", e))?;
                Ok(Self {
                    default: action,
                    rules: Vec::new(),
                })
            }
            serde_json::Value::Object(map) => {
                if map.contains_key("default") || map.contains_key("rules") {
                    let default = map
                        .get("default")
                        .map(|v| serde_json::from_value::<Action>(v.clone()))
                        .transpose()
                        .map_err(|e| format!("Invalid permission default: {}", e))?
                        .unwrap_or(Action::Ask);

                    let rules = match map.get("rules") {
                        Some(serde_json::Value::Array(items)) => items
                            .iter()
                            .map(|item| {
                                serde_json::from_value::<PermissionRule>(item.clone())
                                    .map_err(|e| format!("Invalid permission rule: {}", e))
                            })
                            .collect::<Result<Vec<_>, _>>()?,
                        Some(_) => return Err("Invalid permission rules format".to_string()),
                        None => Vec::new(),
                    };

                    return Ok(Self { default, rules });
                }

                let mut default = Action::Ask;
                let mut rules = Vec::new();
                for (key, val) in map {
                    let action: Action = serde_json::from_value(val)
                        .map_err(|e| format!("Invalid permission action: {}", e))?;
                    if key == "*" {
                        default = action;
                    } else {
                        rules.push(PermissionRule {
                            pattern: key,
                            action,
                        });
                    }
                }

                Ok(Self { default, rules })
            }
            _ => Err("Invalid permission format".to_string()),
        }
    }
}

impl<'de> Deserialize<'de> for ToolPermission {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        Self::from_json_value(value).map_err(de::Error::custom)
    }
}

impl ToolPermission {
    /// Evaluate permission for a given input string (command or path)
    pub fn evaluate(&self, input: &str) -> Action {
        let mut matched_action = self.default.clone();

        for rule in &self.rules {
            if rule.pattern.trim().is_empty() {
                continue;
            }
            if let Ok(pattern) = glob::Pattern::new(&rule.pattern) {
                if pattern.matches(input) {
                    matched_action = rule.action.clone();
                }
            }
        }

        matched_action
    }
}

/// Permission configuration
#[derive(Debug, Clone, Serialize)]
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
    pub skill: ToolPermission,
    #[serde(default)]
    pub list: ToolPermission,
    #[serde(default)]
    pub glob: ToolPermission,
    #[serde(default)]
    pub grep: ToolPermission,
    #[serde(default)]
    pub webfetch: ToolPermission,
    #[serde(default)]
    pub task: ToolPermission,
    #[serde(default)]
    pub lsp: ToolPermission,
    #[serde(default)]
    pub todoread: ToolPermission,
    #[serde(default)]
    pub todowrite: ToolPermission,
    #[serde(default)]
    pub doom_loop: ToolPermission,
    #[serde(default)]
    pub external_directory: Option<HashMap<String, Action>>,
}

impl Default for PermissionConfig {
    fn default() -> Self {
        let allow = ToolPermission {
            default: Action::Allow,
            rules: Vec::new(),
        };

        Self {
            bash: allow.clone(),
            edit: allow.clone(),
            read: ToolPermission {
                default: Action::Allow,
                rules: default_read_rules(),
            },
            write: allow.clone(),
            skill: allow.clone(),
            list: allow.clone(),
            glob: allow.clone(),
            grep: allow.clone(),
            webfetch: allow.clone(),
            task: allow.clone(),
            lsp: allow.clone(),
            todoread: allow.clone(),
            todowrite: allow.clone(),
            doom_loop: ToolPermission {
                default: Action::Ask,
                rules: Vec::new(),
            },
            external_directory: None,
        }
    }
}

impl PermissionConfig {
    fn from_json_value(value: serde_json::Value) -> Result<Self, String> {
        match value {
            serde_json::Value::String(_) => {
                let action: Action = serde_json::from_value(value)
                    .map_err(|e| format!("Invalid permission action: {}", e))?;
                let mut config = PermissionConfig::default();
                config.apply_global_default(action, &[]);
                config.ensure_default_read_rules();
                Ok(config)
            }
            serde_json::Value::Object(map) => {
                let mut config = PermissionConfig::default();
                let mut global_default: Option<Action> = None;
                let mut explicit_tools: Vec<String> = Vec::new();

                for (key, val) in map {
                    match key.as_str() {
                        "*" => {
                            global_default = Some(
                                serde_json::from_value::<Action>(val)
                                    .map_err(|e| format!("Invalid permission action: {}", e))?,
                            );
                        }
                        "external_directory" => {
                            let rules: HashMap<String, Action> = serde_json::from_value(val)
                                .map_err(|e| format!("Invalid external_directory rules: {}", e))?;
                            config.external_directory = Some(rules);
                        }
                        "bash" => {
                            config.bash = ToolPermission::from_json_value(val)?;
                            explicit_tools.push("bash".to_string());
                        }
                        "edit" => {
                            config.edit = ToolPermission::from_json_value(val)?;
                            explicit_tools.push("edit".to_string());
                        }
                        "read" => {
                            config.read = ToolPermission::from_json_value(val)?;
                            explicit_tools.push("read".to_string());
                        }
                        "write" => {
                            config.write = ToolPermission::from_json_value(val)?;
                            explicit_tools.push("write".to_string());
                        }
                        "skill" => {
                            config.skill = ToolPermission::from_json_value(val)?;
                            explicit_tools.push("skill".to_string());
                        }
                        "list" => {
                            config.list = ToolPermission::from_json_value(val)?;
                            explicit_tools.push("list".to_string());
                        }
                        "glob" => {
                            config.glob = ToolPermission::from_json_value(val)?;
                            explicit_tools.push("glob".to_string());
                        }
                        "grep" => {
                            config.grep = ToolPermission::from_json_value(val)?;
                            explicit_tools.push("grep".to_string());
                        }
                        "webfetch" => {
                            config.webfetch = ToolPermission::from_json_value(val)?;
                            explicit_tools.push("webfetch".to_string());
                        }
                        "task" => {
                            config.task = ToolPermission::from_json_value(val)?;
                            explicit_tools.push("task".to_string());
                        }
                        "lsp" => {
                            config.lsp = ToolPermission::from_json_value(val)?;
                            explicit_tools.push("lsp".to_string());
                        }
                        "todoread" => {
                            config.todoread = ToolPermission::from_json_value(val)?;
                            explicit_tools.push("todoread".to_string());
                        }
                        "todowrite" => {
                            config.todowrite = ToolPermission::from_json_value(val)?;
                            explicit_tools.push("todowrite".to_string());
                        }
                        "doom_loop" => {
                            config.doom_loop = ToolPermission::from_json_value(val)?;
                            explicit_tools.push("doom_loop".to_string());
                        }
                        _ => {}
                    }
                }

                if let Some(action) = global_default {
                    config.apply_global_default(action, &explicit_tools);
                }

                config.ensure_default_read_rules();
                Ok(config)
            }
            _ => Err("Invalid permission format".to_string()),
        }
    }

    fn apply_global_default(&mut self, action: Action, explicit_tools: &[String]) {
        let is_explicit = |tool: &str| explicit_tools.iter().any(|t| t == tool);
        if !is_explicit("bash") {
            self.bash.default = action.clone();
        }
        if !is_explicit("edit") {
            self.edit.default = action.clone();
        }
        if !is_explicit("read") {
            self.read.default = action.clone();
        }
        if !is_explicit("write") {
            self.write.default = action.clone();
        }
        if !is_explicit("skill") {
            self.skill.default = action.clone();
        }
        if !is_explicit("list") {
            self.list.default = action.clone();
        }
        if !is_explicit("glob") {
            self.glob.default = action.clone();
        }
        if !is_explicit("grep") {
            self.grep.default = action.clone();
        }
        if !is_explicit("webfetch") {
            self.webfetch.default = action.clone();
        }
        if !is_explicit("task") {
            self.task.default = action.clone();
        }
        if !is_explicit("lsp") {
            self.lsp.default = action.clone();
        }
        if !is_explicit("todoread") {
            self.todoread.default = action.clone();
        }
        if !is_explicit("todowrite") {
            self.todowrite.default = action.clone();
        }
        if !is_explicit("doom_loop") {
            self.doom_loop.default = action;
        }
    }

    fn ensure_default_read_rules(&mut self) {
        if !self.read.rules.is_empty() {
            return;
        }

        self.read.rules = default_read_rules();
    }
}

impl<'de> Deserialize<'de> for PermissionConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        Self::from_json_value(value).map_err(de::Error::custom)
    }
}

impl PermissionConfig {
    /// Check if a path is allowed to be accessed
    pub fn check_path_access(&self, path: &Path, workspace_root: &Path) -> Action {
        // Resolve paths to handle .. and symlinks
        let resolved_path = fs::canonicalize(path).unwrap_or_else(|_| {
            // Simple normalization if file doesn't exist
            let mut ret = PathBuf::new();
            for component in path.components() {
                match component {
                    std::path::Component::CurDir => {}
                    std::path::Component::ParentDir => {
                        ret.pop();
                    }
                    _ => ret.push(component),
                }
            }
            ret
        });

        let resolved_root =
            fs::canonicalize(workspace_root).unwrap_or_else(|_| workspace_root.to_path_buf());

        // 1. Check if inside workspace (Allow by default)
        if resolved_path.starts_with(&resolved_root) {
            return Action::Allow;
        }

        // 2. Check external directory rules
        if let Some(ref rules) = self.external_directory {
            let path_str = resolved_path.to_string_lossy();
            let mut explicit_allow = false;
            let mut explicit_ask = false;

            for (pattern, action) in rules {
                // Handle home expansion in pattern
                let expanded_pattern = if pattern.starts_with("~") {
                    if let Some(home) = dirs::home_dir() {
                        pattern.replacen("~", &home.to_string_lossy(), 1)
                    } else {
                        pattern.clone()
                    }
                } else {
                    pattern.clone()
                };

                if let Ok(glob_pattern) = glob::Pattern::new(&expanded_pattern) {
                    if glob_pattern.matches(&path_str) {
                        match action {
                            Action::Deny => return Action::Deny,
                            Action::Allow => explicit_allow = true,
                            Action::Ask => explicit_ask = true,
                        }
                    }
                }
            }

            if explicit_allow {
                return Action::Allow;
            }
            if explicit_ask {
                return Action::Ask;
            }
            return Action::Ask;
        }

        Action::Ask
    }
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

/// MCP tool filtering configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolFilter {
    /// List of tool names to include (if empty, all tools are included)
    #[serde(default)]
    pub include: Vec<String>,
    /// List of tool names to exclude (takes precedence over include)
    #[serde(default)]
    pub exclude: Vec<String>,
    /// Default behavior for tools not in include/exclude lists
    #[serde(default = "default_tool_filter_default")]
    pub default: bool,
}

fn default_tool_filter_default() -> bool {
    true
}

impl Default for McpToolFilter {
    fn default() -> Self {
        Self {
            include: Vec::new(),
            exclude: Vec::new(),
            default: true,
        }
    }
}

impl McpToolFilter {
    /// Check if a tool is enabled based on the filter rules
    pub fn is_tool_enabled(&self, tool_name: &str) -> bool {
        // Exclude takes precedence
        if self.exclude.contains(&tool_name.to_string()) {
            return false;
        }

        // If include list is not empty, tool must be in it
        if !self.include.is_empty() {
            return self.include.contains(&tool_name.to_string());
        }

        // Default behavior
        self.default
    }
}

/// MCP (Model Context Protocol) configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpConfig {
    pub enabled: Option<bool>,
    pub servers: Option<serde_json::Value>,
    /// Tool filtering configuration per server (server_name -> tool_filter)
    #[serde(default)]
    pub tool_filters: HashMap<String, McpToolFilter>,
    /// Per-agent MCP overrides (agent_name -> McpConfig)
    #[serde(default)]
    pub agent_overrides: HashMap<String, Box<McpConfig>>,
}

impl McpConfig {
    /// Get effective MCP config for a specific agent
    pub fn for_agent(&self, agent_name: &str) -> &Self {
        self.agent_overrides
            .get(agent_name)
            .map(|boxed| boxed.as_ref())
            .unwrap_or(self)
    }

    /// Get tool filter for a specific server
    pub fn get_tool_filter(&self, server_name: &str) -> &McpToolFilter {
        self.tool_filters
            .get(server_name)
            .unwrap_or(&DEFAULT_TOOL_FILTER)
    }
}

use once_cell::sync::Lazy;

static DEFAULT_TOOL_FILTER: Lazy<McpToolFilter> = Lazy::new(McpToolFilter::default);

/// Individual MCP server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    #[serde(rename = "type")]
    pub transport_type: String,
    pub command: Option<Vec<String>>,
    pub url: Option<String>,
    pub environment: Option<std::collections::HashMap<String, String>>,
    pub headers: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

fn default_timeout() -> u64 {
    30000
}

/// Resolved MCP server configuration with actual transport type
#[derive(Debug, Clone)]
pub struct ResolvedMcpServer {
    pub name: String,
    pub transport_type: crate::mcp::TransportType,
    pub command: Option<Vec<String>>,
    pub url: Option<String>,
    pub env: Option<std::collections::HashMap<String, String>>,
    pub headers: Option<std::collections::HashMap<String, String>>,
    pub enabled: bool,
    pub timeout_ms: u64,
}

impl McpConfig {
    /// Parse MCP servers from config value
    pub fn get_servers(&self) -> Vec<ResolvedMcpServer> {
        let mut servers = Vec::new();

        if let Some(servers_value) = &self.servers {
            if let Some(servers_obj) = servers_value.as_object() {
                for (name, server_config_value) in servers_obj {
                    if let Ok(server_config) =
                        serde_json::from_value::<McpServerConfig>(server_config_value.clone())
                    {
                        let transport_type = match server_config.transport_type.as_str() {
                            "local" => crate::mcp::TransportType::Stdio,
                            "remote" => crate::mcp::TransportType::Http,
                            _ => continue, // Skip invalid transport types
                        };

                        let env = server_config.environment.as_ref().map(|env_map| {
                            let mut resolved = std::collections::HashMap::new();
                            for (key, value) in env_map {
                                resolved.insert(key.clone(), resolve_env_var(value));
                            }
                            resolved
                        });

                        let headers = server_config.headers.as_ref().map(|headers_map| {
                            let mut resolved = std::collections::HashMap::new();
                            for (key, value) in headers_map {
                                resolved.insert(key.clone(), resolve_env_var(value));
                            }
                            resolved
                        });

                        servers.push(ResolvedMcpServer {
                            name: name.clone(),
                            transport_type,
                            command: server_config.command,
                            url: server_config.url,
                            env,
                            headers,
                            enabled: server_config.enabled,
                            timeout_ms: server_config.timeout,
                        });
                    }
                }
            }
        }

        servers
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

            // Permissions are global only (ignore local overrides)

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

            // Merge MCP config (local takes precedence but merges deeply)
            if local.mcp.is_some() {
                merged.mcp = Self::merge_mcp_config(&merged.mcp, &local.mcp);
            }
        }

        // Set defaults for missing values
        if merged.model.is_none() {
            merged.model = Some(DEFAULT_MODEL.to_string());
        }

        merged
    }

    /// Merge two MCP configurations (local takes precedence)
    fn merge_mcp_config(
        global: &Option<McpConfig>,
        local: &Option<McpConfig>,
    ) -> Option<McpConfig> {
        if local.is_none() {
            return global.clone();
        }

        if global.is_none() {
            return local.clone();
        }

        let global = global.as_ref().unwrap();
        let local = local.as_ref().unwrap();

        // Merge tool_filters: local overrides per-server
        let mut merged_tool_filters = global.tool_filters.clone();
        for (key, value) in &local.tool_filters {
            merged_tool_filters.insert(key.clone(), value.clone());
        }

        // Merge agent_overrides: local overrides per-agent
        let mut merged_agent_overrides = global.agent_overrides.clone();
        for (key, value) in &local.agent_overrides {
            merged_agent_overrides.insert(key.clone(), value.clone());
        }

        Some(McpConfig {
            enabled: local.enabled.or(global.enabled),
            servers: local.servers.clone().or_else(|| global.servers.clone()),
            tool_filters: merged_tool_filters,
            agent_overrides: merged_agent_overrides,
        })
    }

    /// Merge two permission configurations
    #[allow(dead_code)]
    fn merge_permissions(global: &PermissionConfig, local: &PermissionConfig) -> PermissionConfig {
        PermissionConfig {
            bash: Self::merge_tool_permissions(&global.bash, &local.bash),
            edit: Self::merge_tool_permissions(&global.edit, &local.edit),
            read: Self::merge_tool_permissions(&global.read, &local.read),
            write: Self::merge_tool_permissions(&global.write, &local.write),
            skill: Self::merge_tool_permissions(&global.skill, &local.skill),
            list: Self::merge_tool_permissions(&global.list, &local.list),
            glob: Self::merge_tool_permissions(&global.glob, &local.glob),
            grep: Self::merge_tool_permissions(&global.grep, &local.grep),
            webfetch: Self::merge_tool_permissions(&global.webfetch, &local.webfetch),
            task: Self::merge_tool_permissions(&global.task, &local.task),
            lsp: Self::merge_tool_permissions(&global.lsp, &local.lsp),
            todoread: Self::merge_tool_permissions(&global.todoread, &local.todoread),
            todowrite: Self::merge_tool_permissions(&global.todowrite, &local.todowrite),
            doom_loop: Self::merge_tool_permissions(&global.doom_loop, &local.doom_loop),
            external_directory: local
                .external_directory
                .clone()
                .or_else(|| global.external_directory.clone()),
        }
    }

    /// Merge two tool permission configurations
    #[allow(dead_code)]
    fn merge_tool_permissions(global: &ToolPermission, local: &ToolPermission) -> ToolPermission {
        let mut merged_rules = global.rules.clone();
        // Local rules are appended to global rules (so they have higher priority in last-match-wins)
        merged_rules.extend(local.rules.clone());

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

        // Default permissions (OpenCode-style): most are allow
        config.permission.read = ToolPermission {
            default: Action::Allow,
            rules: default_read_rules(),
        };

        config.permission.write.default = Action::Allow;
        config.permission.edit.default = Action::Allow;
        config.permission.bash.default = Action::Allow;
        config.permission.skill.default = Action::Allow;
        config.permission.list.default = Action::Allow;
        config.permission.glob.default = Action::Allow;
        config.permission.grep.default = Action::Allow;
        config.permission.webfetch.default = Action::Allow;
        config.permission.task.default = Action::Allow;
        config.permission.lsp.default = Action::Allow;
        config.permission.todoread.default = Action::Allow;
        config.permission.todowrite.default = Action::Allow;

        // Doom loop guard defaults to ask
        config.permission.doom_loop.default = Action::Ask;

        config
    }
}

fn default_read_rules() -> Vec<PermissionRule> {
    vec![
        PermissionRule {
            pattern: ".env".to_string(),
            action: Action::Deny,
        },
        PermissionRule {
            pattern: ".env.*".to_string(),
            action: Action::Deny,
        },
        PermissionRule {
            pattern: "*.env".to_string(),
            action: Action::Deny,
        },
        // Exceptions
        PermissionRule {
            pattern: ".env.example".to_string(),
            action: Action::Allow,
        },
        PermissionRule {
            pattern: "*.env.example".to_string(),
            action: Action::Allow,
        },
    ]
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
                    "rules": [
                        { "pattern": "git status *", "action": "allow" }
                    ]
                }
            }
        }"#;

        let config: Config = serde_json::from_str(json).unwrap();
        assert_eq!(config.model, Some("gpt-4".to_string()));
        assert!(config.provider.contains_key("openai"));
        assert_eq!(config.permission.bash.default, Action::Ask);
        assert_eq!(config.permission.bash.rules[0].pattern, "git status *");
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
                rules: vec![PermissionRule {
                    pattern: "git status *".to_string(),
                    action: Action::Allow,
                }],
            },
            ..Default::default()
        };

        let local_perm = PermissionConfig {
            bash: ToolPermission {
                default: Action::Deny,
                rules: vec![PermissionRule {
                    pattern: "git push *".to_string(),
                    action: Action::Ask,
                }],
            },
            ..Default::default()
        };

        let merged = ConfigManager::merge_permissions(&global_perm, &local_perm);

        // Local default should win
        assert_eq!(merged.bash.default, Action::Deny);
        // Both rules should be present
        assert_eq!(merged.bash.rules.len(), 2);
        assert_eq!(merged.bash.rules[0].pattern, "git status *");
        assert_eq!(merged.bash.rules[1].pattern, "git push *");
    }

    #[test]
    fn test_permission_evaluate() {
        let tp = ToolPermission {
            default: Action::Ask,
            rules: vec![
                PermissionRule {
                    pattern: "git status*".to_string(),
                    action: Action::Allow,
                },
                PermissionRule {
                    pattern: "rm -rf*".to_string(),
                    action: Action::Deny,
                },
            ],
        };

        assert_eq!(tp.evaluate("git status"), Action::Allow);
        assert_eq!(tp.evaluate("git status -s"), Action::Allow);
        assert_eq!(tp.evaluate("rm -rf /"), Action::Deny);
        assert_eq!(tp.evaluate("ls -la"), Action::Ask); // Default
    }

    #[test]
    fn test_default_global_config() {
        let config = ConfigManager::create_default_global_config();

        assert_eq!(config.model, Some(DEFAULT_MODEL.to_string()));
        assert_eq!(config.permission.read.evaluate(".env"), Action::Deny);
        assert_eq!(config.permission.read.evaluate(".env.local"), Action::Deny);
        assert_eq!(config.permission.read.evaluate("secret.env"), Action::Deny);

        assert_eq!(
            config.permission.read.evaluate(".env.example"),
            Action::Allow
        );
        assert_eq!(
            config.permission.read.evaluate("config.env.example"),
            Action::Allow
        );

        assert_eq!(config.permission.read.evaluate("README.md"), Action::Allow);
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

    #[test]
    fn test_mcp_tool_filter_include_exclude() {
        let filter = McpToolFilter {
            include: vec!["tool1".to_string(), "tool2".to_string()],
            exclude: vec!["tool2".to_string()], // exclude takes precedence
            default: true,
        };

        // Included tool
        assert!(filter.is_tool_enabled("tool1"));
        // Excluded tool (takes precedence over include)
        assert!(!filter.is_tool_enabled("tool2"));
        // Not in include list, but default is true
        assert!(!filter.is_tool_enabled("tool3"));

        let filter2 = McpToolFilter {
            include: vec![],
            exclude: vec!["bad_tool".to_string()],
            default: true,
        };

        // Default is true, not excluded
        assert!(filter2.is_tool_enabled("any_tool"));
        // Excluded
        assert!(!filter2.is_tool_enabled("bad_tool"));
    }

    #[test]
    fn test_mcp_config_for_agent() {
        let mut agent_overrides = HashMap::new();
        let agent_config = McpConfig {
            enabled: Some(false),
            servers: None,
            tool_filters: HashMap::new(),
            agent_overrides: HashMap::new(),
        };
        agent_overrides.insert("special_agent".to_string(), Box::new(agent_config));

        let global_config = McpConfig {
            enabled: Some(true),
            servers: Some(serde_json::json!({})),
            tool_filters: HashMap::new(),
            agent_overrides,
        };

        // Regular agent uses global config
        let effective = global_config.for_agent("default_agent");
        assert_eq!(effective.enabled, Some(true));

        // Special agent uses override
        let effective = global_config.for_agent("special_agent");
        assert_eq!(effective.enabled, Some(false));
    }

    #[test]
    fn test_mcp_config_get_tool_filter() {
        let mut tool_filters = HashMap::new();
        tool_filters.insert(
            "github".to_string(),
            McpToolFilter {
                include: vec!["create_issue".to_string()],
                exclude: vec![],
                default: false,
            },
        );

        let config = McpConfig {
            enabled: Some(true),
            servers: None,
            tool_filters,
            agent_overrides: HashMap::new(),
        };

        // Get filter for configured server
        let github_filter = config.get_tool_filter("github");
        assert!(github_filter.is_tool_enabled("create_issue"));
        assert!(!github_filter.is_tool_enabled("delete_repo"));

        // Get filter for unconfigured server (returns default)
        let default_filter = config.get_tool_filter("unknown");
        // Default filter should have default=true, empty include/exclude
        assert!(default_filter.default);
        assert!(default_filter.is_tool_enabled("any_tool"));
    }

    #[test]
    fn test_merge_mcp_config() {
        let global = Some(McpConfig {
            enabled: Some(true),
            servers: Some(serde_json::json!({"server1": {}})),
            tool_filters: {
                let mut map = HashMap::new();
                map.insert(
                    "server1".to_string(),
                    McpToolFilter {
                        include: vec!["tool1".to_string()],
                        exclude: vec![],
                        default: true,
                    },
                );
                map
            },
            agent_overrides: {
                let mut map = HashMap::new();
                map.insert(
                    "agent1".to_string(),
                    Box::new(McpConfig {
                        enabled: Some(false),
                        servers: None,
                        tool_filters: HashMap::new(),
                        agent_overrides: HashMap::new(),
                    }),
                );
                map
            },
        });

        let local = Some(McpConfig {
            enabled: Some(false),                              // Override global
            servers: Some(serde_json::json!({"server2": {}})), // Override global
            tool_filters: {
                let mut map = HashMap::new();
                map.insert(
                    "server2".to_string(), // New server filter
                    McpToolFilter {
                        include: vec!["tool2".to_string()],
                        exclude: vec![],
                        default: true,
                    },
                );
                map
            },
            agent_overrides: {
                let mut map = HashMap::new();
                map.insert(
                    "agent2".to_string(), // New agent override
                    Box::new(McpConfig {
                        enabled: Some(true),
                        servers: None,
                        tool_filters: HashMap::new(),
                        agent_overrides: HashMap::new(),
                    }),
                );
                map
            },
        });

        let merged = ConfigManager::merge_mcp_config(&global, &local).unwrap();

        // Local enabled overrides global
        assert_eq!(merged.enabled, Some(false));
        // Local servers override global (not merged)
        assert!(merged.servers.as_ref().unwrap().get("server2").is_some());
        // Both tool filters should be present
        assert!(merged.tool_filters.contains_key("server1"));
        assert!(merged.tool_filters.contains_key("server2"));
        // Both agent overrides should be present
        assert!(merged.agent_overrides.contains_key("agent1"));
        assert!(merged.agent_overrides.contains_key("agent2"));
    }

    #[test]
    fn test_mcp_config_json_parsing() {
        let json_str = r#"{
            "enabled": true,
            "servers": {
                "github": {
                    "type": "local",
                    "command": ["npx", "-y", "@modelcontextprotocol/server-git"],
                    "enabled": true,
                    "timeout": 30000
                }
            },
            "tool_filters": {
                "github": {
                    "include": ["create_issue", "list_repos"],
                    "exclude": ["delete_repo"],
                    "default": false
                }
            },
            "agent_overrides": {
                "readonly_agent": {
                    "enabled": false
                }
            }
        }"#;

        let mcp_config: McpConfig = serde_json::from_str(json_str).unwrap();

        assert_eq!(mcp_config.enabled, Some(true));
        assert!(mcp_config.servers.is_some());
        assert_eq!(mcp_config.tool_filters.len(), 1);
        assert_eq!(mcp_config.agent_overrides.len(), 1);

        let github_filter = mcp_config.tool_filters.get("github").unwrap();
        assert_eq!(github_filter.include.len(), 2);
        assert_eq!(github_filter.exclude.len(), 1);
        assert!(!github_filter.default);
    }
}
