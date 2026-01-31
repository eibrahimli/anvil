use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::PathBuf;
use tokio::fs;

pub struct ListTool {
    pub workspace_root: PathBuf,
}

impl ListTool {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }
}

#[derive(serde::Serialize)]
struct FileEntry {
    name: String,
    path: String,
    kind: String, // "file" or "directory"
    size: Option<u64>,
    modified: Option<u64>,
}

#[async_trait]
impl Tool for ListTool {
    fn name(&self) -> &'static str {
        "list"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "list",
            "description": "List files and directories in a given path. Returns file metadata including size and modification time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path to list (relative to workspace root). Default: current directory"
                    },
                    "depth": {
                        "type": "integer",
                        "description": "Maximum depth to recurse (default: 1, 0 means unlimited)",
                        "default": 1
                    },
                    "show_hidden": {
                        "type": "boolean",
                        "description": "Include hidden files (starting with .) (default: false)",
                        "default": false
                    },
                    "filter": {
                        "type": "string",
                        "description": "Filter by type: 'files', 'dirs', or 'all' (default: 'all')",
                        "enum": ["files", "dirs", "all"],
                        "default": "all"
                    }
                },
                "required": []
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let rel_path = input.get("path")
            .and_then(|v| v.as_str())
            .unwrap_or(".");

        let depth = input.get("depth")
            .and_then(|v| v.as_u64())
            .unwrap_or(1);

        let show_hidden = input.get("show_hidden")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let filter = input.get("filter")
            .and_then(|v| v.as_str())
            .unwrap_or("all");

        let target_path = self.workspace_root.join(rel_path);

        // Security check: ensure target is within workspace
        if !target_path.starts_with(&self.workspace_root) {
            return Err("Access denied: Path is outside workspace".to_string());
        }

        // Check if path exists and is a directory
        match fs::metadata(&target_path).await {
            Ok(metadata) => {
                if !metadata.is_dir() {
                    return Err(format!("Path is not a directory: {}", rel_path));
                }
            }
            Err(e) => {
                return Err(format!("Cannot access path '{}': {}", rel_path, e));
            }
        }

        let mut entries: Vec<FileEntry> = Vec::new();
        
        // Use async recursion to walk directory
        self.list_directory(
            &target_path,
            &target_path,
            depth as usize,
            0,
            show_hidden,
            filter,
            &mut entries,
        ).await?;

        // Sort: directories first, then alphabetically
        entries.sort_by(|a, b| {
            match (a.kind.as_str(), b.kind.as_str()) {
                ("directory", "file") => std::cmp::Ordering::Less,
                ("file", "directory") => std::cmp::Ordering::Greater,
                _ => a.name.cmp(&b.name),
            }
        });

        Ok(json!({
            "entries": entries,
            "count": entries.len(),
            "path": rel_path,
            "is_root": rel_path == "."
        }))
    }
}

impl ListTool {
    async fn list_directory(
        &self,
        base_path: &PathBuf,
        current_path: &PathBuf,
        max_depth: usize,
        current_depth: usize,
        show_hidden: bool,
        filter: &str,
        entries: &mut Vec<FileEntry>,
    ) -> Result<(), String> {
        if max_depth > 0 && current_depth > max_depth {
            return Ok(());
        }

        let mut dir_entries = match fs::read_dir(current_path).await {
            Ok(entries) => entries,
            Err(e) => {
                return Err(format!("Failed to read directory: {}", e));
            }
        };

        while let Some(entry) = dir_entries.next_entry().await.map_err(|e| e.to_string())? {
            let name = entry.file_name().to_string_lossy().to_string();
            
            // Skip hidden files unless show_hidden is true
            if !show_hidden && name.starts_with('.') {
                continue;
            }

            // Skip common ignore directories
            if name == "node_modules" || name == "target" || name == ".git" {
                continue;
            }

            let full_path = entry.path();
            let relative_path = full_path.strip_prefix(base_path)
                .unwrap_or(&full_path)
                .to_string_lossy()
                .to_string();

            let metadata = match entry.metadata().await {
                Ok(m) => m,
                Err(_) => continue, // Skip files we can't read
            };

            let is_dir = metadata.is_dir();
            let kind = if is_dir { "directory" } else { "file" };

            // Apply filter
            match filter {
                "files" if is_dir => continue,
                "dirs" if !is_dir => continue,
                _ => {}
            }

            let size = if is_dir { None } else { Some(metadata.len()) };
            
            let modified = metadata.modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());

            entries.push(FileEntry {
                name: name.clone(),
                path: relative_path,
                kind: kind.to_string(),
                size,
                modified,
            });

            // Recurse into subdirectories
            if is_dir && (max_depth == 0 || current_depth < max_depth) {
                Box::pin(self.list_directory(
                    base_path,
                    &full_path,
                    max_depth,
                    current_depth + 1,
                    show_hidden,
                    filter,
                    entries,
                )).await?;
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_list_basic() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        // Create test structure
        File::create(workspace.join("file1.rs")).unwrap();
        File::create(workspace.join("file2.txt")).unwrap();
        std::fs::create_dir(workspace.join("subdir")).unwrap();

        let tool = ListTool::new(workspace.clone());
        let input = json!({
            "path": ".",
            "depth": 1
        });

        let result = tool.execute(input).await.unwrap();
        let entries = result.get("entries").unwrap().as_array().unwrap();
        
        assert_eq!(entries.len(), 3); // 2 files + 1 dir at depth 1
        
        let names: Vec<String> = entries.iter()
            .map(|e| e.get("name").unwrap().as_str().unwrap().to_string())
            .collect();
        assert!(names.contains(&"file1.rs".to_string()));
        assert!(names.contains(&"file2.txt".to_string()));
        assert!(names.contains(&"subdir".to_string()));
    }

    #[tokio::test]
    async fn test_list_filter() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        File::create(workspace.join("file.rs")).unwrap();
        std::fs::create_dir(workspace.join("dir")).unwrap();

        let tool = ListTool::new(workspace.clone());
        
        // Filter files only
        let input = json!({
            "filter": "files"
        });
        let result = tool.execute(input).await.unwrap();
        let entries = result.get("entries").unwrap().as_array().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].get("name").unwrap().as_str().unwrap(), "file.rs");

        // Filter directories only
        let input = json!({
            "filter": "dirs"
        });
        let result = tool.execute(input).await.unwrap();
        let entries = result.get("entries").unwrap().as_array().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].get("name").unwrap().as_str().unwrap(), "dir");
    }

    #[tokio::test]
    async fn test_list_security() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        let tool = ListTool::new(workspace.clone());
        // Use an absolute path outside the workspace to test security
        let outside_path = "/etc";
        let input = json!({
            "path": outside_path
        });

        let result = tool.execute(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Access denied"));
    }
}
