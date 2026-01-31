use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::PathBuf;
use tokio::fs;
use chrono::Local;

pub struct TodoWriteTool {
    pub workspace_root: PathBuf,
}

impl TodoWriteTool {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }

    fn get_todo_path(&self) -> PathBuf {
        self.workspace_root.join(".anvil").join("TODO.md")
    }
}

#[derive(Debug, Clone)]
struct Task {
    id: String,
    content: String,
    status: TaskStatus,
    priority: Priority,
    _created_at: String,
}

#[derive(Debug, Clone, PartialEq)]
enum TaskStatus {
    Pending,
    InProgress,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq)]
enum Priority {
    Low,
    Medium,
    High,
}

impl TodoWriteTool {
    async fn read_todo_file(&self) -> Result<Vec<Task>, String> {
        let todo_path = self.get_todo_path();
        
        if !todo_path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&todo_path).await
            .map_err(|e| format!("Failed to read TODO.md: {}", e))?;

        Ok(parse_todo_markdown(&content))
    }

    async fn write_todo_file(&self, tasks: &[Task]) -> Result<(), String> {
        let todo_dir = self.workspace_root.join(".anvil");
        let todo_path = todo_dir.join("TODO.md");

        // Ensure .anvil directory exists
        if !todo_dir.exists() {
            fs::create_dir_all(&todo_dir).await
                .map_err(|e| format!("Failed to create .anvil directory: {}", e))?;
        }

        let content = format_todo_markdown(tasks);
        
        fs::write(&todo_path, content).await
            .map_err(|e| format!("Failed to write TODO.md: {}", e))?;

        Ok(())
    }
}

#[async_trait]
impl Tool for TodoWriteTool {
    fn name(&self) -> &'static str {
        "todowrite"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "todowrite",
            "description": "Manage task list by adding, updating, or deleting tasks. Tasks are persisted to .anvil/TODO.md in a human-readable Markdown format. Use this to track progress on multi-step projects.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "description": "Action to perform: 'add', 'update', 'delete', 'clear'",
                        "enum": ["add", "update", "delete", "clear"]
                    },
                    "id": {
                        "type": "string",
                        "description": "Task ID (required for update/delete)"
                    },
                    "content": {
                        "type": "string",
                        "description": "Task description/content"
                    },
                    "status": {
                        "type": "string",
                        "description": "Task status: 'pending', 'in_progress', 'completed', 'cancelled'",
                        "enum": ["pending", "in_progress", "completed", "cancelled"]
                    },
                    "priority": {
                        "type": "string",
                        "description": "Task priority: 'low', 'medium', 'high'",
                        "enum": ["low", "medium", "high"],
                        "default": "medium"
                    }
                },
                "required": ["action"]
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let action = input.get("action")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'action' parameter")?;

        // Security check: ensure workspace_root is valid
        if !self.workspace_root.exists() {
            return Err("Workspace does not exist".to_string());
        }

        match action {
            "add" => {
                let content = input.get("content")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'content' parameter for add action")?;

                let priority_str = input.get("priority")
                    .and_then(|v| v.as_str())
                    .unwrap_or("medium");

                let priority = match priority_str {
                    "low" => Priority::Low,
                    "high" => Priority::High,
                    _ => Priority::Medium,
                };

                let mut tasks = self.read_todo_file().await?;
                
                // Generate ID based on current max + 1
                let max_id = tasks.iter()
                    .filter_map(|t| t.id.parse::<u32>().ok())
                    .max()
                    .unwrap_or(0);
                let id = (max_id + 1).to_string();

                let task = Task {
                    id: id.clone(),
                    content: content.to_string(),
                    status: TaskStatus::Pending,
                    priority,
                    _created_at: Local::now().format("%Y-%m-%d").to_string(),
                };

                tasks.push(task);
                self.write_todo_file(&tasks).await?;

                Ok(json!({
                    "action": "add",
                    "id": id,
                    "content": content,
                    "status": "pending",
                    "total_tasks": tasks.len()
                }))
            }

            "update" => {
                let id = input.get("id")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'id' parameter for update action")?;

                let mut tasks = self.read_todo_file().await?;
                
                let task_idx = tasks.iter()
                    .position(|t| t.id == id)
                    .ok_or(format!("Task {} not found", id))?;

                // Update fields if provided
                if let Some(content) = input.get("content").and_then(|v| v.as_str()) {
                    tasks[task_idx].content = content.to_string();
                }

                if let Some(status_str) = input.get("status").and_then(|v| v.as_str()) {
                    tasks[task_idx].status = match status_str {
                        "in_progress" => TaskStatus::InProgress,
                        "completed" => TaskStatus::Completed,
                        "cancelled" => TaskStatus::Cancelled,
                        _ => TaskStatus::Pending,
                    };
                }

                if let Some(priority_str) = input.get("priority").and_then(|v| v.as_str()) {
                    tasks[task_idx].priority = match priority_str {
                        "low" => Priority::Low,
                        "high" => Priority::High,
                        _ => Priority::Medium,
                    };
                }

                self.write_todo_file(&tasks).await?;

                Ok(json!({
                    "action": "update",
                    "id": id,
                    "status": format!("{:?}", tasks[task_idx].status),
                    "total_tasks": tasks.len()
                }))
            }

            "delete" => {
                let id = input.get("id")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'id' parameter for delete action")?;

                let mut tasks = self.read_todo_file().await?;
                
                let initial_len = tasks.len();
                tasks.retain(|t| t.id != id);
                
                if tasks.len() == initial_len {
                    return Err(format!("Task {} not found", id));
                }

                self.write_todo_file(&tasks).await?;

                Ok(json!({
                    "action": "delete",
                    "id": id,
                    "total_tasks": tasks.len()
                }))
            }

            "clear" => {
                self.write_todo_file(&[]).await?;

                Ok(json!({
                    "action": "clear",
                    "total_tasks": 0
                }))
            }

            _ => Err(format!("Unknown action: {}", action)),
        }
    }
}

