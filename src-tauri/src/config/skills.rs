use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Represents a discovered skill (file only)
#[derive(Debug, Clone)]
pub struct Skill {
    pub name: String,
    pub path: PathBuf,
    pub source: SkillSource,
}

/// Fully loaded skill with parsed metadata and content
#[derive(Debug, Clone)]
pub struct LoadedSkill {
    pub name: String,
    pub path: PathBuf,
    pub source: SkillSource,
    pub metadata: SkillMetadata,
    pub content: String, // Markdown content after frontmatter
}

/// YAML frontmatter from SKILL.md
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SkillMetadata {
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compatibility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SkillSource {
    Project, // .anvil/skills/ or .claude/skills/
    Global,  // ~/.config/anvil/skills/ or ~/.claude/skills/
}

/// Discovers all skills from various locations
pub struct SkillDiscovery;

impl SkillDiscovery {
    /// Discover all skills for a given workspace
    pub fn discover(workspace_path: &Path) -> Result<Vec<Skill>, SkillError> {
        let mut skills: HashMap<String, Skill> = HashMap::new();

        // 1. Discover project skills (walk up to git root)
        Self::discover_project_skills(workspace_path, &mut skills)?;

        // 2. Discover global skills
        Self::discover_global_skills(&mut skills)?;

        // Convert to vector
        let result: Vec<Skill> = skills.into_values().collect();
        Ok(result)
    }

    /// Walk up directory tree to find project skills
    fn discover_project_skills(
        start_path: &Path,
        skills: &mut HashMap<String, Skill>,
    ) -> Result<(), SkillError> {
        let mut current = start_path.to_path_buf();

        loop {
            // Check .anvil/skills/
            let anvil_skills = current.join(".anvil").join("skills");
            if anvil_skills.exists() {
                Self::scan_skills_directory(&anvil_skills, SkillSource::Project, skills)?;
            }

            // Check .claude/skills/ (Claude compatibility)
            let claude_skills = current.join(".claude").join("skills");
            if claude_skills.exists() {
                Self::scan_skills_directory(&claude_skills, SkillSource::Project, skills)?;
            }

            // Check if we're at git root
            if current.join(".git").exists() {
                break;
            }

            // Move up one directory
            match current.parent() {
                Some(parent) => current = parent.to_path_buf(),
                None => break,
            }
        }

        Ok(())
    }

    /// Discover global skills
    fn discover_global_skills(skills: &mut HashMap<String, Skill>) -> Result<(), SkillError> {
        // Check ~/.config/anvil/skills/
        if let Some(config_dir) = dirs::config_dir() {
            let anvil_global = config_dir.join("anvil").join("skills");
            if anvil_global.exists() {
                Self::scan_skills_directory(&anvil_global, SkillSource::Global, skills)?;
            }

            // Check ~/.claude/skills/ (Claude compatibility)
            let claude_global = config_dir.join("claude").join("skills");
            if claude_global.exists() {
                Self::scan_skills_directory(&claude_global, SkillSource::Global, skills)?;
            }
        }

        Ok(())
    }

    /// Scan a skills directory for SKILL.md files
    fn scan_skills_directory(
        skills_dir: &Path,
        source: SkillSource,
        skills: &mut HashMap<String, Skill>,
    ) -> Result<(), SkillError> {
        let entries = fs::read_dir(skills_dir).map_err(|e| SkillError::IoError(e.kind()))?;

        for entry in entries {
            let entry = entry.map_err(|e| SkillError::IoError(e.kind()))?;
            let path = entry.path();

            // Check if it's a directory
            if !path.is_dir() {
                continue;
            }

            // Get skill name from directory name
            let skill_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string())
                .ok_or_else(|| {
                    SkillError::InvalidName("Invalid skill directory name".to_string())
                })?;

            // Validate skill name format
            if !Self::is_valid_skill_name(&skill_name) {
                eprintln!("Warning: Invalid skill name '{}' - skipping", skill_name);
                continue;
            }

            // Check for SKILL.md
            let skill_md = path.join("SKILL.md");
            if !skill_md.exists() {
                continue;
            }

            // Check for duplicates (first found wins)
            if skills.contains_key(&skill_name) {
                println!(
                    "Skipping duplicate skill '{}' from {:?}",
                    skill_name, source
                );
                continue;
            }

            skills.insert(
                skill_name.clone(),
                Skill {
                    name: skill_name,
                    path: skill_md,
                    source: source.clone(),
                },
            );
        }

        Ok(())
    }

    /// Validate skill name according to rules
    /// Regex: ^[a-z0-9]+(-[a-z0-9]+)*$
    fn is_valid_skill_name(name: &str) -> bool {
        if name.is_empty() || name.len() > 64 {
            return false;
        }

        // Check for leading/trailing hyphens
        if name.starts_with('-') || name.ends_with('-') {
            return false;
        }

        // Check for consecutive hyphens
        if name.contains("--") {
            return false;
        }

        // Check each character
        for c in name.chars() {
            if !c.is_ascii_lowercase() && !c.is_ascii_digit() && c != '-' {
                return false;
            }
        }

        true
    }
}

