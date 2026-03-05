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

/// Adapter for any OpenAI-compatible chat completions API (OpenRouter, Groq, Together, LM Studio, etc.)
pub struct OpenAICompatibleAdapter {
    client: Client,
    api_key: String,
    base_url: String,
    model: String,
}

impl OpenAICompatibleAdapter {
    pub fn new(api_key: String, base_url: String, model: String) -> Self {
        let base = base_url.trim_end_matches('/').to_string();
        Self {
            client: Client::new(),
            api_key,
            base_url: base,
            model,
        }
    }

    fn chat_completions_url(&self) -> String {
        format!("{}/chat/completions", self.base_url)
    }

    fn effective_model(&self, model_id: &str) -> String {
        if !self.model.is_empty() {
            self.model.clone()
        } else {
            model_id.to_string()
        }
    }
}

// ─── Request Structs ─────────────────────────────────────────────────────────

#[derive(Serialize)]
struct CompatRequest {
    model: String,
    messages: Vec<CompatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
}

#[derive(Serialize)]
struct CompatMessage {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<CompatMessageContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<CompatToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum CompatMessageContent {
    Text(String),
    Parts(Vec<CompatContentPart>),
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum CompatContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: CompatImageUrl },
}

#[derive(Serialize)]
struct CompatImageUrl {
    url: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct CompatToolCall {
    id: String,
    #[serde(rename = "type")]
    type_: String,
    function: CompatFunctionCall,
}

#[derive(Serialize, Deserialize, Clone)]
struct CompatFunctionCall {
    name: String,
    arguments: String,
}

// ─── Response Structs ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct CompatResponse {
    choices: Vec<CompatChoice>,
}

#[derive(Deserialize)]
struct CompatChoice {
    message: CompatResponseMessage,
}

#[derive(Deserialize)]
struct CompatResponseMessage {
    content: Option<String>,
    tool_calls: Option<Vec<CompatToolCall>>,
}

#[derive(Deserialize)]
struct CompatStreamResponse {
    choices: Vec<CompatStreamChoice>,
}

#[derive(Deserialize)]
struct CompatStreamChoice {
    delta: CompatStreamDelta,
}

#[derive(Deserialize)]
struct CompatStreamDelta {
    content: Option<String>,
    tool_calls: Option<Vec<CompatToolCallDelta>>,
}

#[derive(Deserialize, Clone)]
struct CompatToolCallDelta {
    index: i32,
    id: Option<String>,
    function: Option<CompatFunctionCallDelta>,
}

