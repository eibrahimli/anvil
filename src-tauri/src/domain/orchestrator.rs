use crate::domain::agent::Agent;
use crate::domain::models::{AgentRole, ModelId, Message, Role};
use crate::domain::ports::ModelAdapter;
use futures::stream::{FuturesUnordered, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};
use uuid::Uuid;

const TASK_EXECUTION_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExecutionMode {
    Sequential,
    Parallel,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum GroupExecutionMode {
    Sequential,
    Parallel,
}

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
    pub preferred_agent: Option<Uuid>,
    pub group_id: Option<String>,
    pub group_mode: Option<GroupExecutionMode>,
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
    pub active_tasks: HashSet<Uuid>,
    pub cancellation_requested: HashSet<Uuid>,
    pub last_assigned_agent: Option<Uuid>,
}

pub struct Orchestrator {
    agents: Arc<Mutex<HashMap<Uuid, Arc<tokio::sync::Mutex<Agent>>>>>,
    agent_roles: Arc<Mutex<HashMap<Uuid, AgentRole>>>,
    execution_mode: Arc<Mutex<ExecutionMode>>,
    context: Arc<Mutex<SharedContext>>,
}

impl Clone for Orchestrator {
    fn clone(&self) -> Self {
        Self {
            agents: Arc::clone(&self.agents),
            agent_roles: Arc::clone(&self.agent_roles),
            execution_mode: Arc::clone(&self.execution_mode),
            context: Arc::clone(&self.context),
        }
    }
}

impl Orchestrator {
    pub fn new(workspace_path: std::path::PathBuf) -> Self {
        Self {
            agents: Arc::new(Mutex::new(HashMap::new())),
            agent_roles: Arc::new(Mutex::new(HashMap::new())),
            execution_mode: Arc::new(Mutex::new(ExecutionMode::Parallel)),
            context: Arc::new(Mutex::new(SharedContext {
                workspace_path,
                task_queue: VecDeque::new(),
                agent_results: HashMap::new(),
                active_task: None,
                active_tasks: HashSet::new(),
                cancellation_requested: HashSet::new(),
                last_assigned_agent: None,
            })),
        }
    }

    pub async fn add_agent(
        &self,
        agent_id: Uuid,
        role: AgentRole,
        model_id: ModelId,
        model: Arc<dyn ModelAdapter>,
        tools: Vec<Arc<dyn crate::domain::ports::Tool>>,
        initial_mode: crate::domain::models::AgentMode,
    ) -> Result<(), String> {
        let workspace_path = {
            let ctx = self.context.lock().await;
            ctx.workspace_path.clone()
        };

        let mut config_manager = crate::config::ConfigManager::new();
        let _ = config_manager.load(Some(&workspace_path));
        let config = config_manager.config();
        let permission_manager = Arc::new(tokio::sync::Mutex::new(config.permission.clone()));

        let session = crate::domain::models::AgentSession {
            id: agent_id,
            workspace_path,
            model: model_id,
            mode: initial_mode,
            messages: vec![],
            permissions: crate::domain::models::AgentPermissions {
                config: config.permission.clone(),
            },
        };

        let agent = Agent::new(session, model, tools, permission_manager, None, None);
        let mut agents = self.agents.lock().await;
        agents.insert(agent_id, Arc::new(tokio::sync::Mutex::new(agent)));
        drop(agents);

        let mut roles = self.agent_roles.lock().await;
        roles.insert(agent_id, role);
        Ok(())
    }

