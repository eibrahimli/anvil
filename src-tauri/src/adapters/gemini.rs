use crate::domain::models::*;
use crate::domain::ports::ModelAdapter;
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::mpsc::Sender;

pub struct GeminiAdapter {
    client: Client,
    api_key: String,
    model_name: String,
}

impl GeminiAdapter {
    pub fn new(api_key: String, model_name: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            model_name,
        }
    }
}

// --- Gemini Request Structs ---

#[derive(Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<GeminiTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    generation_config: Option<GeminiConfig>,
}

#[derive(Serialize)]
struct GeminiConfig {
    temperature: Option<f32>,
}

#[derive(Serialize)]
struct GeminiContent {
    role: String,
    parts: Vec<GeminiPart>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(untagged)]
enum GeminiPart {
    Text { 
        text: String 
    },
    InlineData {
        #[serde(rename = "inlineData")]
        inline_data: GeminiInlineData
    },
    FunctionCall { 
        #[serde(rename = "functionCall")]
        function_call: GeminiFunctionCall,
        #[serde(skip_serializing_if = "Option::is_none", rename = "thoughtSignature")]
        thought_signature: Option<String> 
    },
    FunctionResponse { 
        #[serde(rename = "functionResponse")]
        function_response: GeminiFunctionResponse 
    },
}

#[derive(Serialize, Deserialize, Clone)]
struct GeminiFunctionCall {
    name: String,
    args: Value,
}

#[derive(Serialize, Deserialize, Clone)]
struct GeminiFunctionResponse {
    name: String,
    response: Value,
}

#[derive(Serialize, Deserialize, Clone)]
struct GeminiInlineData {
    #[serde(rename = "mimeType")]
    mime_type: String,
    data: String,
}

#[derive(Serialize)]
struct GeminiTool {
    function_declarations: Vec<GeminiFunctionDeclaration>,
}

#[derive(Serialize)]
struct GeminiFunctionDeclaration {
    name: String,
    description: String,
    parameters: Value,
}

