use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;

pub struct GitTool {
    pub workspace_root: PathBuf,
}

impl GitTool {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }

    fn run_git(&self, args: Vec<&str>) -> Result<String, String> {
        let output = Command::new("git")
            .current_dir(&self.workspace_root)
            .args(args)
            .output()
            .map_err(|e| format!("Failed to execute git: {}", e))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }
}

#[async_trait]
impl Tool for GitTool {
    fn name(&self) -> &'static str {
        "git"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "git",
            "description": "Execute git commands (status, add, commit, log, diff)",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "enum": ["status", "add", "commit", "log", "diff"],
                        "description": "The git command to run"
                    },
                    "args": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Arguments for the command (e.g., file paths for 'add', message for 'commit')"
                    }
                },
                "required": ["command"]
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let command = input.get("command")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'command' parameter")?;

        let args_val = input.get("args")
            .and_then(|v| v.as_array());

        let mut git_args = vec![command];
        if let Some(args) = args_val {
            for arg in args {
                if let Some(s) = arg.as_str() {
                    git_args.push(s);
                }
            }
        }

        match self.run_git(git_args) {
            Ok(stdout) => Ok(json!({ "stdout": stdout })),
            Err(stderr) => Err(stderr),
        }
    }
}