fn parse_todo_markdown(content: &str) -> Vec<Task> {
    let mut tasks = Vec::new();
    let mut current_status = TaskStatus::Pending;

    for line in content.lines() {
        let trimmed = line.trim();
        
        // Parse section headers
        if trimmed.starts_with("##") {
            if trimmed.contains("In Progress") {
                current_status = TaskStatus::InProgress;
            } else if trimmed.contains("Completed") {
                current_status = TaskStatus::Completed;
            } else if trimmed.contains("Cancelled") {
                current_status = TaskStatus::Cancelled;
            } else {
                current_status = TaskStatus::Pending;
            }
            continue;
        }

        // Parse task lines: "- [ ] Task content (PRIORITY) - ID: 1"
        if trimmed.starts_with("- [") || trimmed.starts_with("- [x]") {
            let checked = trimmed.starts_with("- [x]");
            
            // Extract content between brackets and end of line
            if let Some(content_start) = trimmed.find("] ") {
                let task_content = &trimmed[content_start + 2..];
                
                // Parse priority: (HIGH), (MEDIUM), (LOW)
                let priority = if task_content.contains("(HIGH)") {
                    Priority::High
                } else if task_content.contains("(LOW)") {
                    Priority::Low
                } else {
                    Priority::Medium
                };

                // Parse ID: - ID: 1
                let id = if let Some(id_pos) = task_content.find("- ID: ") {
                    task_content[id_pos + 6..].trim().to_string()
                } else {
                    // Generate a simple numeric ID based on count
                    (tasks.len() + 1).to_string()
                };

                // Extract just the content without priority and ID
                let clean_content = task_content
                    .split("(HIGH)").next().unwrap_or(task_content)
                    .split("(MEDIUM)").next().unwrap_or(task_content)
                    .split("(LOW)").next().unwrap_or(task_content)
                    .split(" - ID:").next().unwrap_or(task_content)
                    .trim()
                    .to_string();

                let status = if checked {
                    TaskStatus::Completed
                } else {
                    current_status.clone()
                };

                tasks.push(Task {
                    id,
                    content: clean_content,
                    status,
                    priority,
                    _created_at: Local::now().format("%Y-%m-%d").to_string(),
                });
            }
        }
    }

    tasks
}

