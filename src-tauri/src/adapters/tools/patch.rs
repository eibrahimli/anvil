use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::PathBuf;
use tokio::fs;

pub struct PatchTool {
    pub workspace_root: PathBuf,
}

impl PatchTool {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }
}

#[async_trait]
impl Tool for PatchTool {
    fn name(&self) -> &'static str {
        "patch"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "patch",
            "description": "Apply a unified diff patch to files in the workspace. Supports dry-run mode to preview changes without applying them. Useful for applying code changes from diffs, PRs, or patches.",
            "parameters": {
                "type": "object",
                "properties": {
                    "patch": {
                        "type": "string",
                        "description": "The unified diff patch content to apply"
                    },
                    "path": {
                        "type": "string",
                        "description": "Base directory for patch application (relative to workspace root). Default: workspace root"
                    },
                    "dry_run": {
                        "type": "boolean",
                        "description": "If true, preview changes without applying them (default: false)"
                    },
                    "strip": {
                        "type": "integer",
                        "description": "Number of leading path components to strip from file paths in the patch (default: 0)"
                    }
                },
                "required": ["patch"]
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let patch_content = input.get("patch")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'patch' parameter")?;

        let base_path = input.get("path")
            .and_then(|v| v.as_str())
            .map(|p| self.workspace_root.join(p))
            .unwrap_or_else(|| self.workspace_root.clone());

        let dry_run = input.get("dry_run")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let strip = input.get("strip")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize;

        // Security check: ensure base_path is within workspace
        if !base_path.starts_with(&self.workspace_root) {
            return Err("Access denied: Path is outside workspace".to_string());
        }

        // Parse the unified diff patch
        let patch_set = match patch::Patch::from_single(patch_content) {
            Ok(patch) => vec![patch],
            Err(e) => {
                // Try parsing as multiple patches
                match patch::Patch::from_multiple(patch_content) {
                    Ok(patches) => patches,
                    Err(_) => return Err(format!("Failed to parse patch: {}. Ensure it's a valid unified diff format.", e)),
                }
            }
        };

        let mut results: Vec<PatchResult> = Vec::new();
        let mut total_applied = 0;
        let mut total_failed = 0;

        for patch in patch_set {
            // Apply strip to the old/new file paths
            let old_path = strip_path_components(&patch.old.path, strip);
            let new_path = strip_path_components(&patch.new.path, strip);

            // Resolve full paths
            let old_full_path = base_path.join(&old_path);
            let new_full_path = base_path.join(&new_path);

            // Security check for both paths
            if !old_full_path.starts_with(&self.workspace_root) || !new_full_path.starts_with(&self.workspace_root) {
                results.push(PatchResult {
                    file: new_path.to_string_lossy().to_string(),
                    status: "error".to_string(),
                    message: Some("Path outside workspace after strip".to_string()),
                });
                total_failed += 1;
                continue;
            }

            // For dry_run, just report what would happen
            if dry_run {
                results.push(PatchResult {
                    file: new_path.to_string_lossy().to_string(),
                    status: "dry_run".to_string(),
                    message: Some(format!("Would apply {} hunks to {}", patch.hunks.len(), new_path.display())),
                });
                continue;
            }

            // Read the original file if it exists
            let original_content = if old_full_path.exists() {
                match fs::read_to_string(&old_full_path).await {
                    Ok(content) => content,
                    Err(e) => {
                        results.push(PatchResult {
                            file: new_path.to_string_lossy().to_string(),
                            status: "error".to_string(),
                            message: Some(format!("Failed to read file {}: {}", old_path.display(), e)),
                        });
                        total_failed += 1;
                        continue;
                    }
                }
            } else {
                // File doesn't exist - this might be a new file creation
                String::new()
            };

            // Apply the patch
            match apply_patch(&original_content, &patch) {
                Ok(new_content) => {
                    // Write the patched content
                    if let Err(e) = fs::write(&new_full_path, new_content).await {
                        results.push(PatchResult {
                            file: new_path.to_string_lossy().to_string(),
                            status: "error".to_string(),
                            message: Some(format!("Failed to write file {}: {}", new_path.display(), e)),
                        });
                        total_failed += 1;
                    } else {
                        results.push(PatchResult {
                            file: new_path.to_string_lossy().to_string(),
                            status: "success".to_string(),
                            message: Some(format!("Applied {} hunks", patch.hunks.len())),
                        });
                        total_applied += 1;
                    }
                }
                Err(e) => {
                    results.push(PatchResult {
                        file: new_path.to_string_lossy().to_string(),
                        status: "error".to_string(),
                        message: Some(format!("Failed to apply patch: {}", e)),
                    });
                    total_failed += 1;
                }
            }
        }

        Ok(json!({
            "results": results,
            "total_patches": results.len(),
            "applied": total_applied,
            "failed": total_failed,
            "dry_run": dry_run
        }))
    }
}

#[derive(serde::Serialize)]
struct PatchResult {
    file: String,
    status: String,
    message: Option<String>,
}

