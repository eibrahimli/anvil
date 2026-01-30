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

pub struct OllamaAdapter {
    client: Client,
    base_url: String,
}

impl OllamaAdapter {
    pub fn new(base_url: Option<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.unwrap_or_else(|| "http://localhost:11434".to_string()),
        }
    }

    fn get_endpoint(&self) -> String {
        format!("{}/api/chat", self.base_url)
    }
}

// --- Request Structs (OpenAI-compatible) ---

#[derive(Serialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
}

#[derive(Serialize)]
struct OllamaMessage {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<OllamaToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct OllamaToolCall {
    id: String,
    #[serde(rename = "type")]
    type_: String, // "function"
    function: OllamaFunctionCall,
}

#[derive(Serialize, Deserialize, Clone)]
struct OllamaFunctionCall {
    name: String,
    arguments: String,
}

// --- Response Structs ---

#[derive(Deserialize)]
struct OllamaResponse {
    choices: Vec<OllamaChoice>,
}

#[derive(Deserialize)]
struct OllamaChoice {
    message: OllamaResponseMessage,
}

#[derive(Deserialize)]
struct OllamaResponseMessage {
    #[allow(dead_code)]
    role: String,
    content: Option<String>,
    tool_calls: Option<Vec<OllamaToolCall>>,
}

// --- Stream Response Structs ---

#[derive(Deserialize)]
struct OllamaStreamResponse {
    choices: Vec<OllamaStreamChoice>,
}

#[derive(Deserialize)]
struct OllamaStreamChoice {
    delta: OllamaStreamDelta,
}

#[derive(Deserialize)]
struct OllamaStreamDelta {
    content: Option<String>,
    tool_calls: Option<Vec<OllamaToolCallDelta>>,
}

#[derive(Deserialize, Clone)]
struct OllamaToolCallDelta {
    index: i32,
    id: Option<String>,
    function: Option<OllamaFunctionCallDelta>,
}

#[derive(Deserialize, Clone)]
struct OllamaFunctionCallDelta {
    name: Option<String>,
    arguments: Option<String>,
}

#[async_trait]
impl ModelAdapter for OllamaAdapter {
    async fn chat(&self, req: ChatRequest) -> ChatResponse {
        let model_id = req.model_id.0.clone();
        let messages: Vec<OllamaMessage> = req
            .messages
            .iter()
            .map(|m| {
                let tool_calls = m.tool_calls.as_ref().map(|tcs| {
                    tcs.iter().map(|tc| OllamaToolCall {
                        id: tc.id.clone(),
                        type_: "function".to_string(),
                        function: OllamaFunctionCall {
                            name: tc.name.clone(),
                            arguments: tc.arguments.clone(),
                        },
                    }).collect()
                });

                OllamaMessage {
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

        let request_body = OllamaRequest {
            model: model_id.clone(),
            messages,
            temperature: req.temperature,
            tools: req.tools,
            stream: None,
        };

        let res = self
            .client
            .post(&self.get_endpoint())
            .json(&request_body)
            .send()
            .await;

        match res {
            Ok(response) => {
                if response.status().is_success() {
                    let body: OllamaResponse = response.json().await.unwrap_or_else(|_| OllamaResponse {
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
                    let error_msg = if err_text.contains("connect") {
                        "Could not connect to Ollama. Make sure Ollama is running (http://localhost:11434)".to_string()
                    } else if err_text.contains("model") {
                        format!("Model not found in Ollama. Please pull the model first: ollama pull {}", model_id)
                    } else {
                        format!("Ollama Error: {}", err_text)
                    };
                    
                    ChatResponse {
                        content: error_msg,
                        role: Role::System,
                        tool_calls: None,
                        tool_call_id: None,
                    }
                }
            }
            Err(e) => {
                let error_msg = if e.to_string().contains("connect") {
                    "Could not connect to Ollama. Make sure Ollama is running (http://localhost:11434)".to_string()
                } else {
                    format!("Ollama Error: {}", e)
                };
                
                ChatResponse {
                    content: error_msg,
                    role: Role::System,
                    tool_calls: None,
                    tool_call_id: None,
                }
            }
        }
    }

    async fn stream(&self, req: ChatRequest, tx: Sender<String>) -> ChatResponse {
        let model_id = req.model_id.0.clone();
        let messages: Vec<OllamaMessage> = req
            .messages
            .iter()
            .map(|m| {
                let tool_calls = m.tool_calls.as_ref().map(|tcs: &Vec<ToolCall>| {
                    tcs.iter().map(|tc| OllamaToolCall {
                        id: tc.id.clone(),
                        type_: "function".to_string(),
                        function: OllamaFunctionCall {
                            name: tc.name.clone(),
                            arguments: tc.arguments.clone(),
                        },
                    }).collect()
                });

                OllamaMessage {
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

        let request_body = OllamaRequest {
            model: model_id.clone(),
            messages,
            temperature: req.temperature,
            tools: req.tools,
            stream: Some(true),
        };

        let mut accumulated_content = String::new();
        let mut tool_call_accumulator: HashMap<i32, (String, String, String)> = HashMap::new();

        let res = self
            .client
            .post(&self.get_endpoint())
            .json(&request_body)
            .send()
            .await;

        match res {
            Ok(response) => {
                if !response.status().is_success() {
                    let err = response.text().await.unwrap_or_default();
                    let error_msg = if err.contains("connect") {
                        "Could not connect to Ollama. Make sure Ollama is running (http://localhost:11434)".to_string()
                    } else if err.contains("model") {
                        format!("Model not found in Ollama. Please pull the model first: ollama pull {}", model_id)
                    } else {
                        format!("Ollama Error: {}", err)
                    };
                    
                    let _ = tx.send(error_msg.clone()).await;
                    return ChatResponse {
                        content: error_msg,
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
                            if let Ok(chunk) = serde_json::from_str::<OllamaStreamResponse>(&event.data) {
                                if let Some(choice) = chunk.choices.first() {
                                    if let Some(content) = &choice.delta.content {
                                        accumulated_content.push_str(content);
                                        let _ = tx.send(content.clone()).await;
                                    }

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
                let error_msg = if e.to_string().contains("connect") {
                    "Could not connect to Ollama. Make sure Ollama is running (http://localhost:11434)".to_string()
                } else {
                    format!("Ollama Error: {}", e)
                };
                
                let _ = tx.send(error_msg.clone()).await;
                return ChatResponse {
                    content: error_msg,
                    role: Role::System,
                    tool_calls: None,
                    tool_call_id: None,
                };
            }
        }

        let final_tool_calls = if tool_call_accumulator.is_empty() {
            None
        } else {
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