fn format_todo_markdown(tasks: &[Task]) -> String {
    let mut output = String::from("# Anvil Tasks\n\n");
    output.push_str("Auto-generated task list for this project.\n\n");

    // Group tasks by status
    let pending: Vec<_> = tasks.iter().filter(|t| t.status == TaskStatus::Pending).collect();
    let in_progress: Vec<_> = tasks.iter().filter(|t| t.status == TaskStatus::InProgress).collect();
    let completed: Vec<_> = tasks.iter().filter(|t| t.status == TaskStatus::Completed).collect();
    let cancelled: Vec<_> = tasks.iter().filter(|t| t.status == TaskStatus::Cancelled).collect();

    // In Progress
    if !in_progress.is_empty() {
        output.push_str("## In Progress\n");
        for task in in_progress {
            let priority_str = match task.priority {
                Priority::High => " (HIGH)",
                Priority::Low => " (LOW)",
                _ => " (MEDIUM)",
            };
            output.push_str(&format!("- [ ] {}{} - ID: {}\n", task.content, priority_str, task.id));
        }
        output.push('\n');
    }

    // Pending
    if !pending.is_empty() {
        output.push_str("## Pending\n");
        for task in pending {
            let priority_str = match task.priority {
                Priority::High => " (HIGH)",
                Priority::Low => " (LOW)",
                _ => " (MEDIUM)",
            };
            output.push_str(&format!("- [ ] {}{} - ID: {}\n", task.content, priority_str, task.id));
        }
        output.push('\n');
    }

    // Completed
    if !completed.is_empty() {
        output.push_str("## Completed\n");
        for task in completed {
            let priority_str = match task.priority {
                Priority::High => " (HIGH)",
                Priority::Low => " (LOW)",
                _ => " (MEDIUM)",
            };
            output.push_str(&format!("- [x] {}{} - ID: {}\n", task.content, priority_str, task.id));
        }
        output.push('\n');
    }

    // Cancelled
    if !cancelled.is_empty() {
        output.push_str("## Cancelled\n");
        for task in cancelled {
            let priority_str = match task.priority {
                Priority::High => " (HIGH)",
                Priority::Low => " (LOW)",
                _ => " (MEDIUM)",
            };
            output.push_str(&format!("- [ ] {}{} - ID: {} [CANCELLED]\n", task.content, priority_str, task.id));
        }
        output.push('\n');
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_todo_add() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        let tool = TodoWriteTool::new(workspace.clone());
        let input = json!({
            "action": "add",
            "content": "Test task",
            "priority": "high"
        });

        let result = tool.execute(input).await.unwrap();
        assert_eq!(result.get("action").unwrap().as_str().unwrap(), "add");
        assert_eq!(result.get("id").unwrap().as_str().unwrap(), "1");
        
        // Verify file was created
        let todo_path = workspace.join(".anvil").join("TODO.md");
        assert!(todo_path.exists());
        
        let content = fs::read_to_string(&todo_path).await.unwrap();
        assert!(content.contains("Test task"));
        assert!(content.contains("(HIGH)"));
    }

    #[tokio::test]
    async fn test_todo_update() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        let tool = TodoWriteTool::new(workspace.clone());
        
        // Add a task first
        let input = json!({
            "action": "add",
            "content": "Task to update"
        });
        let result = tool.execute(input).await.unwrap();
        let id = result.get("id").unwrap().as_str().unwrap();

        // Update it
        let input = json!({
            "action": "update",
            "id": id,
            "status": "completed"
        });
        let result = tool.execute(input).await.unwrap();
        assert_eq!(result.get("action").unwrap().as_str().unwrap(), "update");

        // Verify file contains completed task
        let todo_path = workspace.join(".anvil").join("TODO.md");
        let content = fs::read_to_string(&todo_path).await.unwrap();
        assert!(content.contains("## Completed"));
    }

    #[tokio::test]
    async fn test_todo_delete() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        let tool = TodoWriteTool::new(workspace.clone());
        
        // Add a task
        let input = json!({
            "action": "add",
            "content": "Task to delete"
        });
        let result = tool.execute(input).await.unwrap();
        let id = result.get("id").unwrap().as_str().unwrap();

        // Delete it
        let input = json!({
            "action": "delete",
            "id": id
        });
        let result = tool.execute(input).await.unwrap();
        assert_eq!(result.get("action").unwrap().as_str().unwrap(), "delete");
        assert_eq!(result.get("total_tasks").unwrap().as_i64().unwrap(), 0);
    }

    #[tokio::test]
    async fn test_todo_clear() {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        let tool = TodoWriteTool::new(workspace.clone());
        
        // Add some tasks
        for i in 0..3 {
            let input = json!({
                "action": "add",
                "content": format!("Task {}", i)
            });
            tool.execute(input).await.unwrap();
        }

        // Clear all
        let input = json!({
            "action": "clear"
        });
        let result = tool.execute(input).await.unwrap();
        assert_eq!(result.get("total_tasks").unwrap().as_i64().unwrap(), 0);
    }
}
