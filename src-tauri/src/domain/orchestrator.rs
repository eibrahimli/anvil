use crate::domain::agent::Agent;
use crate::domain::models::{AgentRole, ModelId, Message, Role};
use crate::domain::ports::ModelAdapter;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: Uuid,
    pub description: String,
    pub assigned_to: Option<Uuid>,
    pub status: TaskStatus,
    pub dependencies: Vec<Uuid>,
    pub result: Option<String>,
    pub created_at: String,
}

pub struct SharedContext {
    pub workspace_path: std::path::PathBuf,
    pub task_queue: VecDeque<Task>,
    pub agent_results: HashMap<Uuid, Vec<Message>>,
    pub active_task: Option<Uuid>,
}

pub struct Orchestrator {
    agents: Arc<Mutex<HashMap<Uuid, Arc<tokio::sync::Mutex<Agent>>>>>,
    context: Arc<Mutex<SharedContext>>,
}

impl Clone for Orchestrator {
    fn clone(&self) -> Self {
        Self {
            agents: Arc::clone(&self.agents),
            context: Arc::clone(&self.context),
        }
    }
}

impl Orchestrator {
    pub fn new(workspace_path: std::path::PathBuf) -> Self {
        Self {
            agents: Arc::new(Mutex::new(HashMap::new())),
            context: Arc::new(Mutex::new(SharedContext {
                workspace_path,
                task_queue: VecDeque::new(),
                agent_results: HashMap::new(),
                active_task: None,
            })),
        }
    }

    pub async fn add_agent(
        &self,
        agent_id: Uuid,
        role: AgentRole,
        model: Arc<dyn ModelAdapter>,
        tools: Vec<Arc<dyn crate::domain::ports::Tool>>,
        initial_mode: crate::domain::models::AgentMode,
    ) -> Result<(), String> {
        let session = crate::domain::models::AgentSession {
            id: agent_id,
            workspace_path: {
                let ctx = self.context.lock().await;
                ctx.workspace_path.clone()
            },
            model: ModelId("default".to_string()),
            mode: initial_mode,
            messages: vec![],
            permissions: crate::domain::models::AgentPermissions {
                allowed: std::collections::HashSet::new(),
            },
        };

        let agent = Agent::new(session, model, tools);
        let mut agents = self.agents.lock().await;
        agents.insert(agent_id, Arc::new(tokio::sync::Mutex::new(agent)));
        Ok(())
    }

    pub async fn create_task(&self, description: String) -> Uuid {
        let task_id = Uuid::new_v4();
        let task = Task {
            id: task_id,
            description,
            assigned_to: None,
            status: TaskStatus::Pending,
            dependencies: vec![],
            result: None,
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        let mut ctx = self.context.lock().await;
        ctx.task_queue.push_back(task);
        task_id
    }

    pub async fn process_tasks(&self) -> Result<Vec<String>, String> {
        let mut results = Vec::new();

        loop {
            let task_opt: Option<(Uuid, String)> = {
                let ctx = self.context.lock().await;
                let ready_task = ctx.task_queue.iter().find(|task| {
                    task.status == TaskStatus::Pending
                        && task.dependencies.iter().all(|dep_id| {
                            ctx.task_queue.iter().any(|t| t.id == *dep_id && t.status == TaskStatus::Completed)
                        })
                });
                
                ready_task.map(|task| (task.id, task.description.clone()))
            };

            match task_opt {
                Some((task_id, description)) => {
                    {
                        let mut ctx = self.context.lock().await;
                        if let Some(pos) = ctx.task_queue.iter().position(|t| t.id == task_id) {
                            ctx.task_queue[pos].status = TaskStatus::InProgress;
                            ctx.task_queue[pos].assigned_to = self.find_best_agent_for_task(&ctx.task_queue[pos]).await;
                            ctx.active_task = Some(task_id);
                        }
                    }
                    
                    let result = self.execute_task(task_id, &description).await;

                    {
                        let mut ctx = self.context.lock().await;
                        if let Some(pos) = ctx.task_queue.iter().position(|t| t.id == task_id) {
                            ctx.task_queue[pos].status = match result.as_ref() {
                                Ok(_) => TaskStatus::Completed,
                                Err(_) => TaskStatus::Failed,
                            };
                            ctx.task_queue[pos].result = Some(result.clone().unwrap_or_else(|e| e.clone()));
                            ctx.agent_results.entry(task_id).or_insert_with(Vec::new).push(Message {
                                role: Role::Assistant,
                                content: result.clone().ok(),
                                tool_calls: None,
                                tool_call_id: None,
                            });
                            ctx.active_task = None;
                        }
                    }

                    results.push(result.unwrap_or_else(|e| e));
                }
                None => {
                    break;
                }
            }
        }

        Ok(results)
    }

    async fn find_best_agent_for_task(&self, _task: &Task) -> Option<Uuid> {
        let agents = self.agents.lock().await;
        agents.keys().next().copied()
    }

    async fn execute_task(&self, task_id: Uuid, description: &str) -> Result<String, String> {
        let agent_id_option = {
            let ctx = self.context.lock().await;
            ctx.task_queue.iter()
                .find(|t| t.id == task_id)
                .and_then(|t| t.assigned_to)
        };

        match agent_id_option {
            Some(id) => {
                let agent_arc = {
                    let agents = self.agents.lock().await;
                    agents.get(&id).cloned().ok_or_else(|| format!("Agent not found: {}", id))?
                };
                let mut agent = agent_arc.lock().await;
                agent.step(Some(description.to_string())).await
            }
            None => {
                Ok(format!("Task '{}' executed (no agent assigned)", description))
            }
        }
    }

    pub async fn get_agent_results(&self, task_id: Uuid) -> Option<Vec<Message>> {
        let ctx = self.context.lock().await;
        ctx.agent_results.get(&task_id).cloned()
    }

    pub async fn get_task_status(&self, task_id: Uuid) -> Option<TaskStatus> {
        let ctx = self.context.lock().await;
        ctx.task_queue.iter().find(|t| t.id == task_id).map(|t| t.status.clone())
    }

    pub async fn get_all_tasks(&self) -> Vec<Task> {
        let ctx = self.context.lock().await;
        ctx.task_queue.iter().cloned().collect()
    }
}
