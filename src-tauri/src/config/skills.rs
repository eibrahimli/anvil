use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Represents a discovered skill
#[derive(Debug, Clone)]
pub struct Skill {
    pub name: String,
    pub path: PathBuf,
    pub source: SkillSource,
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

#[derive(Debug, Clone, PartialEq)]
pub enum SkillError {
    IoError(std::io::ErrorKind),
    InvalidName(String),
}

impl std::fmt::Display for SkillError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SkillError::IoError(kind) => write!(f, "IO error: {:?}", kind),
            SkillError::InvalidName(msg) => write!(f, "Invalid skill name: {}", msg),
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
}
