use crate::domain::models::*;
use crate::domain::ports::ModelAdapter;
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::mpsc::Sender;

pub struct AnthropicAdapter {
    client: Client,
    api_key: String,
    model_name: String,
}

impl AnthropicAdapter {
    pub fn new(api_key: String, model_name: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            model_name,
        }
    }
}

// --- Anthropic Request Structs ---

#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    messages: Vec<AnthropicMessage>,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<AnthropicTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
}

#[derive(Serialize)]
struct AnthropicMessage {
    role: String,
    content: Vec<AnthropicContent>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type")]
enum AnthropicContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
    },
}

#[derive(Serialize)]
struct AnthropicTool {
    name: String,
    description: String,
    input_schema: Value,
}

// --- Anthropic Response Structs ---

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicResponseContent>,
    #[allow(dead_code)]
    role: String,
    // usage: Option<Value>,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum AnthropicResponseContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
}

#[async_trait]
impl ModelAdapter for AnthropicAdapter {
    async fn chat(&self, req: ChatRequest) -> ChatResponse {
        let mut anthropic_messages = Vec::new();
        let mut system_prompt = None;

        for m in req.messages {
            if m.role == Role::System {
                system_prompt = Some(m.content.unwrap_or_default());
                continue;
            }

            let role = match m.role {
                Role::User => "user",
                Role::Assistant => "assistant",
                Role::Tool => "user", // Anthropic treats tool results as user messages
                _ => "user",
            }.to_string();

            let mut content = Vec::new();

            if let Some(text) = m.content {
                // If it's a tool response (Role::Tool), we format it specifically
                if m.role == Role::Tool {
                     if let Some(tool_id) = m.tool_call_id {
                         content.push(AnthropicContent::ToolResult {
                             tool_use_id: tool_id,
                             content: text,
                         });
                     }
                } else {
                    content.push(AnthropicContent::Text { text });
                }
            }

            if let Some(tool_calls) = m.tool_calls {
                for tc in tool_calls {
                    let input = serde_json::from_str(&tc.arguments).unwrap_or(json!({}));
                    content.push(AnthropicContent::ToolUse {
                        id: tc.id,
                        name: tc.name,
                        input,
                    });
                }
            }
            
            if !content.is_empty() {
                anthropic_messages.push(AnthropicMessage { role, content });
            }
        }

        let tools = if let Some(generic_tools) = req.tools {
            let mut tools_vec = Vec::new();
            for t in generic_tools {
                if let Some(func) = t.get("function") {
                    tools_vec.push(AnthropicTool {
                        name: func["name"].as_str().unwrap_or_default().to_string(),
                        description: func["description"].as_str().unwrap_or_default().to_string(),
                        input_schema: func["parameters"].clone(),
                    });
                }
            }
            if tools_vec.is_empty() { None } else { Some(tools_vec) }
        } else {
            None
        };

        let request_body = AnthropicRequest {
            model: self.model_name.clone(),
            messages: anthropic_messages,
            max_tokens: 4096,
            tools,
            system: system_prompt,
        };

        let res = self.client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request_body)
            .send()
            .await;

        match res {
            Ok(response) => {
                if !response.status().is_success() {
                    let status = response.status();
                    let text = response.text().await.unwrap_or_default();
                    return ChatResponse {
                        content: format!("Anthropic Error {}: {}", status, text),
                        role: Role::System,
                        tool_calls: None,
                        tool_call_id: None,
                    };
                }

                let body: AnthropicResponse = response.json().await.unwrap_or_else(|_| AnthropicResponse {
                    content: vec![],
                    role: "assistant".to_string(),
                });

                let mut final_text = String::new();
                let mut final_tool_calls = Vec::new();

                for item in body.content {
                    match item {
                        AnthropicResponseContent::Text { text } => final_text.push_str(&text),
                        AnthropicResponseContent::ToolUse { id, name, input } => {
                                 final_tool_calls.push(ToolCall {
                                     id,
                                     name,
                                     arguments: serde_json::to_string(&input).unwrap_or_default(),
                                     signature: None,
                                 });

                        }
                    }
                }

                ChatResponse {
                    content: final_text,
                    role: Role::Assistant,
                    tool_calls: if final_tool_calls.is_empty() { None } else { Some(final_tool_calls) },
                    tool_call_id: None,
                }
            },
            Err(e) => ChatResponse {
                content: format!("Error: {}", e),
                role: Role::System,
                tool_calls: None,
                tool_call_id: None,
            },
        }
    }

    async fn stream(&self, req: ChatRequest, tx: Sender<String>) -> ChatResponse {
        // Fallback to non-streaming for now, but simulate stream by sending full content
        let res = self.chat(req).await;
        
        if !res.content.is_empty() {
            let _ = tx.send(res.content.clone()).await;
        }
        
        res
    }
}
