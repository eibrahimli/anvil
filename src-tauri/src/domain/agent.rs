use crate::domain::models::*;
use crate::domain::ports::{ModelAdapter, Tool};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc::Sender, oneshot};
use uuid::Uuid;

pub struct Agent {
    pub session: AgentSession,
    model: Arc<dyn ModelAdapter>,
    tools: Vec<Arc<dyn Tool>>,
    pub permission_manager: Arc<tokio::sync::Mutex<crate::config::PermissionConfig>>,
    app: Option<AppHandle>,
    pending_confirmations: Option<Arc<Mutex<HashMap<String, oneshot::Sender<crate::domain::models::ConfirmationResponse>>>>>,
    research_overrides: HashMap<String, crate::config::ToolPermission>,
}

#[derive(Serialize, Clone)]
struct PermissionConfirmationRequest {
    id: String,
    session_id: String,
    #[serde(rename = "type")]
    type_: String,
    tool_name: String,
    input: String,
    suggested_pattern: String,
}

#[derive(Serialize, Clone)]
struct ToolCallEvent {
    session_id: String,
    tool_call_id: String,
    tool_name: String,
    arguments: String,
}

#[derive(Serialize, Clone)]
struct ToolResultEvent {
    session_id: String,
    tool_call_id: String,
    tool_name: String,
    content: String,
}

impl Agent {
    pub fn new(
        session: AgentSession,
        model: Arc<dyn ModelAdapter>,
        tools: Vec<Arc<dyn Tool>>,
        permission_manager: Arc<tokio::sync::Mutex<crate::config::PermissionConfig>>,
        app: Option<AppHandle>,
        pending_confirmations: Option<Arc<Mutex<HashMap<String, oneshot::Sender<crate::domain::models::ConfirmationResponse>>>>>,
    ) -> Self {
        Self {
            session,
            model,
            tools,
            permission_manager,
            app,
            pending_confirmations,
            research_overrides: HashMap::new(),
        }
    }

    pub fn update_model(&mut self, model: Arc<dyn ModelAdapter>, model_id: ModelId) {
        self.model = model;
        self.session.model = model_id;
    }

    pub fn update_mode(&mut self, mode: AgentMode) {
        self.session.mode = mode;
    }

    pub fn get_session(&self) -> AgentSession {
        self.session.clone()
    }

    pub async fn add_permission_rule(&mut self, tool_name: &str, pattern: String, action: crate::config::Action) {
        let mut config = self.permission_manager.lock().await;
        let tool_perm = match tool_name {
            "bash" => &mut config.bash,
            "read_file" | "read" => &mut config.read,
            "write_file" | "write" => &mut config.write,
            "edit_file" | "edit" | "patch" => &mut config.edit,
            "list" => &mut config.list,
            "glob" => &mut config.glob,
            "search" | "grep" => &mut config.grep,
            "webfetch" => &mut config.webfetch,
            "task" => &mut config.task,
            "lsp" => &mut config.lsp,
            "todoread" => &mut config.todoread,
            "todowrite" => &mut config.todowrite,
            "doom_loop" => &mut config.doom_loop,
            "skill" => &mut config.skill,
            _ => return,
        };

        tool_perm.rules.push(crate::config::manager::PermissionRule {
            pattern,
            action,
        });
        
        // Sync back to session for persistence
        self.session.permissions.config = config.clone();
    }

    fn is_research_allowed_tool(tool_name: &str) -> bool {
        matches!(
            tool_name,
            "read_file"
                | "list"
                | "glob"
                | "search"
                | "grep"
                | "lsp"
                | "symbols"
                | "todoread"
                | "webfetch"
        )
    }

    fn research_override_action(&self, tool_name: &str, input: &str) -> crate::config::Action {
        self.research_overrides
            .get(tool_name)
            .map(|perm| perm.evaluate(input))
            .unwrap_or(crate::config::Action::Ask)
    }

    fn add_research_override_rule(&mut self, tool_name: &str, pattern: String) {
        let entry = self
            .research_overrides
            .entry(tool_name.to_string())
            .or_insert_with(crate::config::ToolPermission::default);
        entry.rules.push(crate::config::PermissionRule {
            pattern,
            action: crate::config::Action::Allow,
        });
    }