    pub async fn create_task(
        &self,
        description: String,
        dependencies: Vec<Uuid>,
        preferred_agent: Option<Uuid>,
        group_id: Option<String>,
        group_mode: Option<GroupExecutionMode>,
    ) -> Uuid {
        let task_id = Uuid::new_v4();
        let task = Task {
            id: task_id,
            description,
            preferred_agent,
            group_id,
            group_mode,
            assigned_to: None,
            status: TaskStatus::Pending,
            dependencies,
            result: None,
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        let mut ctx = self.context.lock().await;
        ctx.task_queue.push_back(task);
        task_id
    }

    pub async fn remove_agent(&self, agent_id: Uuid) -> Result<(), String> {
        {
            let ctx = self.context.lock().await;
            let has_running = ctx.task_queue.iter().any(|task| {
                task.status == TaskStatus::InProgress && task.assigned_to == Some(agent_id)
            });
            if has_running {
                return Err("Cannot remove agent while it is executing a task.".to_string());
            }
        }

        let mut agents = self.agents.lock().await;
        if agents.remove(&agent_id).is_none() {
            return Err("Agent not found".to_string());
        }
        drop(agents);

        let mut roles = self.agent_roles.lock().await;
        roles.remove(&agent_id);
        Ok(())
    }

    pub async fn cancel_task(&self, task_id: Uuid) -> Result<(), String> {
        let mut ctx = self.context.lock().await;
        let Some(pos) = ctx.task_queue.iter().position(|task| task.id == task_id) else {
            return Err("Task not found".to_string());
        };

        let task = &mut ctx.task_queue[pos];
        match task.status {
            TaskStatus::Pending => {
                task.status = TaskStatus::Failed;
                task.result = Some("Cancelled by user before execution.".to_string());
                Ok(())
            }
            TaskStatus::InProgress => {
                task.status = TaskStatus::Failed;
                task.result = Some("Cancelled by user while task was running.".to_string());
                ctx.cancellation_requested.insert(task_id);
                ctx.active_tasks.remove(&task_id);
                if ctx.active_task == Some(task_id) {
                    ctx.active_task = ctx.active_tasks.iter().next().copied();
                }
                Ok(())
            }
            TaskStatus::Completed => Err("Cannot cancel a completed task.".to_string()),
            TaskStatus::Failed => Err("Task is already failed/cancelled.".to_string()),
        }
    }

    pub async fn retry_task(&self, task_id: Uuid) -> Result<(), String> {
        let mut ctx = self.context.lock().await;
        if ctx.cancellation_requested.contains(&task_id) {
            return Err("Task cancellation is still being processed. Please wait and retry.".to_string());
        }
        let Some(pos) = ctx.task_queue.iter().position(|task| task.id == task_id) else {
            return Err("Task not found".to_string());
        };

        let task = &mut ctx.task_queue[pos];
        if task.status != TaskStatus::Failed {
            return Err("Only failed tasks can be retried.".to_string());
        }

        task.status = TaskStatus::Pending;
        task.result = None;
        task.assigned_to = None;
        ctx.cancellation_requested.remove(&task_id);
        Ok(())
    }

    pub async fn process_tasks(&self) -> Result<Vec<String>, String> {
        let mut results = Vec::new();
        let max_parallel = self.max_parallel_tasks().await;
        let mut running = FuturesUnordered::new();

        loop {
            while running.len() < max_parallel {
                let next_task = self.reserve_next_ready_task().await;
                let Some((task_id, description, preferred_agent)) = next_task else {
                    break;
                };

                let assigned_agent = self
                    .select_agent_for_task(&description, preferred_agent)
                    .await;
                self.assign_task(task_id, assigned_agent).await;

                let orchestrator = self.clone();
                running.push(async move {
                    let result = orchestrator.execute_task(task_id, &description).await;
                    (task_id, result)
                });
            }

            if running.is_empty() {
                break;
            }

            if let Some((task_id, result)) = running.next().await {
                let final_result = self.finalize_task(task_id, result).await;
                results.push(final_result);
            }
        }

        Ok(results)
    }

    async fn max_parallel_tasks(&self) -> usize {
        let mode = {
            let guard = self.execution_mode.lock().await;
            guard.clone()
        };
        if mode == ExecutionMode::Sequential {
            return 1;
        }
        let agents = self.agents.lock().await;
        let count = agents.len().max(1);
        count.min(8)
    }

    pub async fn set_execution_mode(&self, mode: ExecutionMode) {
        let mut guard = self.execution_mode.lock().await;
        *guard = mode;
    }

    pub async fn get_execution_mode(&self) -> ExecutionMode {
        let guard = self.execution_mode.lock().await;
        guard.clone()
    }

    async fn reserve_next_ready_task(&self) -> Option<(Uuid, String, Option<Uuid>)> {
        let mut ctx = self.context.lock().await;
        let ready_pos = ctx.task_queue.iter().position(|task| {
            if task.status != TaskStatus::Pending {
                return false;
            }

            let dependencies_ready = task.dependencies.iter().all(|dep_id| {
                ctx.task_queue
                    .iter()
                    .any(|t| t.id == *dep_id && t.status == TaskStatus::Completed)
            });
            if !dependencies_ready {
                return false;
            }

            let Some(group_id) = task.group_id.as_ref() else {
                return true;
            };
            let Some(group_mode) = task.group_mode.as_ref() else {
                return true;
            };
            if !matches!(group_mode, GroupExecutionMode::Sequential) {
                return true;
            }

            for other in ctx.task_queue.iter() {
                if other.id == task.id {
                    break;
                }
                if other.group_id.as_ref() != Some(group_id) {
                    continue;
                }
                if !matches!(other.group_mode, Some(GroupExecutionMode::Sequential)) {
                    continue;
                }
                if !matches!(other.status, TaskStatus::Completed | TaskStatus::Failed) {
                    return false;
                }
            }

            true
        })?;

        let task_id = ctx.task_queue[ready_pos].id;
        let description = ctx.task_queue[ready_pos].description.clone();
        let preferred_agent = ctx.task_queue[ready_pos].preferred_agent.clone();

        if let Some(pos) = ctx.task_queue.iter().position(|task| task.id == task_id) {
            ctx.task_queue[pos].status = TaskStatus::InProgress;
            ctx.task_queue[pos].assigned_to = None;
            ctx.active_tasks.insert(task_id);
            if ctx.active_task.is_none() {
                ctx.active_task = Some(task_id);
            }
            Some((task_id, description, preferred_agent))
        } else {
            None
        }
    }

    async fn select_agent_for_task(
        &self,
        description: &str,
        preferred_agent: Option<Uuid>,
    ) -> Option<Uuid> {
        if let Some(preferred) = preferred_agent {
            let agents = self.agents.lock().await;
            if agents.contains_key(&preferred) {
                return Some(preferred);
            }
        }

        self.find_best_agent_for_task(description).await
    }

    async fn assign_task(&self, task_id: Uuid, assigned_agent: Option<Uuid>) {
        let mut ctx = self.context.lock().await;
        if let Some(pos) = ctx.task_queue.iter().position(|task| task.id == task_id) {
            ctx.task_queue[pos].assigned_to = assigned_agent;
        }
    }

    async fn finalize_task(&self, task_id: Uuid, result: Result<String, String>) -> String {
        let mut ctx = self.context.lock().await;
        let mut final_output = result.clone().unwrap_or_else(|e| e);
        let was_cancelled = ctx.cancellation_requested.remove(&task_id);
        if let Some(pos) = ctx.task_queue.iter().position(|task| task.id == task_id) {
            if was_cancelled {
                ctx.task_queue[pos].status = TaskStatus::Failed;
                if ctx.task_queue[pos].result.is_none() {
                    ctx.task_queue[pos].result = Some("Cancelled by user while task was running.".to_string());
                }
                final_output = ctx.task_queue[pos]
                    .result
                    .clone()
                    .unwrap_or_else(|| "Cancelled by user while task was running.".to_string());
            } else {
                ctx.task_queue[pos].status = match result.as_ref() {
                    Ok(_) => TaskStatus::Completed,
                    Err(_) => TaskStatus::Failed,
                };
                ctx.task_queue[pos].result = Some(final_output.clone());
            }
            ctx.agent_results
                .entry(task_id)
                .or_insert_with(Vec::new)
                .push(Message {
                    role: Role::Assistant,
                    content: if was_cancelled {
                        Some(final_output.clone())
                    } else {
                        result.as_ref().ok().cloned()
                    },
                    tool_calls: None,
                    tool_call_id: None,
                    attachments: None,
                });
            ctx.active_tasks.remove(&task_id);
            if ctx.active_task == Some(task_id) {
                ctx.active_task = ctx.active_tasks.iter().next().copied();
            }
        }
        final_output
    }

    fn score_role_for_description(role: &AgentRole, description: &str) -> i32 {
        let text = description.to_lowercase();
        let has_keyword = |keywords: &[&str]| keywords.iter().any(|keyword| text.contains(keyword));

        let role_score = match role {
            AgentRole::Coder => {
                if has_keyword(&["implement", "build", "feature", "refactor", "code", "develop"]) {
                    7
                } else if has_keyword(&["fix", "issue", "bug", "error"]) {
                    4
                } else {
                    3
                }
            }
            AgentRole::Reviewer => {
                if has_keyword(&["review", "check", "verify", "audit", "quality", "inspect"]) {
                    8
                } else if has_keyword(&["test", "regression", "risk"]) {
                    5
                } else {
                    2
                }
            }
            AgentRole::Planner => {
                if has_keyword(&["plan", "roadmap", "phase", "strategy", "architecture", "scope"]) {
                    8
                } else if has_keyword(&["research", "analyze"]) {
                    5
                } else {
                    2
                }
            }
            AgentRole::Debugger => {
                if has_keyword(&["debug", "fix", "error", "crash", "timeout", "failure", "bug"]) {
                    8
                } else if has_keyword(&["trace", "investigate"]) {
                    5
                } else {
                    3
                }
            }
            AgentRole::Generic => 1,
        };

        role_score
    }

    async fn find_best_agent_for_task(&self, description: &str) -> Option<Uuid> {
        let roles_snapshot = {
            let roles = self.agent_roles.lock().await;
            roles.clone()
        };
        let busy_agents: HashSet<Uuid> = {
            let ctx = self.context.lock().await;
            ctx.task_queue
                .iter()
                .filter(|task| task.status == TaskStatus::InProgress)
                .filter_map(|task| task.assigned_to)
                .collect()
        };

        if roles_snapshot.is_empty() {
            return None;
        }

        let mut scored: Vec<(Uuid, i32)> = roles_snapshot
            .iter()
            .filter(|(id, _)| !busy_agents.contains(id))
            .map(|(id, role)| (*id, Self::score_role_for_description(role, description)))
            .collect();
        if scored.is_empty() {
            scored = roles_snapshot
                .iter()
                .map(|(id, role)| (*id, Self::score_role_for_description(role, description)))
                .collect();
        }
        let best_score = scored.iter().map(|(_, score)| *score).max()?;

        let mut candidates: Vec<Uuid> = scored
            .into_iter()
            .filter(|(_, score)| *score == best_score)
            .map(|(id, _)| id)
            .collect();

        if candidates.is_empty() {
            return None;
        }

        candidates.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));

        let mut ctx = self.context.lock().await;
        let selected = match ctx.last_assigned_agent {
            Some(last) => {
                if let Some(position) = candidates.iter().position(|candidate| *candidate == last) {
                    candidates
                        .get((position + 1) % candidates.len())
                        .copied()
                        .unwrap_or(candidates[0])
                } else {
                    candidates[0]
                }
            }
            None => candidates[0],
        };

        ctx.last_assigned_agent = Some(selected);
        Some(selected)
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
                match timeout(
                    Duration::from_secs(TASK_EXECUTION_TIMEOUT_SECS),
                    agent.step(Some(description.to_string()), None),
                )
                .await
                {
                    Ok(result) => result,
                    Err(_) => Err(format!(
                        "Task timed out after {} seconds while waiting for model response or approval.",
                        TASK_EXECUTION_TIMEOUT_SECS
                    )),
                }
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
