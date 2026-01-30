use crate::domain::models::*;
use crate::domain::ports::ModelAdapter;
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::mpsc::Sender;
use eventsource_stream::Eventsource;
use futures::stream::StreamExt;
use std::collections::HashMap;

pub struct OpenAIAdapter {
    client: Client,
    api_key: String,
}

impl OpenAIAdapter {
    pub fn new(api_key: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
        }
    }
}

// --- Request Structs ---

#[derive(Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
}

#[derive(Serialize)]
struct OpenAIMessage {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<OpenAIToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct OpenAIToolCall {
    id: String,
    #[serde(rename = "type")]
    type_: String, // "function"
    function: OpenAIFunctionCall,
}

#[derive(Serialize, Deserialize, Clone)]
struct OpenAIFunctionCall {
    name: String,
    arguments: String,
}

// --- Response Structs ---

#[derive(Deserialize)]
struct OpenAIResponse {
    choices: Vec<OpenAIChoice>,
}

#[derive(Deserialize)]
struct OpenAIChoice {
    message: OpenAIResponseMessage,
}

#[derive(Deserialize)]
struct OpenAIResponseMessage {
    #[allow(dead_code)]
    role: String,
    content: Option<String>,
    tool_calls: Option<Vec<OpenAIToolCall>>,
}

// --- Stream Response Structs ---

#[derive(Deserialize)]
struct OpenAIStreamResponse {
    choices: Vec<OpenAIStreamChoice>,
}

#[derive(Deserialize)]
struct OpenAIStreamChoice {
    delta: OpenAIStreamDelta,
}

#[derive(Deserialize)]
struct OpenAIStreamDelta {
    content: Option<String>,
    tool_calls: Option<Vec<OpenAIToolCallDelta>>,
}

#[derive(Deserialize, Clone)]
struct OpenAIToolCallDelta {
    index: i32,
    id: Option<String>,
    function: Option<OpenAIFunctionCallDelta>,
}

#[derive(Deserialize, Clone)]
struct OpenAIFunctionCallDelta {
    name: Option<String>,
    arguments: Option<String>,
}

#[async_trait]
impl ModelAdapter for OpenAIAdapter {
    async fn chat(&self, req: ChatRequest) -> ChatResponse {
        // Reuse logic from before, just ensure mapping is correct
        let messages: Vec<OpenAIMessage> = req
            .messages
            .iter()
            .map(|m| {
                let tool_calls = m.tool_calls.as_ref().map(|tcs| {
                    tcs.iter().map(|tc| OpenAIToolCall {
                        id: tc.id.clone(),
                        type_: "function".to_string(),
                        function: OpenAIFunctionCall {
                            name: tc.name.clone(),
                            arguments: tc.arguments.clone(),
                        },
                    }).collect()
                });

                OpenAIMessage {
                    role: match m.role {
                        Role::System => "system".to_string(),
                        Role::User => "user".to_string(),
                        Role::Assistant => "assistant".to_string(),
                        Role::Tool => "tool".to_string(),
                    },
                    content: m.content.clone(),
                    tool_calls,
                    tool_call_id: m.tool_call_id.clone(),
                }
            })
            .collect();

        let request_body = OpenAIRequest {
            model: req.model_id.0,
            messages,
            temperature: req.temperature,
            tools: req.tools,
            stream: None,
        };

        let res = self
            .client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&request_body)
            .send()
            .await;

        match res {
            Ok(response) => {
                if response.status().is_success() {
                    let body: OpenAIResponse = response.json().await.unwrap_or_else(|_| OpenAIResponse {
                        choices: vec![],
                    });
                    
                    if let Some(choice) = body.choices.first() {
                         let tool_calls = choice.message.tool_calls.as_ref().map(|tcs| {
                            tcs.iter().map(|tc| ToolCall {
                                id: tc.id.clone(),
                                name: tc.function.name.clone(),
                                arguments: tc.function.arguments.clone(),
                                signature: None,
                            }).collect()
                        });

                        ChatResponse {
                            content: choice.message.content.clone().unwrap_or_default(),
                            role: Role::Assistant,
                            tool_calls,
                            tool_call_id: None,
                        }
                    } else {
                         ChatResponse {
                            content: "Error: No choice in response".to_string(),
                            role: Role::System,
                            tool_calls: None,
                            tool_call_id: None,
                        }
                    }
                } else {
                    let err_text = response.text().await.unwrap_or_default();
                    ChatResponse {
                        content: format!("Error HTTP: {}", err_text),
                        role: Role::System,
                        tool_calls: None,
                        tool_call_id: None,
                    }
                }
            }
            Err(e) => ChatResponse {
                content: format!("Error: {}", e),
                role: Role::System,
                tool_calls: None,
                tool_call_id: None,
            },
        }
    }