    pub async fn step(&mut self, user_input: Option<String>, attachments: Option<Vec<Attachment>>) -> Result<String, String> {
        // 1. Add User Message
        if let Some(input) = user_input {
            self.session.messages.push(Message {
                role: Role::User,
                content: Some(input),
                tool_calls: None,
                tool_call_id: None,
                attachments,
            });
        }

        // 2. Build Context
        let context_summary = crate::domain::context::ContextBuilder::build(&self.session.workspace_path);
        
        // Handle Modes (Plan, Build, Research)
        let mode_instruction = match self.session.mode {
            crate::domain::models::AgentMode::Plan => 
                "You are in PLAN mode. Provide a detailed, step-by-step plan for the user's request. DO NOT execute any tools. Just describe what you would do.",
            crate::domain::models::AgentMode::Research => 
                "You are in RESEARCH mode. Prefer read-only tools like read_file, list, glob, search, grep, lsp, symbols, and webfetch. If you need a restricted tool (write, edit, patch, bash, git, task, todowrite, skill), you must ask the user for approval before proceeding.",
            crate::domain::models::AgentMode::Build => 
                "You are in BUILD mode. You are an autonomous coding agent. Execute tools to fulfill the request.",
        };

        // Build skills information for system prompt
        let skills_info = self.build_skills_info().await;
        
        // Find existing system message or prepend one
        let system_msg_idx = self.session.messages.iter().position(|m| m.role == Role::System);
        let system_content = format!(
            "You are Anvil, an advanced AI coding agent.

{}

{}

{}

IMPORTANT RULES:
1. When asked about available tools, ONLY list them. DO NOT execute them.
2. Only execute tools when explicitly requested or when necessary to solve a user task.
3. Never edit or write files unless you are sure the user wants you to modify the codebase.
4. CRITICAL - DO NOT use tools for:
   - Greetings (hello, hi, hey)
   - Small talk or casual conversation
   - Simple questions that don't require file access
   - Questions about your capabilities (unless user asks for tool list)
   - Any message where the user is just chatting
5. Only use tools when:
   - User explicitly asks to read/edit/write a file
   - User asks you to analyze code
   - User asks you to run a command
   - You need to gather context to solve a coding problem
6. If uncertain whether to use tools, respond conversationally without tools.

Previous instructions remain active.",
            mode_instruction,
            context_summary,
            skills_info
        );

        if let Some(idx) = system_msg_idx {
             self.session.messages[idx].content = Some(system_content);
        } else {
             self.session.messages.insert(0, Message {
                 role: Role::System,
                 content: Some(system_content),
                 tool_calls: None,
                 tool_call_id: None,
                 attachments: None,
             });
        }

        // If Plan Mode, skip the tool loop entirely and just chat
        if self.session.mode == crate::domain::models::AgentMode::Plan {
             let req = ChatRequest {
                messages: self.session.messages.clone(),
                model_id: self.session.model.clone(),
                temperature: Some(0.7),
                tools: None, // Disable tools for planning
            };
            let res = self.model.chat(req).await;
            
            self.session.messages.push(Message {
                role: res.role.clone(),
                content: Some(res.content.clone()),
                tool_calls: None,
                tool_call_id: None,
                attachments: None,
            });
            
            return Ok(res.content);
        }

        // 3. Chat Loop (Re-act)
        // Safety limit to prevent infinite loops
        let mut steps = 0;
        const MAX_STEPS: u32 = 10;
        let mut last_signature: Option<String> = None;
        let mut repeat_count: u32 = 0;

        loop {
            if steps >= MAX_STEPS {
                return Ok("⚠️ Agent exceeded maximum steps without final response.".to_string());
            }
            steps += 1;

            // Prepare Request
            // Wrap tool schemas in OpenAI format: { type: "function", function: { ... } }
            let tool_schemas: Vec<Value> = self.tools.iter().map(|t| {
                json!({
                    "type": "function",
                    "function": t.schema()
                })
            }).collect();

            let req = ChatRequest {
                messages: self.session.messages.clone(),
                model_id: self.session.model.clone(),
                temperature: Some(0.0), // Deterministic for tools
                tools: Some(tool_schemas),
            };

            // Call Model
            let res = self.model.chat(req).await;

            // Append Assistant Message
            self.session.messages.push(Message {
                role: res.role.clone(),
                content: Some(res.content.clone()),
                tool_calls: res.tool_calls.clone(),
                tool_call_id: res.tool_call_id.clone(),
                attachments: None,
            });

            // Check for Tool Calls
            if let Some(tool_calls) = res.tool_calls {
                if tool_calls.is_empty() {
                     return Ok(res.content); // Done
                }

                // Execute Tools
                for call in tool_calls {
                    let args: Value = serde_json::from_str(&call.arguments).unwrap_or(json!({}));
                    if self.session.mode == crate::domain::models::AgentMode::Research
                        && !Self::is_research_allowed_tool(&call.name)
                    {
                        let input = Self::permission_input_for_tool(&call.name, &args);
                        let suggested_pattern = Self::suggested_pattern_for_tool(&call.name, &input);
                        let action = self.research_override_action(&call.name, &input);

                        if !matches!(action, crate::config::Action::Allow) {
                            let response = self
                                .request_permission_confirmation("mode", &call.name, &input, suggested_pattern.clone())
                                .await;
                            match response {
                                Ok(resp) if resp.allowed => {
                                    if resp.always {
                                        let pattern = resp.pattern.unwrap_or(suggested_pattern);
                                        self.add_research_override_rule(&call.name, pattern);
                                    }
                                }
                                _ => {
                                    self.session.messages.push(Message {
                                        role: Role::Tool,
                                        content: Some(format!(
                                            "Error: Tool '{}' blocked in RESEARCH mode.",
                                            call.name
                                        )),
                                        tool_calls: None,
                                        tool_call_id: Some(call.id),
                                        attachments: None,
                                    });
                                    continue;
                                }
                            }
                        }
                    }
                    let signature = format!("{}:{}", call.name, call.arguments);
                    if last_signature.as_ref() == Some(&signature) {
                        repeat_count += 1;
                    } else {
                        last_signature = Some(signature.clone());
                        repeat_count = 1;
                    }

                    if repeat_count >= 3 {
                        let action = {
                            let config = self.permission_manager.lock().await;
                            config.doom_loop.evaluate(&signature)
                        };

                        match action {
                            crate::config::Action::Deny => {
                                let result_content = format!("Error: Repeated tool call blocked (doom loop): {}", call.name);
                                self.session.messages.push(Message {
                                    role: Role::Tool,
                                    content: Some(result_content),
                                    tool_calls: None,
                                    tool_call_id: Some(call.id),
                                    attachments: None,
                                });
                                continue;
                            }
                            crate::config::Action::Ask => {
                                let suggested_pattern = format!("{}:*", call.name);
                                let response = self
                                    .request_permission_confirmation("doom_loop", &call.name, &signature, suggested_pattern.clone())
                                    .await;

                                match response {
                                    Ok(resp) if resp.allowed => {
                                        if resp.always {
                                            let pattern = resp.pattern.unwrap_or(suggested_pattern);
                                            self.add_permission_rule("doom_loop", pattern, crate::config::Action::Allow).await;
                                        }
                                    }
                                    _ => {
                                        let result_content = format!("Error: Repeated tool call blocked by user: {}", call.name);
                                        self.session.messages.push(Message {
                                            role: Role::Tool,
                                            content: Some(result_content),
                                            tool_calls: None,
                                            tool_call_id: Some(call.id),
                                            attachments: None,
                                        });
                                        continue;
                                    }
                                }
                            }
                            crate::config::Action::Allow => {}
                        }
                    }

                    let temp_external_rule = match self.ensure_external_directory_access(&call.name, &args).await {
                        Ok(rule) => rule,
                        Err(err) => {
                            self.session.messages.push(Message {
                                role: Role::Tool,
                                content: Some(format!("Error: {}", err)),
                                tool_calls: None,
                                tool_call_id: Some(call.id),
                                attachments: None,
                            });
                            continue;
                        }
                    };

                    let action = self.resolve_tool_action(&call.name, &args).await;

                    if matches!(action, crate::config::Action::Deny) {
                        self.session.messages.push(Message {
                            role: Role::Tool,
                            content: Some(format!("Error: Permission denied for tool '{}'.", call.name)),
                            tool_calls: None,
                            tool_call_id: Some(call.id),
                            attachments: None,
                        });
                        if let Some(pattern) = temp_external_rule {
                            self.remove_external_directory_rule(&pattern).await;
                        }
                        continue;
                    }

                    if matches!(action, crate::config::Action::Ask) && !Self::tool_confirms_internally(&call.name) {
                        let input = Self::permission_input_for_tool(&call.name, &args);
                        let suggested_pattern = Self::suggested_pattern_for_tool(&call.name, &input);
                        let response = self
                            .request_permission_confirmation("permission", &call.name, &input, suggested_pattern.clone())
                            .await;

                        match response {
                            Ok(resp) if resp.allowed => {
                                if resp.always {
                                    let pattern = resp.pattern.unwrap_or(suggested_pattern);
                                    self.add_permission_rule(&call.name, pattern, crate::config::Action::Allow).await;
                                }
                            }
                            _ => {
                                self.session.messages.push(Message {
                                    role: Role::Tool,
                                    content: Some(format!("Error: Permission denied for tool '{}'.", call.name)),
                                    tool_calls: None,
                                    tool_call_id: Some(call.id),
                                    attachments: None,
                                });
                                if let Some(pattern) = temp_external_rule {
                                    self.remove_external_directory_rule(&pattern).await;
                                }
                                continue;
                            }
                        }
                    }

                    let tool = self.tools.iter().find(|t| t.name() == call.name);
                    let result_content = if let Some(tool) = tool {
                        match tool.execute(args).await {
                            Ok(val) => val.to_string(),
                            Err(err) => format!("Error: {}", err),
                        }
                    } else {
                        format!("Error: Tool '{}' not found.", call.name)
                    };

                    if let Some(pattern) = temp_external_rule {
                        self.remove_external_directory_rule(&pattern).await;
                    }

                    // Append Tool Output
                    self.session.messages.push(Message {
                        role: Role::Tool,
                        content: Some(result_content),
                        tool_calls: None,
                        tool_call_id: Some(call.id),
                        attachments: None,
                    });
                }
                // Loop continues to feed tool outputs back to model
            } else {
                // No tools called, return response
                return Ok(res.content);
            }
        }
    }