/// Loads and parses SKILL.md files
pub struct SkillLoader;

impl SkillLoader {
    /// Load a skill file and parse its contents
    pub fn load(skill: &Skill) -> Result<LoadedSkill, SkillError> {
        let content = fs::read_to_string(&skill.path).map_err(|e| SkillError::IoError(e.kind()))?;

        Self::parse(&skill.name, &skill.path, skill.source.clone(), &content)
    }

    /// Parse skill content from string (useful for testing)
    pub fn parse(
        name: &str,
        path: &Path,
        source: SkillSource,
        content: &str,
    ) -> Result<LoadedSkill, SkillError> {
        // Parse frontmatter and content
        let (metadata, markdown_content) = Self::parse_frontmatter(content)?;

        // Validate metadata
        Self::validate_metadata(name, &metadata)?;

        Ok(LoadedSkill {
            name: name.to_string(),
            path: path.to_path_buf(),
            source,
            metadata,
            content: markdown_content.to_string(),
        })
    }

    /// Parse YAML frontmatter from markdown content
    /// Format: ---\nyaml here\n---\nmarkdown content
    fn parse_frontmatter(content: &str) -> Result<(SkillMetadata, &str), SkillError> {
        // Check if content starts with frontmatter delimiter
        if !content.starts_with("---") {
            return Err(SkillError::ParseError(
                "Missing frontmatter delimiter '---'".to_string(),
            ));
        }

        // Find the closing delimiter
        let after_first_delim = &content[3..];
        if let Some(end_pos) = after_first_delim.find("---") {
            let yaml_content = &after_first_delim[..end_pos].trim();
            let markdown_content = &after_first_delim[end_pos + 3..].trim_start();

            // Parse YAML
            let metadata: SkillMetadata = serde_yaml::from_str(yaml_content)
                .map_err(|e| SkillError::ParseError(format!("Invalid YAML frontmatter: {}", e)))?;

            Ok((metadata, markdown_content))
        } else {
            Err(SkillError::ParseError(
                "Missing closing frontmatter delimiter '---'".to_string(),
            ))
        }
    }

    /// Validate skill metadata
    fn validate_metadata(dir_name: &str, metadata: &SkillMetadata) -> Result<(), SkillError> {
        // Check required fields
        if metadata.name.is_empty() {
            return Err(SkillError::InvalidMetadata(
                "Missing required field: name".to_string(),
            ));
        }
        if metadata.description.is_empty() {
            return Err(SkillError::InvalidMetadata(
                "Missing required field: description".to_string(),
            ));
        }

        // Validate name matches directory name
        if metadata.name != dir_name {
            return Err(SkillError::InvalidMetadata(format!(
                "Skill name '{}' doesn't match directory name '{}'",
                metadata.name, dir_name
            )));
        }

        // Validate name format
        if !SkillDiscovery::is_valid_skill_name(&metadata.name) {
            return Err(SkillError::InvalidMetadata(format!(
                "Invalid skill name format: '{}'",
                metadata.name
            )));
        }

        Ok(())
    }