// --- Gemini Response Structs ---

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
    // error: Option<Value>, // Handle errors separately if needed
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: GeminiContentResponse,
    #[allow(dead_code)]
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct GeminiContentResponse {
    parts: Option<Vec<GeminiPartResponse>>,
    #[allow(dead_code)]
    role: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum GeminiPartResponse {
    Text { 
        text: String 
    },
    FunctionCall { 
        #[serde(rename = "functionCall")]
        function_call: GeminiFunctionCall,
        #[serde(rename = "thoughtSignature")]
        thought_signature: Option<String>
    },
}

#[async_trait]
impl ModelAdapter for GeminiAdapter {
    async fn chat(&self, req: ChatRequest) -> ChatResponse {
        let mut contents: Vec<GeminiContent> = Vec::new();

        for m in req.messages {
            let role = match m.role {
                Role::User => "user".to_string(),
                Role::Assistant => "model".to_string(),
                Role::System => "user".to_string(), // Gemini doesn't fully support system role in chat history in standard way, usually merged or prepended.
                Role::Tool => "function".to_string(),
            };

            // Handle Tool Outputs (Function Responses)
            if m.role == Role::Tool {
                // In Anvil's generic model, we have `content` as the result and `tool_call_id`.
                // Gemini expects `functionResponse` part.
                // We need to map back to the function name.
                // This is tricky because Anvil's generic Message struct for Tool role just has content/id, 
                // but Gemini needs the NAME of the function being responded to in the message structure.
                // For now, we might have to rely on the `tool_call_id` actually being the function name 
                // OR we need to look it up.
                // However, Anvil's `ToolCall` has `id`. OpenAI uses random IDs. Gemini uses function names?
                // Let's assume for Gemini, the `tool_call_id` stored is the function name.
                
                if let Some(tool_name) = m.tool_call_id {
                     // Parse content as JSON value
                     let response_value: Value = serde_json::from_str(&m.content.unwrap_or_default()).unwrap_or(Value::Null);

                     contents.push(GeminiContent {
                        role: "function".to_string(),
                        parts: vec![GeminiPart::FunctionResponse {
                            function_response: GeminiFunctionResponse {
                                name: tool_name,
                                response: json!({ "content": response_value }), // Wrap to ensure object
                            }
                        }]
                    });
                }
                continue;
            }

            // Normal text or Function Call messages
            let mut parts = Vec::new();

            if let Some(text) = m.content {
                // If system message, maybe prepend "System Instruction: " ? 
                // For now just raw text.
                parts.push(GeminiPart::Text { text });
            }

            if let Some(attachments) = &m.attachments {
                if m.role == Role::User {
                    for attachment in attachments {
                        parts.push(GeminiPart::InlineData {
                            inline_data: GeminiInlineData {
                                mime_type: attachment.mime_type.clone(),
                                data: attachment.data.clone(),
                            },
                        });
                    }
                }
            }

            if let Some(tool_calls) = m.tool_calls {
                for tc in tool_calls {
                    // Gemini uses function names as IDs mostly, but we store ID in generic struct.
                    // When we SEND to Gemini, we send the call.
                    let args = serde_json::from_str(&tc.arguments).unwrap_or(json!({}));
                    parts.push(GeminiPart::FunctionCall {
                        function_call: GeminiFunctionCall {
                            name: tc.name,
                            args,
                        },
                        thought_signature: tc.signature,
                    });
                }
            }

            if !parts.is_empty() {
                 contents.push(GeminiContent { role, parts });
            }
        }

        // Handle Tools Definition
        let tools = if let Some(generic_tools) = req.tools {
            let mut funcs = Vec::new();
            for t in generic_tools {
                 // OpenCode generic tool schema is wrapped in { type: "function", function: { ... } } for OpenAI
                 // We need to unwrap it if it matches that structure, or take it as is.
                 // The `Agent` struct wraps it.
                 
                 if let Some(function) = t.get("function") {
                     let name = function["name"].as_str().unwrap_or("unknown").to_string();
                     let description = function["description"].as_str().unwrap_or("").to_string();
                     let parameters: Value = function["parameters"].clone();
                     
                     funcs.push(GeminiFunctionDeclaration {
                         name,
                         description,
                         parameters,
                     });
                 }
            }
            if funcs.is_empty() { None } else { Some(vec![GeminiTool { function_declarations: funcs }]) }
        } else {
            None
        };

        let request_body = GeminiRequest {
            contents,
            tools,
            generation_config: Some(GeminiConfig {
                temperature: req.temperature,
            }),
        };

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            self.model_name, self.api_key
        );

        let res = self.client.post(&url).json(&request_body).send().await;

        match res {
            Ok(response) => {
                if !response.status().is_success() {
                    let status = response.status();
                    let text = response.text().await.unwrap_or_default();
                    return ChatResponse {
                        content: format!("Gemini Error {}: {}", status, text),
                        role: Role::System,
                        tool_calls: None,
                        tool_call_id: None,
                    };
                }

                let raw_text = response.text().await.unwrap_or_default();
                let body: Result<GeminiResponse, _> = serde_json::from_str(&raw_text);

                match body {
                    Ok(data) => {
                        if let Some(candidates) = data.candidates {
                            if let Some(first) = candidates.first() {
                                let mut final_text = String::new();
                                let mut final_tool_calls = Vec::new();

                                if let Some(parts) = &first.content.parts {
                                    for part in parts {
                                        match part {
                                            GeminiPartResponse::Text { text } => {
                                                final_text.push_str(&text);
                                            }
                                            GeminiPartResponse::FunctionCall { function_call, thought_signature } => {
                                                final_tool_calls.push(ToolCall {
                                                    id: function_call.name.clone(),
                                                    name: function_call.name.clone(),
                                                    arguments: serde_json::to_string(&function_call.args).unwrap_or_default(),
                                                    signature: thought_signature.clone(),
                                                });
                                            }
                                        }
                                    }
                                }

                                ChatResponse {
                                    content: final_text,
                                    role: Role::Assistant,
                                    tool_calls: if final_tool_calls.is_empty() {
                                        None
                                    } else {
                                        Some(final_tool_calls)
                                    },
                                    tool_call_id: None,
                                }
                            } else {
                                ChatResponse {
                                    content: format!("Error: No candidates returned. Response: {}", raw_text),
                                    role: Role::System,
                                    tool_calls: None,
                                    tool_call_id: None,
                                }
                            }
                        } else {
                            ChatResponse {
                                content: format!("Error: No candidates array in response. Body: {}", raw_text),
                                role: Role::System,
                                tool_calls: None,
                                tool_call_id: None,
                            }
                        }
                    }
                    Err(e) => ChatResponse {
                        content: format!("Error parsing Gemini response: {}. Raw: {}", e, raw_text),
                        role: Role::System,
                        tool_calls: None,
                        tool_call_id: None,
                    },
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
        // Fallback to non-streaming for now, but simulate stream by sending full content
        // This prevents the UI from getting stuck if it relies solely on events
        let res = self.chat(req).await;
        
        // Emit content.
        if !res.content.is_empty() {
            let _ = tx.send(res.content.clone()).await;
        }
        
        res
    }
}