    async fn stream(&self, req: ChatRequest, tx: Sender<String>) -> ChatResponse {
        let messages: Vec<OpenAIMessage> = req
            .messages
            .iter()
            .map(|m| {
                let tool_calls = m.tool_calls.as_ref().map(|tcs: &Vec<ToolCall>| {
                    tcs.iter().map(|tc| OpenAIToolCall {
                        id: tc.id.clone(),
                        type_: "function".to_string(),
                        function: OpenAIFunctionCall {
                            name: tc.name.clone(),
                            arguments: tc.arguments.clone(),
                        },
                    }).collect()
                });




                OpenAIMessage {
                    role: match m.role {
                        Role::System => "system".to_string(),
                        Role::User => "user".to_string(),
                        Role::Assistant => "assistant".to_string(),
                        Role::Tool => "tool".to_string(),
                    },
                    content: m.content.clone(),
                    tool_calls,
                    tool_call_id: m.tool_call_id.clone(),
                }
            })
            .collect();

        let request_body = OpenAIRequest {
            model: req.model_id.0,
            messages,
            temperature: req.temperature,
            tools: req.tools,
            stream: Some(true),
        };

        let mut accumulated_content = String::new();
        // Index -> (id, name, args)
        let mut tool_call_accumulator: HashMap<i32, (String, String, String)> = HashMap::new();

        let res = self
            .client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&request_body)
            .send()
            .await;

        match res {
            Ok(response) => {
                if !response.status().is_success() {
                    let err = response.text().await.unwrap_or_default();
                    let _ = tx.send(format!("Error: {}", err)).await;
                    return ChatResponse {
                        content: err,
                        role: Role::System,
                        tool_calls: None,
                        tool_call_id: None,
                    };
                }

                let mut stream = response.bytes_stream().eventsource();

                while let Some(event) = stream.next().await {
                    match event {
                        Ok(event) => {
                            if event.data == "[DONE]" {
                                break;
                            }
                            if let Ok(chunk) = serde_json::from_str::<OpenAIStreamResponse>(&event.data) {
                                if let Some(choice) = chunk.choices.first() {
                                    // Handle Content
                                    if let Some(content) = &choice.delta.content {
                                        accumulated_content.push_str(content);
                                        let _ = tx.send(content.clone()).await;
                                    }

                                    // Handle Tool Calls
                                    if let Some(tool_calls) = &choice.delta.tool_calls {
                                        for tc in tool_calls {
                                            let entry = tool_call_accumulator.entry(tc.index).or_insert((String::new(), String::new(), String::new()));
                                            if let Some(id) = &tc.id {
                                                entry.0 = id.clone();
                                            }
                                            if let Some(func) = &tc.function {
                                                if let Some(name) = &func.name {
                                                    entry.1.push_str(name);
                                                }
                                                if let Some(args) = &func.arguments {
                                                    entry.2.push_str(args);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Stream error: {}", e);
                        }
                    }
                }
            }
            Err(e) => {
                let _ = tx.send(format!("Error: {}", e)).await;
                return ChatResponse {
                    content: format!("Error: {}", e),
                    role: Role::System,
                    tool_calls: None,
                    tool_call_id: None,
                };
            }
        }

        // Finalize Tool Calls
        let final_tool_calls = if tool_call_accumulator.is_empty() {
            None
        } else {
            // Sort by index to maintain order
            let mut calls: Vec<_> = tool_call_accumulator.into_iter().collect();
            calls.sort_by_key(|(k, _)| *k);
            
            Some(calls.into_iter().map(|(_, (id, name, args))| ToolCall {
                id,
                name,
                arguments: args,
                signature: None,
            }).collect())
        };

        ChatResponse {
            content: accumulated_content,
            role: Role::Assistant,
            tool_calls: final_tool_calls,
            tool_call_id: None,
        }
    }
}