    pub async fn step_stream(&mut self, user_input: Option<String>, attachments: Option<Vec<Attachment>>, tx: Sender<String>) -> Result<String, String> {
        // 1. Add User Message
        if let Some(input) = user_input {
            self.session.messages.push(Message {
                role: Role::User,
                content: Some(input),
                tool_calls: None,
                tool_call_id: None,
                attachments,
            });
        }

        // 2. Build Context
        let context_summary = crate::domain::context::ContextBuilder::build(&self.session.workspace_path);
        
        // Handle Modes (Plan, Build, Research)
        let mode_instruction = match self.session.mode {
            crate::domain::models::AgentMode::Plan => 
                "You are in PLAN mode. Provide a detailed, step-by-step plan for the user's request. DO NOT execute any tools. Just describe what you would do.",
            crate::domain::models::AgentMode::Research => 
                "You are in RESEARCH mode. Prefer read-only tools like read_file, list, glob, search, grep, lsp, symbols, and webfetch. If you need a restricted tool (write, edit, patch, bash, git, task, todowrite, skill), you must ask the user for approval before proceeding.",
            crate::domain::models::AgentMode::Build => 
                "You are in BUILD mode. You are an autonomous coding agent. Execute tools to fulfill the request.",
        };

        // Build skills information for system prompt
        let skills_info = self.build_skills_info().await;
        
        // Find existing system message or prepend one
        let system_msg_idx = self.session.messages.iter().position(|m| m.role == Role::System);
        let system_content = format!(
            "You are Anvil, an advanced AI coding agent.

{}

{}

{}

IMPORTANT RULES:
1. When asked about available tools, ONLY list them. DO NOT execute them.
2. Only execute tools when explicitly requested or when necessary to solve a user task.
3. Never edit or write files unless you are sure the user wants you to modify the codebase.
4. CRITICAL - DO NOT use tools for:
   - Greetings (hello, hi, hey)
   - Small talk or casual conversation
   - Simple questions that don't require file access
   - Questions about your capabilities (unless user asks for tool list)
   - Any message where the user is just chatting
5. Only use tools when:
   - User explicitly asks to read/edit/write a file
   - User asks you to analyze code
   - User asks you to run a command
   - You need to gather context to solve a coding problem
6. If uncertain whether to use tools, respond conversationally without tools.

Previous instructions remain active.",
            mode_instruction,
            context_summary,
            skills_info
        );

        if let Some(idx) = system_msg_idx {
             self.session.messages[idx].content = Some(system_content);
        } else {
             self.session.messages.insert(0, Message {
                 role: Role::System,
                 content: Some(system_content),
                 tool_calls: None,
                 tool_call_id: None,
                 attachments: None,
             });
        }

        // If Plan Mode, skip the tool loop entirely and just chat
        if self.session.mode == crate::domain::models::AgentMode::Plan {
             let req = ChatRequest {
                messages: self.session.messages.clone(),
                model_id: self.session.model.clone(),
                temperature: Some(0.7),
                tools: None, // Disable tools for planning
            };
            let res = self.model.stream(req, tx).await;
            
            self.session.messages.push(Message {
                role: res.role.clone(),
                content: Some(res.content.clone()),
                tool_calls: None,
                tool_call_id: None,
                attachments: None,
            });
            
            return Ok(res.content);
        }

        // 3. Chat Loop (Re-act)
        // Safety limit to prevent infinite loops
        let mut steps = 0;
        const MAX_STEPS: u32 = 10;
        let mut last_signature: Option<String> = None;
        let mut repeat_count: u32 = 0;

        loop {
            if steps >= MAX_STEPS {
                return Ok("⚠️ Agent exceeded maximum steps without final response.".to_string());
            }
            steps += 1;
            println!("[DEBUG] Agent loop step {}", steps);

            // Prepare Request
            let tool_schemas: Vec<Value> = self.tools.iter().map(|t| {
                json!({
                    "type": "function",
                    "function": t.schema()
                })
            }).collect();

            let req = ChatRequest {
                messages: self.session.messages.clone(),
                model_id: self.session.model.clone(),
                temperature: Some(0.0), // Deterministic for tools
                tools: Some(tool_schemas),
            };

            // Call Model via Stream
            println!("[DEBUG] Calling model with {} messages", self.session.messages.len());
            let res = self.model.stream(req, tx.clone()).await;
            println!("[DEBUG] Model returned, has {} tool calls", res.tool_calls.as_ref().map(|t| t.len()).unwrap_or(0));

            // Append Assistant Message
            self.session.messages.push(Message {
                role: res.role.clone(),
                content: Some(res.content.clone()),
                tool_calls: res.tool_calls.clone(),
                tool_call_id: res.tool_call_id.clone(),
                attachments: None,
            });

            // Check for Tool Calls
            if let Some(ref tool_calls) = res.tool_calls {
                println!("[DEBUG] Processing {} tool calls", tool_calls.len());
                if tool_calls.is_empty() {
                     println!("[DEBUG] No tool calls, returning response");
                     return Ok(res.content); // Done
                }

                // Execute Tools
                for call in tool_calls {
                    self.emit_tool_call(call);

                    let args: Value = serde_json::from_str(&call.arguments).unwrap_or(json!({}));
                    if self.session.mode == crate::domain::models::AgentMode::Research
                        && !Self::is_research_allowed_tool(&call.name)
                    {
                        let input = Self::permission_input_for_tool(&call.name, &args);
                        let suggested_pattern = Self::suggested_pattern_for_tool(&call.name, &input);
                        let action = self.research_override_action(&call.name, &input);

                        if !matches!(action, crate::config::Action::Allow) {
                            let response = self
                                .request_permission_confirmation("mode", &call.name, &input, suggested_pattern.clone())
                                .await;
                            match response {
                                Ok(resp) if resp.allowed => {
                                    if resp.always {
                                        let pattern = resp.pattern.unwrap_or(suggested_pattern);
                                        self.add_research_override_rule(&call.name, pattern);
                                    }
                                }
                                _ => {
                                    let err_msg = format!(
                                        "Error: Tool '{}' blocked in RESEARCH mode.",
                                        call.name
                                    );
                                    self.emit_tool_result(&call.id, &call.name, &err_msg);
                                    self.session.messages.push(Message {
                                        role: Role::Tool,
                                        content: Some(err_msg),
                                        tool_calls: None,
                                        tool_call_id: Some(call.id.clone()),
                                        attachments: None,
                                    });
                                    continue;
                                }
                            }
                        }
                    }
                    let signature = format!("{}:{}", call.name, call.arguments);
                    if last_signature.as_ref() == Some(&signature) {
                        repeat_count += 1;
                    } else {
                        last_signature = Some(signature.clone());
                        repeat_count = 1;
                    }

                    if repeat_count >= 3 {
                        let action = {
                            let config = self.permission_manager.lock().await;
                            config.doom_loop.evaluate(&signature)
                        };

                        match action {
                            crate::config::Action::Deny => {
                                let err_msg = format!("Error: Repeated tool call blocked (doom loop): {}", call.name);
                                self.emit_tool_result(&call.id, &call.name, &err_msg);
                                self.session.messages.push(Message {
                                    role: Role::Tool,
                                    content: Some(err_msg),
                                    tool_calls: None,
                                    tool_call_id: Some(call.id.clone()),
                                    attachments: None,
                                });
                                continue;
                            }
                            crate::config::Action::Ask => {
                                let suggested_pattern = format!("{}:*", call.name);
                                let response = self
                                    .request_permission_confirmation("doom_loop", &call.name, &signature, suggested_pattern.clone())
                                    .await;

                                match response {
                                    Ok(resp) if resp.allowed => {
                                        if resp.always {
                                            let pattern = resp.pattern.unwrap_or(suggested_pattern);
                                            self.add_permission_rule("doom_loop", pattern, crate::config::Action::Allow).await;
                                        }
                                    }
                                    _ => {
                                        let err_msg = format!("Error: Repeated tool call blocked by user: {}", call.name);
                                        self.emit_tool_result(&call.id, &call.name, &err_msg);
                                        self.session.messages.push(Message {
                                            role: Role::Tool,
                                            content: Some(err_msg),
                                            tool_calls: None,
                                            tool_call_id: Some(call.id.clone()),
                                            attachments: None,
                                        });
                                        continue;
                                    }
                                }
                            }
                            crate::config::Action::Allow => {}
                        }
                    }

                    let temp_external_rule = match self.ensure_external_directory_access(&call.name, &args).await {
                        Ok(rule) => rule,
                        Err(err) => {
                            let err_msg = format!("Error: {}", err);
                            self.emit_tool_result(&call.id, &call.name, &err_msg);
                            self.session.messages.push(Message {
                                role: Role::Tool,
                                content: Some(err_msg),
                                tool_calls: None,
                                tool_call_id: Some(call.id.clone()),
                                attachments: None,
                            });
                            continue;
                        }
                    };

                    let action = self.resolve_tool_action(&call.name, &args).await;

                    if matches!(action, crate::config::Action::Deny) {
                        let err_msg = format!("Error: Permission denied for tool '{}'.", call.name);
                        self.emit_tool_result(&call.id, &call.name, &err_msg);
                        self.session.messages.push(Message {
                            role: Role::Tool,
                            content: Some(err_msg),
                            tool_calls: None,
                            tool_call_id: Some(call.id.clone()),
                            attachments: None,
                        });
                        if let Some(pattern) = temp_external_rule {
                            self.remove_external_directory_rule(&pattern).await;
                        }
                        continue;
                    }

                    if matches!(action, crate::config::Action::Ask) && !Self::tool_confirms_internally(&call.name) {
                        let input = Self::permission_input_for_tool(&call.name, &args);
                        let suggested_pattern = Self::suggested_pattern_for_tool(&call.name, &input);
                        let response = self
                            .request_permission_confirmation("permission", &call.name, &input, suggested_pattern.clone())
                            .await;

                        match response {
                            Ok(resp) if resp.allowed => {
                                if resp.always {
                                    let pattern = resp.pattern.unwrap_or(suggested_pattern);
                                    self.add_permission_rule(&call.name, pattern, crate::config::Action::Allow).await;
                                }
                            }
                            _ => {
                                let err_msg = format!("Error: Permission denied for tool '{}'.", call.name);
                                self.emit_tool_result(&call.id, &call.name, &err_msg);
                                self.session.messages.push(Message {
                                    role: Role::Tool,
                                    content: Some(err_msg),
                                    tool_calls: None,
                                    tool_call_id: Some(call.id.clone()),
                                    attachments: None,
                                });
                                if let Some(pattern) = temp_external_rule {
                                    self.remove_external_directory_rule(&pattern).await;
                                }
                                continue;
                            }
                        }
                    }

                    let tool = self.tools.iter().find(|t| t.name() == call.name);
                    let result_content = if let Some(tool) = tool {
                        match tool.execute(args).await {
                            Ok(val) => val.to_string(),
                            Err(err) => format!("Error: {}", err),
                        }
                    } else {
                        format!("Error: Tool '{}' not found.", call.name)
                    };

                    if let Some(pattern) = temp_external_rule {
                        self.remove_external_directory_rule(&pattern).await;
                    }

                    self.emit_tool_result(&call.id, &call.name, &result_content);

                    // Append Tool Output
                    self.session.messages.push(Message {
                        role: Role::Tool,
                        content: Some(result_content),
                        tool_calls: None,
                        tool_call_id: Some(call.id.clone()),
                        attachments: None,
                    });
                    
                    println!("[DEBUG] Tool '{}' executed, continuing loop", call.name);
                }
                // Loop continues to feed tool outputs back to model
            } else {
                // No tools called, return response
                return Ok(res.content);
            }

        }
    }

