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
                      let result_msg = format!("\n\n> Result: \n```\n{}\n```\n", result_content);
                      println!("[DEBUG] Sending tool result: {}", &result_msg[..result_msg.len().min(100)]);
                      let _ = tx.send(result_msg).await;

                      // Append Tool Output
                      self.session.messages.push(Message {
                          role: Role::Tool,
                          content: Some(result_content),
                          tool_calls: None,
                          tool_call_id: Some(call.id.clone()),
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
