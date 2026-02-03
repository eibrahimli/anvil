pub mod manager;
pub mod watcher;
pub mod skills;

pub use manager::{
    Action, AgentConfig, Config, ConfigManager, LspConfig, McpConfig, PermissionConfig,
    PermissionRule, ProviderConfig, ResolvedMcpServer, ToolPermission,
};
pub use watcher::start_config_watcher;
pub use skills::{SkillDiscovery, SkillLoader, Skill, LoadedSkill, SkillMetadata, SkillSource, SkillError};