fn strip_path_components(path: &str, strip: usize) -> PathBuf {
    let components: Vec<_> = path.split('/').collect();
    if strip >= components.len() {
        PathBuf::from("")
    } else {
        components[strip..].join("/").into()
    }
}

fn apply_patch(original: &str, patch: &patch::Patch) -> Result<String, String> {
    let lines: Vec<&str> = original.lines().collect();
    let mut result_lines: Vec<String> = lines.iter().map(|&s| s.to_string()).collect();
    let mut offset: isize = 0;

    for hunk in &patch.hunks {
        // Calculate the actual line number in the current file
        let hunk_start = (hunk.old_range.start as isize - 1 + offset) as usize;
        
        // Validate context lines match before applying
        if !validate_context(&lines, hunk, hunk_start) {
            return Err("Context lines do not match - the file may have changed".to_string());
        }
        
        // Apply the hunk
        let mut line_idx = hunk_start;
        let mut removed_count = 0;
        
        for line in &hunk.lines {
            match line {
                patch::Line::Context(_) => {
                    // Context line - just advance
                    line_idx += 1;
                }
                patch::Line::Remove(_) => {
                    // Remove line at current position
                    let actual_idx = line_idx - removed_count;
                    if actual_idx < result_lines.len() {
                        result_lines.remove(actual_idx);
                        removed_count += 1;
                        offset -= 1;
                    }
                }
                patch::Line::Add(s) => {
                    // Add new line at current position
                    let actual_idx = line_idx - removed_count;
                    if actual_idx >= result_lines.len() {
                        result_lines.push(s.to_string());
                    } else {
                        result_lines.insert(actual_idx, s.to_string());
                    }
                    line_idx += 1;
                    offset += 1;
                    removed_count += 1; // Account for the fact we added a line
                }
            }
        }
    }

    Ok(result_lines.join("\n"))
}

/// Validate that context lines in the hunk match the file at the expected positions
fn validate_context(lines: &[&str], hunk: &patch::Hunk, start_line: usize) -> bool {
    let mut file_line = start_line;
    
    for line in &hunk.lines {
        match line {
            patch::Line::Context(expected) => {
                // Context line must match exactly
                if file_line >= lines.len() {
                    return false; // Expected context but file ended
                }
                if lines[file_line] != *expected {
                    return false; // Context doesn't match
                }
                file_line += 1;
            }
            patch::Line::Remove(expected) => {
                // The line to be removed must exist and match
                if file_line >= lines.len() {
                    return false;
                }
                if lines[file_line] != *expected {
                    return false;
                }
                file_line += 1;
            }
            patch::Line::Add(_) => {
                // Added lines don't need validation against the file
                // They just indicate where new content will be inserted
            }
        }
    }
    
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_patch_basic() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        // Create original file
        let original_content = "line1\nline2\nline3\n";
        fs::write(workspace.join("test.txt"), original_content).await.unwrap();

        // Create a simple patch (without a/ b/ prefixes for simplicity)
        let patch_content = r#"--- test.txt
+++ test.txt
@@ -1,3 +1,3 @@
 line1
-line2
+line2_modified
 line3
"#;

        let tool = PatchTool::new(workspace.clone());
        let input = json!({
            "patch": patch_content
        });

        let result = tool.execute(input).await.unwrap();
        let results = result.get("results").unwrap().as_array().unwrap();
        
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].get("status").unwrap().as_str().unwrap(), "success");
        
        // Verify file was modified
        let new_content = fs::read_to_string(workspace.join("test.txt")).await.unwrap();
        assert!(new_content.contains("line2_modified"));
    }

    #[tokio::test]
    async fn test_patch_dry_run() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        // Create original file
        let original_content = "line1\nline2\nline3\n";
        fs::write(workspace.join("test.txt"), original_content).await.unwrap();

        let patch_content = r#"--- test.txt
+++ test.txt
@@ -1,3 +1,3 @@
 line1
-line2
+line2_modified
 line3
"#;

        let tool = PatchTool::new(workspace.clone());
        let input = json!({
            "patch": patch_content,
            "dry_run": true
        });

        let result = tool.execute(input).await.unwrap();
        let results = result.get("results").unwrap().as_array().unwrap();
        
        assert_eq!(results[0].get("status").unwrap().as_str().unwrap(), "dry_run");
        
        // Verify file was NOT modified
        let content = fs::read_to_string(workspace.join("test.txt")).await.unwrap();
        assert!(!content.contains("line2_modified"));
    }

    #[tokio::test]
    async fn test_patch_security() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        let tool = PatchTool::new(workspace.clone());
        // Use an absolute path outside the workspace to test security
        let outside_path = "/etc";
        let input = json!({
            "patch": "--- /etc/passwd\n+++ /etc/passwd\n@@ -1 +1 @@\n-old\n+new\n",
            "path": outside_path
        });

        let result = tool.execute(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Access denied"));
    }

    #[tokio::test]
    async fn test_patch_invalid_patch() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        let tool = PatchTool::new(workspace.clone());
        let input = json!({
            "patch": "This is not a valid patch"
        });

        let result = tool.execute(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to parse patch"));
    }
}
