use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use git2::{Repository, StatusOptions, Signature};
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

    fn get_repo(&self) -> Result<Repository, String> {
        Repository::open(&self.workspace_root)
            .map_err(|e| format!("Failed to open git repository: {}", e))
    }

    fn git_status(&self) -> Result<Value, String> {
        let repo = self.get_repo()?;
        let mut status_opts = StatusOptions::new();
        status_opts.include_untracked(true);

        let statuses = repo.statuses(Some(&mut status_opts))
            .map_err(|e| format!("Failed to get statuses: {}", e))?;

        let mut staged = Vec::new();
        let mut unstaged = Vec::new();
        let mut untracked = Vec::new();
        let mut conflicted = Vec::new();

        for entry in statuses.iter() {
            let path = entry.path().unwrap_or("unknown").to_string();
            let status = entry.status();

            if status.is_index_new() || status.is_index_modified() || status.is_index_deleted() || status.is_index_renamed() || status.is_index_typechange() {
                staged.push(path);
            } else if status.is_wt_modified() || status.is_wt_deleted() {
                unstaged.push(path);
            } else if status.is_wt_new() {
                untracked.push(path);
            } else if status.is_conflicted() {
                conflicted.push(path);
            }
        }

        // Get current branch
        let head = repo.head().ok();
        let branch_name = head.as_ref()
            .and_then(|h| h.shorthand())
            .unwrap_or("HEAD detached")
            .to_string();

        // Get latest commit message
        let latest_commit = repo.head()
            .ok()
            .and_then(|h| h.target())
            .and_then(|oid| repo.find_commit(oid).ok())
            .map(|commit| commit.message().unwrap_or("").to_string());

        Ok(json!({
            "branch": branch_name,
            "staged": staged,
            "unstaged": unstaged,
            "untracked": untracked,
            "conflicted": conflicted,
            "latest_commit": latest_commit,
        }))
    }

    fn git_add(&self, files: Vec<String>) -> Result<String, String> {
        let repo = self.get_repo()?;
        let mut index = repo.index()
            .map_err(|e| format!("Failed to get index: {}", e))?;

        let file_count = files.len();
        for file in &files {
            let path = PathBuf::from(file);
            index.add_path(&path)
                .map_err(|e| format!("Failed to add file {}: {}", file, e))?;
        }

        index.write()
            .map_err(|e| format!("Failed to write index: {}", e))?;

        Ok(format!("Added {} file(s) to staging area", file_count))
    }

    fn git_commit(&self, message: &str) -> Result<String, String> {
        let repo = self.get_repo()?;
        let mut index = repo.index()
            .map_err(|e| format!("Failed to get index: {}", e))?;

        let tree_id = index.write_tree()
            .map_err(|e| format!("Failed to write tree: {}", e))?;
        let tree = repo.find_tree(tree_id)
            .map_err(|e| format!("Failed to find tree: {}", e))?;

        let signature = Signature::now("Anvil Agent", "agent@anvil.local")
            .map_err(|e| format!("Failed to create signature: {}", e))?;

        let parent_commit = repo.head()
            .ok()
            .and_then(|h| h.target())
            .and_then(|oid| repo.find_commit(oid).ok());

        let parents: Vec<&git2::Commit> = parent_commit.as_ref().into_iter().collect();

        let commit_oid = repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents
        ).map_err(|e| format!("Failed to create commit: {}", e))?;

        Ok(format!("Created commit: {}", commit_oid))
    }

    fn git_log(&self, count: usize) -> Result<Value, String> {
        let repo = self.get_repo()?;
        let mut revwalk = repo.revwalk()
            .map_err(|e| format!("Failed to create revwalk: {}", e))?;

        revwalk.push_head()
            .map_err(|e| format!("Failed to push head: {}", e))?;

        let mut commits = Vec::new();

        for (i, oid_result) in revwalk.enumerate() {
            if i >= count {
                break;
            }

            let oid = oid_result.map_err(|e| format!("Failed to get oid: {}", e))?;
            let commit = repo.find_commit(oid)
                .map_err(|e| format!("Failed to find commit: {}", e))?;

            commits.push(json!({
                "id": oid.to_string(),
                "message": commit.message().unwrap_or("").to_string(),
                "author": commit.author().name().unwrap_or("Unknown").to_string(),
                "time": commit.time().seconds(),
            }));
        }

        Ok(json!({ "commits": commits }))
    }

    fn git_diff(&self, staged: bool) -> Result<String, String> {
        if staged {
            self.run_git(vec!["diff", "--cached"])
        } else {
            self.run_git(vec!["diff"])
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
            "description": "Execute git commands using git2 library (status, add, commit, log, diff)",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "enum": ["status", "add", "commit", "log", "diff"],
                        "description": "The git command to run"
                    },
                    "files": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "File paths for 'add' command"
                    },
                    "message": {
                        "type": "string",
                        "description": "Commit message for 'commit' command"
                    },
                    "count": {
                        "type": "integer",
                        "description": "Number of commits to show for 'log' command (default: 10)"
                    },
                    "staged": {
                        "type": "boolean",
                        "description": "Show staged changes for 'diff' command"
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

        match command {
            "status" => {
                self.git_status()
            }
            "add" => {
                let files: Vec<String> = input.get("files")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                    .unwrap_or_default();

                if files.is_empty() {
                    return Err("No files specified for 'add' command".to_string());
                }

                self.git_add(files)
                    .map(|msg| json!({ "message": msg }))
            }
            "commit" => {
                let message = input.get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Anvil agent commit");

                self.git_commit(message)
                    .map(|msg| json!({ "message": msg }))
            }
            "log" => {
                let count = input.get("count")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(10) as usize;

                self.git_log(count)
            }
            "diff" => {
                let staged = input.get("staged")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                self.git_diff(staged)
                    .map(|diff| json!({ "diff": diff }))
            }
            _ => Err(format!("Unknown git command: {}", command)),
        }
    }
}
