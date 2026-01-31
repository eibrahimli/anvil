use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::PathBuf;
use tokio::fs;

pub struct TodoReadTool {
    pub workspace_root: PathBuf,
}

impl TodoReadTool {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }

    fn get_todo_path(&self) -> PathBuf {
        self.workspace_root.join(".anvil").join("TODO.md")
    }
}

#[async_trait]
impl Tool for TodoReadTool {
    fn name(&self) -> &'static str {
        "todoread"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "todoread",
            "description": "Read and query tasks from the .anvil/TODO.md file. Returns structured task data that can be filtered by status. Use this to check current task progress or find specific tasks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filter": {
                        "type": "string",
                        "description": "Filter tasks by status: 'all', 'pending', 'in_progress', 'completed', 'cancelled'",
                        "enum": ["all", "pending", "in_progress", "completed", "cancelled"],
                        "default": "all"
                    }
                },
                "required": []
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let filter = input.get("filter")
            .and_then(|v| v.as_str())
            .unwrap_or("all");

        let todo_path = self.get_todo_path();

        // Check if file exists
        if !todo_path.exists() {
            return Ok(json!({
                "tasks": [],
                "count": 0,
                "filter": filter,
                "message": "No TODO.md file found. Use todowrite to create tasks."
            }));
        }

        // Read the file
        let content = fs::read_to_string(&todo_path).await
            .map_err(|e| format!("Failed to read TODO.md: {}", e))?;

        // Parse tasks
        let tasks = parse_todo_markdown(&content);

        // Calculate stats BEFORE filtering (so we have stats for all tasks)
        let stats = json!({
            "total": tasks.len(),
            "pending": tasks.iter().filter(|t| t.status == "pending").count(),
            "in_progress": tasks.iter().filter(|t| t.status == "in_progress").count(),
            "completed": tasks.iter().filter(|t| t.status == "completed").count(),
            "cancelled": tasks.iter().filter(|t| t.status == "cancelled").count()
        });

        // Apply filter
        let filtered_tasks: Vec<_> = match filter {
            "pending" => tasks.into_iter().filter(|t| t.status == "pending").collect(),
            "in_progress" => tasks.into_iter().filter(|t| t.status == "in_progress").collect(),
            "completed" => tasks.into_iter().filter(|t| t.status == "completed").collect(),
            "cancelled" => tasks.into_iter().filter(|t| t.status == "cancelled").collect(),
            _ => tasks,
        };

        Ok(json!({
            "tasks": filtered_tasks,
            "count": filtered_tasks.len(),
            "filter": filter,
            "stats": stats
        }))
    }
}

#[derive(serde::Serialize)]
struct Task {
    id: String,
    content: String,
    status: String,
    priority: String,
}

fn parse_todo_markdown(content: &str) -> Vec<Task> {
    let mut tasks = Vec::new();
    let mut current_status = "pending";

    for line in content.lines() {
        let trimmed = line.trim();
        
        // Parse section headers
        if trimmed.starts_with("##") {
            if trimmed.contains("In Progress") {
                current_status = "in_progress";
            } else if trimmed.contains("Completed") {
                current_status = "completed";
            } else if trimmed.contains("Cancelled") {
                current_status = "cancelled";
            } else {
                current_status = "pending";
            }
            continue;
        }

        // Parse task lines: "- [ ] Task content (PRIORITY) - ID: 1"
        if trimmed.starts_with("- [") || trimmed.starts_with("- [x]") {
            let checked = trimmed.starts_with("- [x]");
            
            // Extract content between brackets and end of line
            if let Some(content_start) = trimmed.find("] ") {
                let task_content = &trimmed[content_start + 2..];
                
                // Parse priority
                let priority = if task_content.contains("(HIGH)") {
                    "high"
                } else if task_content.contains("(LOW)") {
                    "low"
                } else {
                    "medium"
                };

                // Parse ID
                let id = if let Some(id_pos) = task_content.find("- ID: ") {
                    task_content[id_pos + 6..].trim().to_string()
                } else {
                    (tasks.len() + 1).to_string()
                };

                // Clean content
                let clean_content = task_content
                    .split("(HIGH)").next().unwrap_or(task_content)
                    .split("(MEDIUM)").next().unwrap_or(task_content)
                    .split("(LOW)").next().unwrap_or(task_content)
                    .split(" - ID:").next().unwrap_or(task_content)
                    .trim()
                    .to_string();

                let status = if checked {
                    "completed"
                } else {
                    current_status
                };

                tasks.push(Task {
                    id,
                    content: clean_content,
                    status: status.to_string(),
                    priority: priority.to_string(),
                });
            }
        }
    }

    tasks
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_todoread_basic() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        // Create .anvil directory and TODO.md file
        fs::create_dir_all(workspace.join(".anvil")).await.unwrap();
        let todo_content = r#"# Anvil Tasks

## Pending
- [ ] Task 1 (HIGH) - ID: 1
- [ ] Task 2 (MEDIUM) - ID: 2

## Completed
- [x] Task 3 (LOW) - ID: 3
"#;
        fs::write(workspace.join(".anvil").join("TODO.md"), todo_content).await.unwrap();

        let tool = TodoReadTool::new(workspace.clone());
        let input = json!({
            "filter": "all"
        });

        let result = tool.execute(input).await.unwrap();
        let tasks = result.get("tasks").unwrap().as_array().unwrap();
        
        assert_eq!(tasks.len(), 3);
        assert_eq!(result.get("count").unwrap().as_i64().unwrap(), 3);
        
        // Check stats
        let stats = result.get("stats").unwrap();
        assert_eq!(stats.get("total").unwrap().as_i64().unwrap(), 3);
        assert_eq!(stats.get("pending").unwrap().as_i64().unwrap(), 2);
        assert_eq!(stats.get("completed").unwrap().as_i64().unwrap(), 1);
    }

    #[tokio::test]
    async fn test_todoread_filter() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        // Create .anvil directory and TODO.md file
        fs::create_dir_all(workspace.join(".anvil")).await.unwrap();
        let todo_content = r#"# Anvil Tasks

## Pending
- [ ] Task 1 (HIGH) - ID: 1
- [ ] Task 2 (MEDIUM) - ID: 2

## Completed
- [x] Task 3 (LOW) - ID: 3
"#;
        fs::write(workspace.join(".anvil").join("TODO.md"), todo_content).await.unwrap();

        let tool = TodoReadTool::new(workspace.clone());
        
        // Test pending filter
        let input = json!({
            "filter": "pending"
        });
        let result = tool.execute(input).await.unwrap();
        let tasks = result.get("tasks").unwrap().as_array().unwrap();
        assert_eq!(tasks.len(), 2);

        // Test completed filter
        let input = json!({
            "filter": "completed"
        });
        let result = tool.execute(input).await.unwrap();
        let tasks = result.get("tasks").unwrap().as_array().unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].get("content").unwrap().as_str().unwrap(), "Task 3");
    }

    #[tokio::test]
    async fn test_todoread_no_file() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        let tool = TodoReadTool::new(workspace.clone());
        let input = json!({});

        let result = tool.execute(input).await.unwrap();
        let tasks = result.get("tasks").unwrap().as_array().unwrap();
        
        assert_eq!(tasks.len(), 0);
        assert!(result.get("message").unwrap().as_str().unwrap().contains("No TODO.md"));
    }
}
