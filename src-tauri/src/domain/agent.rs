use crate::domain::models::*;
use crate::domain::ports::{ModelAdapter, Tool};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::mpsc::Sender;

pub struct Agent {
    pub session: AgentSession,
    model: Arc<dyn ModelAdapter>,
    tools: Vec<Arc<dyn Tool>>,
    pub permission_manager: Arc<tokio::sync::Mutex<crate::config::PermissionConfig>>,
}

impl Agent {
    pub fn new(
        session: AgentSession,
        model: Arc<dyn ModelAdapter>,
        tools: Vec<Arc<dyn Tool>>,
        permission_manager: Arc<tokio::sync::Mutex<crate::config::PermissionConfig>>,
    ) -> Self {
        Self {
            session,
            model,
            tools,
            permission_manager,
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
            "edit_file" | "edit" => &mut config.edit,
            _ => return,
        };

        tool_perm.rules.push(crate::config::manager::PermissionRule {
            pattern,
            action,
        });
        
        // Sync back to session for persistence
        self.session.permissions.config = config.clone();
    }

    pub async fn step(&mut self, user_input: Option<String>) -> Result<String, String> {
        // 1. Add User Message
        if let Some(input) = user_input {
            self.session.messages.push(Message {
                role: Role::User,
                content: Some(input),
                tool_calls: None,
                tool_call_id: None,
            });
        }

        // 2. Build Context
        let context_summary = crate::domain::context::ContextBuilder::build(&self.session.workspace_path);
        
        // Handle Modes (Plan, Build, Research)
        let mode_instruction = match self.session.mode {
            crate::domain::models::AgentMode::Plan => 
                "You are in PLAN mode. Provide a detailed, step-by-step plan for the user's request. DO NOT execute any tools. Just describe what you would do.",
            crate::domain::models::AgentMode::Research => 
                "You are in RESEARCH mode. You may only use 'read_file', 'list_files', and 'search' tools. Do not write files or execute shell commands.",
            crate::domain::models::AgentMode::Build => 
                "You are in BUILD mode. You are an autonomous coding agent. Execute tools to fulfill the request.",
        };

        // Find existing system message or prepend one
        let system_msg_idx = self.session.messages.iter().position(|m| m.role == Role::System);
        let system_content = format!(
            "You are Anvil, an advanced AI coding agent.\n\n{}\n\n{}\n\nPrevious instructions remain active.",
            mode_instruction,
            context_summary
        );

        if let Some(idx) = system_msg_idx {
             self.session.messages[idx].content = Some(system_content);
        } else {
             self.session.messages.insert(0, Message {
                 role: Role::System,
                 content: Some(system_content),
                 tool_calls: None,
                 tool_call_id: None,
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
            });
            
            return Ok(res.content);
        }

        // 3. Chat Loop (Re-act)
        // Safety limit to prevent infinite loops
        let mut steps = 0;
        const MAX_STEPS: u32 = 10;

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
            });

            // Check for Tool Calls
            if let Some(tool_calls) = res.tool_calls {
                if tool_calls.is_empty() {
                     return Ok(res.content); // Done
                }

                // Execute Tools
                for call in tool_calls {
                     // Research Mode Filter
                     if self.session.mode == crate::domain::models::AgentMode::Research {
                         if call.name == "write_file" || call.name == "bash" || call.name == "edit_file" {
                             self.session.messages.push(Message {
                                 role: Role::Tool,
                                 content: Some("Error: Tool execution blocked. You are in RESEARCH mode.".to_string()),
                                 tool_calls: None,
                                 tool_call_id: Some(call.id),
                             });
                             continue;
                         }
                     }

                      let tool = self.tools.iter().find(|t| t.name() == call.name);
                     
                     let result_content = if let Some(tool) = tool {
                         let args: Value = serde_json::from_str(&call.arguments).unwrap_or(json!({}));
                         
                         // Check Permissions
                         let action = {
                             let config = self.permission_manager.lock().await;
                             match tool.name() {
                                 "bash" => {
                                     let cmd = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
                                     config.bash.evaluate(cmd)
                                 },
                                 "read_file" => {
                                     let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                                     config.read.evaluate(path)
                                 },
                                 "write_file" => {
                                     let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                                     config.write.evaluate(path)
                                 },
                                 "edit_file" => {
                                     let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                                     config.edit.evaluate(path)
                                 },
                                 _ => crate::config::Action::Allow, // Other tools allowed by default for now
                             }
                         };

                         match action {
                             crate::config::Action::Deny => {
                                 format!("Error: Permission denied for tool '{}'.", call.name)
                             },
                             crate::config::Action::Ask => {
                                 // TODO: Implement interactive Ask. For now, treat as Deny if not handled.
                                 // Actually, some tools already have their own confirmation.
                                 // We need to integrate this with the existing confirmation system.
                                 
                                 match tool.execute(args).await {
                                     Ok(val) => val.to_string(),
                                     Err(err) => format!("Error: {}", err),
                                 }
                             },
                             crate::config::Action::Allow => {
                                 match tool.execute(args).await {
                                     Ok(val) => val.to_string(),
                                     Err(err) => format!("Error: {}", err),
                                 }
                             }
                         }
                     } else {
                         format!("Error: Tool '{}' not found.", call.name)
                     };


                     // Append Tool Output
                     self.session.messages.push(Message {
                         role: Role::Tool,
                         content: Some(result_content),
                         tool_calls: None,
                         tool_call_id: Some(call.id),
                     });
                }
                // Loop continues to feed tool outputs back to model
            } else {
                // No tools called, return response
                return Ok(res.content);
            }
        }
    }

    pub async fn step_stream(&mut self, user_input: Option<String>, tx: Sender<String>) -> Result<String, String> {
        // 1. Add User Message
        if let Some(input) = user_input {
            self.session.messages.push(Message {
                role: Role::User,
                content: Some(input),
                tool_calls: None,
                tool_call_id: None,
            });
        }

        // 2. Build Context
        let context_summary = crate::domain::context::ContextBuilder::build(&self.session.workspace_path);
        
        // Handle Modes (Plan, Build, Research)
        let mode_instruction = match self.session.mode {
            crate::domain::models::AgentMode::Plan => 
                "You are in PLAN mode. Provide a detailed, step-by-step plan for the user's request. DO NOT execute any tools. Just describe what you would do.",
            crate::domain::models::AgentMode::Research => 
                "You are in RESEARCH mode. You may only use 'read_file', 'list_files', and 'search' tools. Do not write files or execute shell commands.",
            crate::domain::models::AgentMode::Build => 
                "You are in BUILD mode. You are an autonomous coding agent. Execute tools to fulfill the request.",
        };

        // Find existing system message or prepend one
        let system_msg_idx = self.session.messages.iter().position(|m| m.role == Role::System);
        let system_content = format!(
            "You are Anvil, an advanced AI coding agent.\n\n{}\n\n{}\n\nPrevious instructions remain active.",
            mode_instruction,
            context_summary
        );

        if let Some(idx) = system_msg_idx {
             self.session.messages[idx].content = Some(system_content);
        } else {
             self.session.messages.insert(0, Message {
                 role: Role::System,
                 content: Some(system_content),
                 tool_calls: None,
                 tool_call_id: None,
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
            });
            
            return Ok(res.content);
        }

        // 3. Chat Loop (Re-act)
        // Safety limit to prevent infinite loops
        let mut steps = 0;
        const MAX_STEPS: u32 = 10;

        loop {
            if steps >= MAX_STEPS {
                return Ok("⚠️ Agent exceeded maximum steps without final response.".to_string());
            }
            steps += 1;

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
            let res = self.model.stream(req, tx.clone()).await;

            // Append Assistant Message
            self.session.messages.push(Message {
                role: res.role.clone(),
                content: Some(res.content.clone()),
                tool_calls: res.tool_calls.clone(),
                tool_call_id: res.tool_call_id.clone(),
            });

            // Check for Tool Calls
            if let Some(tool_calls) = res.tool_calls {
                if tool_calls.is_empty() {
                     return Ok(res.content); // Done
                }

                // Execute Tools
                for call in &tool_calls {
                     // Notify frontend about tool execution
                     let _ = tx.send(format!("\n\n> Executing tool: `{}`...\n", call.name)).await;

                     // Research Mode Filter
                     if self.session.mode == crate::domain::models::AgentMode::Research {
                         if call.name == "write_file" || call.name == "bash" || call.name == "edit_file" {
                             let err_msg = "Error: Tool execution blocked. You are in RESEARCH mode.";
                             let _ = tx.send(format!("\n\n> Result: {}\n", err_msg)).await;
                             self.session.messages.push(Message {
                                 role: Role::Tool,
                                 content: Some(err_msg.to_string()),
                                 tool_calls: None,
                                 tool_call_id: Some(call.id.clone()),
                             });
                             continue;
                         }
                     }

                      let tool = self.tools.iter().find(|t| t.name() == call.name);
                     
                     let result_content = if let Some(tool) = tool {
                         let args: Value = serde_json::from_str(&call.arguments).unwrap_or(json!({}));
                         
                         // Check Permissions
                         let action = {
                             let config = self.permission_manager.lock().await;
                             match tool.name() {
                                 "bash" => {
                                     let cmd = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
                                     config.bash.evaluate(cmd)
                                 },
                                 "read_file" => {
                                     let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                                     config.read.evaluate(path)
                                 },
                                 "write_file" => {
                                     let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                                     config.write.evaluate(path)
                                 },
                                 "edit_file" => {
                                     let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                                     config.edit.evaluate(path)
                                 },
                                 _ => crate::config::Action::Allow,
                             }
                         };

                         match action {
                             crate::config::Action::Deny => {
                                 format!("Error: Permission denied for tool '{}'.", call.name)
                             },
                             crate::config::Action::Ask => {
                                 match tool.execute(args).await {
                                     Ok(val) => val.to_string(),
                                     Err(err) => format!("Error: {}", err),
                                 }
                             },
                             crate::config::Action::Allow => {
                                 match tool.execute(args).await {
                                     Ok(val) => val.to_string(),
                                     Err(err) => format!("Error: {}", err),
                                 }
                             }
                         }
                     } else {
                         format!("Error: Tool '{}' not found.", call.name)
                     };


                     // Notify frontend about tool result
                     let _ = tx.send(format!("\n\n> Result: \n```\n{}\n```\n", result_content)).await;

                     // Append Tool Output
                     self.session.messages.push(Message {
                         role: Role::Tool,
                         content: Some(result_content),
                         tool_calls: None,
                         tool_call_id: Some(call.id.clone()),
                     });
                }
                // Loop continues to feed tool outputs back to model
            } else {
                // No tools called, return response
                return Ok(res.content);
            }

        }
    }
}
