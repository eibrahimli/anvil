use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::PathBuf;
use ::glob::glob;
use std::time::SystemTime;

pub struct GlobTool {
    pub workspace_root: PathBuf,
}

impl GlobTool {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }
}

#[derive(serde::Serialize)]
struct FileMatch {
    path: String,
    modified: Option<u64>,
}

#[async_trait]
impl Tool for GlobTool {
    fn name(&self) -> &'static str {
        "glob"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "glob",
            "description": "Find files by pattern matching. Supports glob patterns like **/*.js or src/**/*.ts. Returns matching file paths sorted by modification time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Glob pattern to match files against (e.g., **/*.rs, src/**/*.ts)"
                    },
                    "path": {
                        "type": "string",
                        "description": "Optional base directory (relative to workspace root). Default: workspace root"
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default: 1000)",
                        "default": 1000
                    }
                },
                "required": ["pattern"]
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let pattern_str = input.get("pattern")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'pattern' parameter")?;

        let base_path = input.get("path")
            .and_then(|v| v.as_str())
            .map(|p| self.workspace_root.join(p))
            .unwrap_or_else(|| self.workspace_root.clone());

        let max_results = input.get("max_results")
            .and_then(|v| v.as_u64())
            .unwrap_or(1000) as usize;

        // Security check: ensure base_path is within workspace
        if !base_path.starts_with(&self.workspace_root) {
            return Err("Access denied: Path is outside workspace".to_string());
        }

        // Build full glob pattern
        let full_pattern = base_path.join(pattern_str);
        let pattern_str = full_pattern.to_string_lossy().to_string();

        // Perform glob matching
        let mut matches: Vec<FileMatch> = Vec::new();
        
        match glob(&pattern_str) {
            Ok(paths) => {
                for entry in paths {
                    match entry {
                        Ok(path) => {
                            // Skip directories, only include files
                            if path.is_file() {
                                // Get modification time
                                let modified = std::fs::metadata(&path)
                                    .ok()
                                    .and_then(|m| m.modified().ok())
                                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                                    .map(|d| d.as_secs());

                                // Get relative path from workspace root
                                let relative_path = path.strip_prefix(&self.workspace_root)
                                    .unwrap_or(&path)
                                    .to_string_lossy()
                                    .to_string();

                                matches.push(FileMatch {
                                    path: relative_path,
                                    modified,
                                });

                                if matches.len() >= max_results {
                                    break;
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Glob error for pattern '{}': {:?}", pattern_str, e);
                        }
                    }
                }
            }
            Err(e) => {
                return Err(format!("Invalid glob pattern '{}': {}", pattern_str, e));
            }
        }

        // Sort by modification time (newest first)
        matches.sort_by(|a, b| {
            match (b.modified, a.modified) {
                (Some(b_time), Some(a_time)) => b_time.cmp(&a_time),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            }
        });

        Ok(json!({
            "matches": matches,
            "count": matches.len(),
            "pattern": pattern_str,
            "base_path": base_path.strip_prefix(&self.workspace_root)
                .unwrap_or(&base_path)
                .to_string_lossy()
                .to_string()
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_glob_basic() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        // Create test files
        File::create(workspace.join("test.rs")).unwrap();
        File::create(workspace.join("test2.rs")).unwrap();
        File::create(workspace.join("test.txt")).unwrap();

        let tool = GlobTool::new(workspace.clone());
        let input = json!({
            "pattern": "*.rs"
        });

        let result = tool.execute(input).await.unwrap();
        let matches = result.get("matches").unwrap().as_array().unwrap();
        
        assert_eq!(matches.len(), 2);
        let paths: Vec<String> = matches.iter()
            .map(|m| m.get("path").unwrap().as_str().unwrap().to_string())
            .collect();
        assert!(paths.contains(&"test.rs".to_string()));
        assert!(paths.contains(&"test2.rs".to_string()));
    }

    #[tokio::test]
    async fn test_glob_security() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        let tool = GlobTool::new(workspace.clone());
        // Use an absolute path outside the workspace to test security
        let outside_path = "/etc";
        let input = json!({
            "pattern": "*.rs",
            "path": outside_path
        });

        let result = tool.execute(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Access denied"));
    }
}