    fn tool_confirms_internally(tool_name: &str) -> bool {
        matches!(tool_name, "bash" | "write_file" | "edit_file" | "read_file" | "lsp" | "skill")
    }

    fn normalize_path(path: &Path) -> PathBuf {
        let mut normalized = PathBuf::new();
        for component in path.components() {
            match component {
                std::path::Component::CurDir => {}
                std::path::Component::ParentDir => {
                    normalized.pop();
                }
                _ => normalized.push(component),
            }
        }
        normalized
    }

    fn canonicalize_or_normalize(path: &Path) -> PathBuf {
        std::fs::canonicalize(path).unwrap_or_else(|_| Self::normalize_path(path))
    }

    fn permission_input_for_tool(tool_name: &str, args: &Value) -> String {
        match tool_name {
            "bash" => args.get("command").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            "read_file" | "write_file" | "edit_file" => args.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            "patch" => args.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            "list" => args.get("path").and_then(|v| v.as_str()).unwrap_or(".").to_string(),
            "glob" => args.get("pattern").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            "search" => args.get("pattern").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            "webfetch" => args.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            "lsp" => args.get("request").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            "task" => args.get("subagent_type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            "todoread" => args.get("filter").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            "todowrite" => args.get("action").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            "skill" => args.get("skill_name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            _ => String::new(),
        }
    }

    fn suggested_pattern_for_tool(tool_name: &str, input: &str) -> String {
        if input.is_empty() {
            return format!("{}*", tool_name);
        }

        match tool_name {
            "bash" => {
                if input.contains(' ') {
                    format!("{}*", input.split(' ').next().unwrap_or(input))
                } else {
                    input.to_string()
                }
            }
            _ => input.to_string(),
        }
    }

    fn resolve_path_input(tool_name: &str, args: &Value, workspace_root: &PathBuf) -> Option<PathBuf> {
        let path_str = match tool_name {
            "read_file" | "write_file" | "edit_file" => args.get("path").and_then(|v| v.as_str()),
            "list" => Some(args.get("path").and_then(|v| v.as_str()).unwrap_or(".")),
            "glob" => args.get("path").and_then(|v| v.as_str()).or(Some(".")),
            "lsp" => args.get("path").and_then(|v| v.as_str()),
            "patch" => args.get("path").and_then(|v| v.as_str()).or(Some(".")),
            _ => None,
        }?;

        let expanded = if path_str.starts_with("~") {
            if let Some(home) = dirs::home_dir() {
                path_str.replacen("~", &home.to_string_lossy(), 1)
            } else {
                path_str.to_string()
            }
        } else {
            path_str.to_string()
        };

        let path = if std::path::Path::new(&expanded).is_absolute() {
            PathBuf::from(expanded)
        } else {
            workspace_root.join(expanded)
        };

        Some(path)
    }

    async fn request_permission_confirmation(
        &self,
        request_type: &str,
        tool_name: &str,
        input: &str,
        suggested_pattern: String,
    ) -> Result<crate::domain::models::ConfirmationResponse, String> {
        let Some(app) = self.app.as_ref() else {
            return Err("Confirmation unavailable for this action.".to_string());
        };
        let Some(pending) = self.pending_confirmations.as_ref() else {
            return Err("Confirmation unavailable for this action.".to_string());
        };

        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();

        {
            let mut map = pending.lock().map_err(|_| "Failed to lock confirmation map".to_string())?;
            map.insert(request_id.clone(), tx);
        }

        let event = PermissionConfirmationRequest {
            id: request_id.clone(),
            session_id: self.session.id.to_string(),
            type_: request_type.to_string(),
            tool_name: tool_name.to_string(),
            input: input.to_string(),
            suggested_pattern,
        };

        app.emit("request-confirmation", &event)
            .map_err(|e| format!("Failed to emit confirmation event: {}", e))?;

        rx.await.map_err(|_| "Confirmation channel closed without response".to_string())
    }

    fn emit_tool_call(&self, call: &crate::domain::models::ToolCall) {
        let Some(app) = self.app.as_ref() else {
            return;
        };

        let event = ToolCallEvent {
            session_id: self.session.id.to_string(),
            tool_call_id: call.id.clone(),
            tool_name: call.name.clone(),
            arguments: call.arguments.clone(),
        };

        let _ = app.emit("agent-tool-call", &event);
    }

    fn emit_tool_result(&self, call_id: &str, tool_name: &str, content: &str) {
        let Some(app) = self.app.as_ref() else {
            return;
        };

        let event = ToolResultEvent {
            session_id: self.session.id.to_string(),
            tool_call_id: call_id.to_string(),
            tool_name: tool_name.to_string(),
            content: content.to_string(),
        };

        let _ = app.emit("agent-tool-result", &event);
    }

    async fn set_external_directory_rule(&mut self, pattern: String, action: crate::config::Action) {
        let mut config = self.permission_manager.lock().await;
        let rules = config.external_directory.get_or_insert_with(HashMap::new);
        rules.insert(pattern, action);
        self.session.permissions.config = config.clone();
    }

    async fn remove_external_directory_rule(&mut self, pattern: &str) {
        let mut config = self.permission_manager.lock().await;
        if let Some(rules) = config.external_directory.as_mut() {
            rules.remove(pattern);
        }
        self.session.permissions.config = config.clone();
    }

    async fn ensure_external_directory_access(
        &mut self,
        tool_name: &str,
        args: &Value,
    ) -> Result<Option<String>, String> {
        let workspace_root = self.session.workspace_path.clone();
        let Some(path) = Self::resolve_path_input(tool_name, args, &workspace_root) else {
            return Ok(None);
        };

        let action = {
            let config = self.permission_manager.lock().await;
            config.check_path_access(&path, &workspace_root)
        };

        match action {
            crate::config::Action::Allow => Ok(None),
            crate::config::Action::Deny => Err("Access denied: Path is outside workspace and not allowed by config".to_string()),
            crate::config::Action::Ask => {
                let input = path.to_string_lossy().to_string();
                let suggested_pattern = Self::canonicalize_or_normalize(&path).to_string_lossy().to_string();
                let response = self.request_permission_confirmation("permission", tool_name, &input, suggested_pattern.clone()).await?;

                if !response.allowed {
                    return Err("Access denied: External path not approved".to_string());
                }

                let pattern = response.pattern.unwrap_or(suggested_pattern);
                self.set_external_directory_rule(pattern.clone(), crate::config::Action::Allow).await;

                if response.always {
                    Ok(None)
                } else {
                    Ok(Some(pattern))
                }
            }
        }
    }

    async fn resolve_tool_action(&self, tool_name: &str, args: &Value) -> crate::config::Action {
        let config = self.permission_manager.lock().await;
        match tool_name {
            "bash" => {
                let cmd = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
                config.bash.evaluate(cmd)
            }
            "read_file" => {
                let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                config.read.evaluate(path)
            }
            "write_file" => {
                let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                config.write.evaluate(path)
            }
            "edit_file" | "patch" => {
                let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                config.edit.evaluate(path)
            }
            "list" => {
                let path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
                config.list.evaluate(path)
            }
            "glob" => {
                let pattern = args.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
                config.glob.evaluate(pattern)
            }
            "search" => {
                let pattern = args.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
                config.grep.evaluate(pattern)
            }
            "webfetch" => {
                let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
                config.webfetch.evaluate(url)
            }
            "task" => {
                let kind = args.get("subagent_type").and_then(|v| v.as_str()).unwrap_or("");
                config.task.evaluate(kind)
            }
            "lsp" => {
                let request = args.get("request").and_then(|v| v.as_str()).unwrap_or("");
                config.lsp.evaluate(request)
            }
            "todoread" => {
                let filter = args.get("filter").and_then(|v| v.as_str()).unwrap_or("");
                config.todoread.evaluate(filter)
            }
            "todowrite" => {
                let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("");
                config.todowrite.evaluate(action)
            }
            "skill" => {
                let skill = args.get("skill_name").and_then(|v| v.as_str()).unwrap_or("");
                config.skill.evaluate(skill)
            }
            _ => crate::config::Action::Allow,
        }
    }
    
    /// Build skills information for system prompt
    async fn build_skills_info(&self) -> String {
        use crate::config::{SkillDiscovery, SkillLoader};
        
        match SkillDiscovery::discover(&self.session.workspace_path) {
            Ok(skills) if !skills.is_empty() => {
                let mut skills_list = Vec::new();
                
                for skill in skills {
                    // Check permission
                    let config = self.permission_manager.lock().await;
                    let action = config.skill.evaluate(&skill.name);
                    drop(config); // Release lock
                    
                    if action != crate::config::Action::Deny {
                        // Try to get description
                        let desc = match SkillLoader::load(&skill) {
                            Ok(loaded) => loaded.metadata.description,
                            Err(_) => "No description".to_string()
                        };
                        
                        skills_list.push(format!("- {}: {}", skill.name, desc));
                    }
                }
                
                if skills_list.is_empty() {
                    return String::new();
                }
                
                format!(
                    "## Available Skills\nYou can use the 'skill' tool to load these capabilities:\n{}\n\nTo use a skill, invoke: skill({{ action: 'invoke', skill_name: 'skill-name' }})",
                    skills_list.join("\n")
                )
            }
            _ => String::new()
        }
    }
}