#[derive(Deserialize, Clone)]
struct CompatFunctionCallDelta {
    name: Option<String>,
    arguments: Option<String>,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn build_compat_content(message: &Message) -> Option<CompatMessageContent> {
    let text = message.content.clone().unwrap_or_default();
    let attachments = message.attachments.clone().unwrap_or_default();

    if attachments.is_empty() {
        if text.is_empty() {
            return None;
        }
        return Some(CompatMessageContent::Text(text));
    }

    let mut parts = Vec::new();
    if !text.is_empty() {
        parts.push(CompatContentPart::Text { text });
    }
    for attachment in attachments {
        let url = format!("data:{};base64,{}", attachment.mime_type, attachment.data);
        parts.push(CompatContentPart::ImageUrl {
            image_url: CompatImageUrl { url },
        });
    }

    if parts.is_empty() { None } else { Some(CompatMessageContent::Parts(parts)) }
}

fn build_compat_messages(req: &ChatRequest) -> Vec<CompatMessage> {
    req.messages
        .iter()
        .map(|m| {
            let tool_calls = m.tool_calls.as_ref().map(|tcs| {
                tcs.iter().map(|tc| CompatToolCall {
                    id: tc.id.clone(),
                    type_: "function".to_string(),
                    function: CompatFunctionCall {
                        name: tc.name.clone(),
                        arguments: tc.arguments.clone(),
                    },
                }).collect()
            });

            CompatMessage {
                role: match m.role {
                    Role::System => "system".to_string(),
                    Role::User => "user".to_string(),
                    Role::Assistant => "assistant".to_string(),
                    Role::Tool => "tool".to_string(),
                },
                content: build_compat_content(m),
                tool_calls,
                tool_call_id: m.tool_call_id.clone(),
            }
        })
        .collect()
}

fn map_tool_calls(tcs: &[CompatToolCall]) -> Vec<ToolCall> {
    tcs.iter().map(|tc| ToolCall {
        id: tc.id.clone(),
        name: tc.function.name.clone(),
        arguments: tc.function.arguments.clone(),
        signature: None,
    }).collect()
}

// ─── ModelAdapter impl ────────────────────────────────────────────────────────

#[async_trait]
impl ModelAdapter for OpenAICompatibleAdapter {
    async fn chat(&self, req: ChatRequest) -> ChatResponse {
        let messages = build_compat_messages(&req);
        let request_body = CompatRequest {
            model: self.effective_model(&req.model_id.0),
            messages,
            temperature: req.temperature,
            tools: req.tools,
            stream: None,
        };

        let mut builder = self.client
            .post(self.chat_completions_url())
            .header("Content-Type", "application/json");
        if !self.api_key.is_empty() {
            builder = builder.header("Authorization", format!("Bearer {}", self.api_key));
        }

        match builder.json(&request_body).send().await {
            Ok(response) => {
                if response.status().is_success() {
                    let body: CompatResponse = response.json().await
                        .unwrap_or_else(|_| CompatResponse { choices: vec![] });
                    if let Some(choice) = body.choices.first() {
                        let tool_calls = choice.message.tool_calls.as_ref()
                            .map(|tcs| map_tool_calls(tcs));
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

    async fn stream(
        &self,
        req: ChatRequest,
        tx: Sender<String>,
        cancel: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
    ) -> ChatResponse {
        let messages = build_compat_messages(&req);
        let request_body = CompatRequest {
            model: self.effective_model(&req.model_id.0),
            messages,
            temperature: req.temperature,
            tools: req.tools,
            stream: Some(true),
        };

        let mut accumulated_content = String::new();
        // index → (id, name, args_buf)
        let mut tool_call_accumulator: HashMap<i32, (String, String, String)> = HashMap::new();

        let mut builder = self.client
            .post(self.chat_completions_url())
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream");
        if !self.api_key.is_empty() {
            builder = builder.header("Authorization", format!("Bearer {}", self.api_key));
        }

        match builder.json(&request_body).send().await {
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
                    if let Some(flag) = cancel.as_ref() {
                        if flag.load(std::sync::atomic::Ordering::SeqCst) {
                            break;
                        }
                    }
                    match event {
                        Ok(ev) => {
                            if ev.data == "[DONE]" {
                                break;
                            }
                            if let Ok(chunk) = serde_json::from_str::<CompatStreamResponse>(&ev.data) {
                                if let Some(choice) = chunk.choices.first() {
                                    if let Some(content) = &choice.delta.content {
                                        if !content.is_empty() {
                                            accumulated_content.push_str(content);
                                            let _ = tx.send(content.clone()).await;
                                        }
                                    }
                                    if let Some(tcs) = &choice.delta.tool_calls {
                                        for tc in tcs {
                                            let entry = tool_call_accumulator
                                                .entry(tc.index)
                                                .or_insert_with(|| {
                                                    (tc.id.clone().unwrap_or_default(), String::new(), String::new())
                                                });
                                            if let Some(id) = &tc.id {
                                                if !id.is_empty() {
                                                    entry.0 = id.clone();
                                                }
                                            }
                                            if let Some(f) = &tc.function {
                                                if let Some(name) = &f.name {
                                                    entry.1.push_str(name);
                                                }
                                                if let Some(args) = &f.arguments {
                                                    entry.2.push_str(args);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            let _ = tx.send(format!("Error: {}", e)).await;
                            break;
                        }
                    }
                }

                let mut tool_calls: Vec<ToolCall> = tool_call_accumulator
                    .into_values()
                    .filter(|(_, name, _)| !name.is_empty())
                    .map(|(id, name, arguments)| ToolCall {
                        id,
                        name,
                        arguments,
                        signature: None,
                    })
                    .collect();
                // Stable ordering
                tool_calls.sort_by(|a, b| a.name.cmp(&b.name));

                let final_tool_calls = if tool_calls.is_empty() { None } else { Some(tool_calls) };
                let first_call_id = final_tool_calls.as_ref()
                    .and_then(|calls| calls.first())
                    .map(|c| c.id.clone());

                ChatResponse {
                    content: accumulated_content,
                    role: Role::Assistant,
                    tool_calls: final_tool_calls,
                    tool_call_id: first_call_id,
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
}

/// Known OpenAI-compatible providers and their base URLs
pub fn known_provider_base_url(provider: &str) -> Option<&'static str> {
    match provider {
        "openrouter" => Some("https://openrouter.ai/api/v1"),
        "groq" => Some("https://api.groq.com/openai/v1"),
        "together" => Some("https://api.together.xyz/v1"),
        "perplexity" => Some("https://api.perplexity.ai"),
        "deepseek" => Some("https://api.deepseek.com/v1"),
        "mistral" => Some("https://api.mistral.ai/v1"),
        "xai" => Some("https://api.x.ai/v1"),
        _ => None,
    }
}