    /// Load all skills for a workspace
    pub fn load_all(workspace_path: &Path) -> Result<Vec<LoadedSkill>, SkillError> {
        let skills = SkillDiscovery::discover(workspace_path)?;
        let mut loaded = Vec::new();

        for skill in skills {
            match Self::load(&skill) {
                Ok(loaded_skill) => loaded.push(loaded_skill),
                Err(e) => {
                    eprintln!("Warning: Failed to load skill '{}': {}", skill.name, e);
                    // Continue loading other skills
                }
            }
        }

        Ok(loaded)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SkillError {
    IoError(std::io::ErrorKind),
    InvalidName(String),
    ParseError(String),
    InvalidMetadata(String),
}

impl std::fmt::Display for SkillError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SkillError::IoError(kind) => write!(f, "IO error: {:?}", kind),
            SkillError::InvalidName(msg) => write!(f, "Invalid skill name: {}", msg),
            SkillError::ParseError(msg) => write!(f, "Parse error: {}", msg),
            SkillError::InvalidMetadata(msg) => write!(f, "Invalid metadata: {}", msg),
        }
    }
}

impl std::error::Error for SkillError {}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_valid_skill_names() {
        assert!(SkillDiscovery::is_valid_skill_name("git-release"));
        assert!(SkillDiscovery::is_valid_skill_name("code-review"));
        assert!(SkillDiscovery::is_valid_skill_name("typescript-patterns"));
        assert!(SkillDiscovery::is_valid_skill_name("test123"));
    }

    #[test]
    fn test_invalid_skill_names() {
        assert!(!SkillDiscovery::is_valid_skill_name("")); // Empty
        assert!(!SkillDiscovery::is_valid_skill_name("-start")); // Leading hyphen
        assert!(!SkillDiscovery::is_valid_skill_name("end-")); // Trailing hyphen
        assert!(!SkillDiscovery::is_valid_skill_name("double--hyphen")); // Consecutive hyphens
        assert!(!SkillDiscovery::is_valid_skill_name("CamelCase")); // Uppercase
        assert!(!SkillDiscovery::is_valid_skill_name("with space")); // Space
        assert!(!SkillDiscovery::is_valid_skill_name("with_underscore")); // Underscore
    }

    #[test]
    fn test_discover_project_skills() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        // Create .anvil/skills/git-release/SKILL.md
        let skills_dir = workspace.join(".anvil").join("skills").join("git-release");
        fs::create_dir_all(&skills_dir).unwrap();
        fs::write(skills_dir.join("SKILL.md"), "# Git Release Skill").unwrap();

        // Create .claude/skills/code-review/SKILL.md (Claude compatibility)
        let claude_skills_dir = workspace.join(".claude").join("skills").join("code-review");
        fs::create_dir_all(&claude_skills_dir).unwrap();
        fs::write(claude_skills_dir.join("SKILL.md"), "# Code Review Skill").unwrap();

        // Initialize git repo so discovery stops here
        fs::create_dir(workspace.join(".git")).unwrap();

        let skills = SkillDiscovery::discover(&workspace).unwrap();

        assert_eq!(skills.len(), 2);

        let skill_names: Vec<String> = skills.iter().map(|s| s.name.clone()).collect();
        assert!(skill_names.contains(&"git-release".to_string()));
        assert!(skill_names.contains(&"code-review".to_string()));
    }

    #[test]
    fn test_duplicate_skills_precedence() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        // Create skill in both .anvil and .claude
        let anvil_skill = workspace.join(".anvil").join("skills").join("test-skill");
        fs::create_dir_all(&anvil_skill).unwrap();
        fs::write(anvil_skill.join("SKILL.md"), "# Anvil Version").unwrap();

        let claude_skill = workspace.join(".claude").join("skills").join("test-skill");
        fs::create_dir_all(&claude_skill).unwrap();
        fs::write(claude_skill.join("SKILL.md"), "# Claude Version").unwrap();

        fs::create_dir(workspace.join(".git")).unwrap();

        let skills = SkillDiscovery::discover(&workspace).unwrap();

        assert_eq!(skills.len(), 1);
        // First found wins (alphabetically .anvil comes before .claude, so anvil wins)
        // Actually order depends on directory iteration order
    }

    #[test]
    fn test_parse_frontmatter_valid() {
        let content = r#"---
name: git-release
description: Create consistent releases and changelogs
license: MIT
compatibility: opencode
metadata:
  audience: maintainers
  workflow: github
---

## What I do
- Draft release notes from merged PRs
- Propose version bump
"#;

        let (metadata, markdown) = SkillLoader::parse_frontmatter(content).unwrap();

        assert_eq!(metadata.name, "git-release");
        assert_eq!(
            metadata.description,
            "Create consistent releases and changelogs"
        );
        assert_eq!(metadata.license, Some("MIT".to_string()));
        assert_eq!(metadata.compatibility, Some("opencode".to_string()));
        assert!(metadata.metadata.is_some());

        let meta = metadata.metadata.unwrap();
        assert_eq!(meta.get("audience"), Some(&"maintainers".to_string()));
        assert_eq!(meta.get("workflow"), Some(&"github".to_string()));

        assert!(markdown.contains("## What I do"));
        assert!(markdown.contains("Draft release notes"));
    }

    #[test]
    fn test_parse_frontmatter_missing_delimiter() {
        let content = "No frontmatter here\nJust markdown";
        let result = SkillLoader::parse_frontmatter(content);
        assert!(result.is_err());
    }

    #[test]
    fn test_load_skill_from_file() {
        let temp_dir = TempDir::new().unwrap();
        let skill_path = temp_dir.path().join("SKILL.md");

        let content = r#"---
name: test-skill
description: A test skill for unit testing
---

## What I do
This is test content.
"#;

        fs::write(&skill_path, content).unwrap();

        let skill = Skill {
            name: "test-skill".to_string(),
            path: skill_path.clone(),
            source: SkillSource::Project,
        };

        let loaded = SkillLoader::load(&skill).unwrap();

        assert_eq!(loaded.name, "test-skill");
        assert_eq!(loaded.metadata.name, "test-skill");
        assert_eq!(loaded.metadata.description, "A test skill for unit testing");
        assert!(loaded.content.contains("## What I do"));
    }

    #[test]
    fn test_load_skill_name_mismatch() {
        let temp_dir = TempDir::new().unwrap();
        let skill_path = temp_dir.path().join("SKILL.md");

        let content = r#"---
name: wrong-name
description: Description here
---

Content here.
"#;

        fs::write(&skill_path, content).unwrap();

        let result = SkillLoader::parse("test-skill", &skill_path, SkillSource::Project, content);
        assert!(result.is_err()); // Should fail because name doesn't match directory
    }

    #[test]
    fn test_load_skill_missing_required_fields() {
        let temp_dir = TempDir::new().unwrap();
        let skill_path = temp_dir.path().join("SKILL.md");

        let content = r#"---
name: test-skill
---

Content here.
"#;

        fs::write(&skill_path, content).unwrap();

        let skill = Skill {
            name: "test-skill".to_string(),
            path: skill_path.clone(),
            source: SkillSource::Project,
        };

        let result = SkillLoader::load(&skill);
        assert!(result.is_err()); // Should fail because description is missing
    }
}
