use crate::domain::models::*;
use crate::domain::ports::ModelAdapter;
use async_trait::async_trait;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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

    fn uses_oauth_token(&self) -> bool {
        !self.api_key.starts_with("sk-")
    }

    fn extract_chatgpt_account_id(&self) -> Option<String> {
        let token = self.api_key.as_str();
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() < 2 {
            return None;
        }
        let payload = URL_SAFE_NO_PAD.decode(parts[1]).ok()?;
        let value: Value = serde_json::from_slice(&payload).ok()?;
        value
            .get("https://api.openai.com/auth")
            .and_then(|v| v.get("chatgpt_account_id"))
            .and_then(|v| v.as_str())
            .map(|v| v.to_string())
    }

    fn build_codex_input(&self, messages: &[Message]) -> Vec<Value> {
        let mut input: Vec<Value> = Vec::new();

        for message in messages {
            match message.role {
                Role::Tool => {
                    if let Some(call_id) = &message.tool_call_id {
                        let output = message.content.clone().unwrap_or_default();
                        input.push(json!({
                            "type": "function_call_output",
                            "call_id": call_id,
                            "output": output
                        }));
                    }
                }
                _ => {
                    if let Some(content) = &message.content {
                        let content_type = match message.role {
                            Role::Assistant => "output_text",
                            _ => "input_text",
                        };
                        let mut parts = vec![json!({
                            "type": content_type,
                            "text": content
                        })];

                        if let Some(attachments) = &message.attachments {
                            for attachment in attachments {
                                if attachment.mime_type.starts_with("image/") {
                                    let data_url = format!(
                                        "data:{};base64,{}",
                                        attachment.mime_type,
                                        attachment.data
                                    );
                                    parts.push(json!({
                                        "type": "input_image",
                                        "image_url": data_url
                                    }));
                                }
                            }
                        }

                        let role = match message.role {
                            Role::System => "developer",
                            Role::User => "user",
                            Role::Assistant => "assistant",
                            Role::Tool => "tool",
                        };

                        input.push(json!({
                            "type": "message",
                            "role": role,
                            "content": parts
                        }));
                    }

                    if let Some(tool_calls) = &message.tool_calls {
                        for call in tool_calls {
                            input.push(json!({
                                "type": "function_call",
                                "call_id": call.id,
                                "name": call.name,
                                "arguments": call.arguments
                            }));
                        }
                    }
                }
            }
        }

        input
    }

    fn normalize_codex_tools(&self, tools: &Option<Vec<Value>>) -> Option<Vec<Value>> {
        let list = tools.as_ref()?;
        let mut normalized: Vec<Value> = Vec::new();
        for tool in list {
            if let Some(function) = tool.get("function") {
                let name = function.get("name").and_then(|v| v.as_str());
                if let Some(name) = name {
                    let mut obj = serde_json::Map::new();
                    let tool_type = tool.get("type").cloned().unwrap_or_else(|| json!("function"));
                    obj.insert("type".to_string(), tool_type);
                    obj.insert("name".to_string(), json!(name));
                    if let Some(description) = function.get("description") {
                        obj.insert("description".to_string(), description.clone());
                    }
                    if let Some(parameters) = function.get("parameters") {
                        obj.insert("parameters".to_string(), parameters.clone());
                    }
                    normalized.push(Value::Object(obj));
                    continue;
                }
            }
            normalized.push(tool.clone());
        }
        Some(normalized)
    }

    fn build_codex_instructions(&self, messages: &[Message]) -> String {
        let mut instructions: Vec<String> = Vec::new();
        for message in messages {
            if message.role == Role::System {
                if let Some(content) = message.content.as_ref().filter(|c| !c.trim().is_empty()) {
                    instructions.push(content.clone());
                }
            }
        }
        if instructions.is_empty() {
            "You are a helpful coding assistant.".to_string()
        } else {
            instructions.join("\n\n")
        }
    }

    fn strip_system_reminder_blocks(&self, input: &str) -> String {
        const OPEN: &str = "<system-reminder>";
        const CLOSE: &str = "</system-reminder>";

        let mut result = String::with_capacity(input.len());
        let mut rest = input;

        loop {
            let Some(start) = rest.find(OPEN) else {
                result.push_str(rest);
                break;
            };

            result.push_str(&rest[..start]);
            let after_open = &rest[start + OPEN.len()..];

            let Some(end) = after_open.find(CLOSE) else {
                break;
            };

            rest = &after_open[end + CLOSE.len()..];
        }

        result.trim().to_string()
    }

    fn extract_codex_text(&self, response: &Value) -> String {
        let mut output_text = String::new();
        if let Some(outputs) = response.get("output").and_then(|v| v.as_array()) {
            for item in outputs {
                if item.get("type").and_then(|v| v.as_str()) == Some("message") {
                    if let Some(contents) = item.get("content").and_then(|v| v.as_array()) {
                        for content in contents {
                            if content.get("type").and_then(|v| v.as_str()) == Some("output_text") {
                                if let Some(text) = content.get("text").and_then(|v| v.as_str()) {
                                    output_text.push_str(text);
                                }
                            }
                        }
                    }
                }
            }
        }
        self.strip_system_reminder_blocks(&output_text)
    }

    fn extract_codex_tool_calls(&self, response: &Value) -> Option<Vec<ToolCall>> {
        let outputs = response.get("output")?.as_array()?;
        let mut calls: Vec<ToolCall> = Vec::new();
        for item in outputs {
            if item.get("type").and_then(|v| v.as_str()) == Some("function_call") {
                let id = item
                    .get("call_id")
                    .or_else(|| item.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let name = item
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let arguments = item
                    .get("arguments")
                    .and_then(|v| v.as_str())
                    .unwrap_or("{}");
                if !name.is_empty() {
                    calls.push(ToolCall {
                        id,
                        name,
                        arguments: arguments.to_string(),
                        signature: None,
                    });
                }
            }
        }
        if calls.is_empty() {
            None
        } else {
            Some(calls)
        }
    }

    #[allow(dead_code)]
    async fn codex_chat(&self, req: ChatRequest) -> ChatResponse {
        let input = self.build_codex_input(&req.messages);
        let instructions = self.build_codex_instructions(&req.messages);
        let tools = self.normalize_codex_tools(&req.tools);
        let mut request_body = serde_json::Map::new();
        request_body.insert("model".to_string(), json!(req.model_id.0));
        request_body.insert("input".to_string(), json!(input));
        request_body.insert("stream".to_string(), json!(false));
        request_body.insert("store".to_string(), json!(false));
        request_body.insert("include".to_string(), json!(["reasoning.encrypted_content"]));
        request_body.insert("instructions".to_string(), json!(instructions));
        request_body.insert("reasoning".to_string(), json!({ "effort": "medium", "summary": "auto" }));
        request_body.insert("text".to_string(), json!({ "verbosity": "medium" }));
        if let Some(tools) = tools {
            request_body.insert("tools".to_string(), json!(tools));
        }

        let mut builder = self
            .client
            .post("https://chatgpt.com/backend-api/codex/responses")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("OpenAI-Beta", "responses=experimental")
            .header("originator", "codex_cli_rs");

        if let Some(account_id) = self.extract_chatgpt_account_id() {
            builder = builder.header("chatgpt-account-id", account_id);
        }

        let res = builder.json(&request_body).send().await;

        match res {
            Ok(response) => {
                if response.status().is_success() {
                    let body: Value = response.json().await.unwrap_or_else(|_| json!({}));
                    let content = self.extract_codex_text(&body);
                    let tool_calls = self.extract_codex_tool_calls(&body);
                    ChatResponse {
                        content,
                        role: Role::Assistant,
                        tool_calls: tool_calls.clone(),
                        tool_call_id: tool_calls.as_ref().and_then(|calls| calls.first()).map(|call| call.id.clone()),
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

    async fn codex_stream(&self, req: ChatRequest, tx: Sender<String>, cancel: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>) -> ChatResponse {
        let input = self.build_codex_input(&req.messages);
        let instructions = self.build_codex_instructions(&req.messages);
        let tools = self.normalize_codex_tools(&req.tools);
        let mut request_body = serde_json::Map::new();
        request_body.insert("model".to_string(), json!(req.model_id.0));
        request_body.insert("input".to_string(), json!(input));
        request_body.insert("stream".to_string(), json!(true));
        request_body.insert("store".to_string(), json!(false));
        request_body.insert("include".to_string(), json!(["reasoning.encrypted_content"]));
        request_body.insert("instructions".to_string(), json!(instructions));
        request_body.insert("reasoning".to_string(), json!({ "effort": "medium", "summary": "auto" }));
        request_body.insert("text".to_string(), json!({ "verbosity": "medium" }));
        if let Some(tools) = tools {
            request_body.insert("tools".to_string(), json!(tools));
        }

        let mut builder = self
            .client
            .post("https://chatgpt.com/backend-api/codex/responses")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("OpenAI-Beta", "responses=experimental")
            .header("originator", "codex_cli_rs")
            .header("accept", "text/event-stream");

        if let Some(account_id) = self.extract_chatgpt_account_id() {
            builder = builder.header("chatgpt-account-id", account_id);
        }

        let res = builder.json(&request_body).send().await;

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

                let mut accumulated = String::new();
                let mut saw_output_delta = false;
                let mut final_response: Option<Value> = None;
                let mut stream = response.bytes_stream().eventsource();

                while let Some(event) = stream.next().await {
                    if let Some(flag) = cancel.as_ref() {
                        if flag.load(std::sync::atomic::Ordering::SeqCst) {
                            break;
                        }
                    }
                    match event {
                        Ok(event) => {
                            if event.data == "[DONE]" {
                                break;
                            }
                            let parsed = serde_json::from_str::<Value>(&event.data).ok();
                            let event_type = if !event.event.is_empty() {
                                event.event.as_str()
                            } else {
                                parsed
                                    .as_ref()
                                    .and_then(|chunk| chunk.get("type"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                            };

                            match event_type {
                                "response.output_text.delta" => {
                                    if let Some(delta) = parsed
                                        .as_ref()
                                        .and_then(|chunk| chunk.get("delta"))
                                        .and_then(|v| v.as_str())
                                    {
                                        saw_output_delta = true;
                                        accumulated.push_str(delta);
                                        let _ = tx.send(delta.to_string()).await;
                                    }
                                }
                                "response.output_text.done" => {
                                    if let Some(text) = parsed
                                        .as_ref()
                                        .and_then(|chunk| chunk.get("text"))
                                        .and_then(|v| v.as_str())
                                    {
                                        if !saw_output_delta && !text.is_empty() {
                                            accumulated.push_str(text);
                                            let _ = tx.send(text.to_string()).await;
                                        }
                                    }
                                }
                                "response.completed" | "response.done" => {
                                    if let Some(resp) = parsed
                                        .as_ref()
                                        .and_then(|chunk| chunk.get("response"))
                                        .cloned()
                                    {
                                        final_response = Some(resp);
                                    } else if let Some(value) = parsed.clone() {
                                        final_response = Some(value);
                                    }
                                }
                                _ => {}
                            }
                        }
                        Err(e) => {
                            let _ = tx.send(format!("Error: {}", e)).await;
                            break;
                        }
                    }
                }

                let content = if !accumulated.is_empty() {
                    self.strip_system_reminder_blocks(&accumulated)
                } else if let Some(resp) = final_response.as_ref() {
                    self.extract_codex_text(resp)
                } else {
                    String::new()
                };

                let tool_calls = final_response.as_ref().and_then(|resp| self.extract_codex_tool_calls(resp));

                ChatResponse {
                    content,
                    role: Role::Assistant,
                    tool_calls: tool_calls.clone(),
                    tool_call_id: tool_calls.as_ref().and_then(|calls| calls.first()).map(|call| call.id.clone()),
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
    #[serde(skip_serializing_if = "Option::is_none")]
    store: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    include: Option<Vec<String>>,
}

#[derive(Serialize)]
struct OpenAIMessage {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<OpenAIMessageContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<OpenAIToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum OpenAIMessageContent {
    Text(String),
    Parts(Vec<OpenAIContentPart>),
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum OpenAIContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: OpenAIImageUrl },
}

#[derive(Serialize)]
struct OpenAIImageUrl {
    url: String,
}

fn build_openai_content(message: &Message) -> Option<OpenAIMessageContent> {
    let text = message.content.clone().unwrap_or_default();
    let attachments = message.attachments.clone().unwrap_or_default();

    if attachments.is_empty() {
        if text.is_empty() {
            return None;
        }
        return Some(OpenAIMessageContent::Text(text));
    }

    let mut parts = Vec::new();
    if !text.is_empty() {
        parts.push(OpenAIContentPart::Text { text });
    }

    for attachment in attachments {
        let url = format!("data:{};base64,{}", attachment.mime_type, attachment.data);
        parts.push(OpenAIContentPart::ImageUrl {
            image_url: OpenAIImageUrl { url },
        });
    }

    if parts.is_empty() {
        None
    } else {
        Some(OpenAIMessageContent::Parts(parts))
    }
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
        if self.uses_oauth_token() {
            // ChatGPT-account Codex currently requires streaming requests.
            // For non-stream callers, reuse the streaming pipeline and drain token events
            // so the channel never blocks execution.
            let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(256);
            tokio::spawn(async move {
                while rx.recv().await.is_some() {}
            });
            return self.codex_stream(req, tx, None).await;
        }
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
                    content: build_openai_content(m),
                    tool_calls,
                    tool_call_id: m.tool_call_id.clone(),
                }
            })
            .collect();

        let use_codex = self.uses_oauth_token();
        let request_body = OpenAIRequest {
            model: req.model_id.0,
            messages,
            temperature: req.temperature,
            tools: req.tools,
            stream: None,
            store: if use_codex { Some(false) } else { None },
            include: if use_codex {
                Some(vec!["reasoning.encrypted_content".to_string()])
            } else {
                None
            },
        };

        let mut builder = self
            .client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", self.api_key));
        if use_codex {
            builder = builder.header("OpenAI-Beta", "codex");
        }
        let res = builder.json(&request_body).send().await;

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

    async fn stream(&self, req: ChatRequest, tx: Sender<String>, cancel: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>) -> ChatResponse {
        if self.uses_oauth_token() {
            return self.codex_stream(req, tx, cancel).await;
        }
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
                    content: build_openai_content(m),
                    tool_calls,
                    tool_call_id: m.tool_call_id.clone(),
                }
            })
            .collect();

        let use_codex = self.uses_oauth_token();
        let request_body = OpenAIRequest {
            model: req.model_id.0,
            messages,
            temperature: req.temperature,
            tools: req.tools,
            stream: Some(true),
            store: if use_codex { Some(false) } else { None },
            include: if use_codex {
                Some(vec!["reasoning.encrypted_content".to_string()])
            } else {
                None
            },
        };

        let mut accumulated_content = String::new();
        // Index -> (id, name, args)
        let mut tool_call_accumulator: HashMap<i32, (String, String, String)> = HashMap::new();

        let mut builder = self
            .client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", self.api_key));
        if use_codex {
            builder = builder.header("OpenAI-Beta", "codex");
        }
        let res = builder.json(&request_body).send().await;

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
                    if let Some(flag) = cancel.as_ref() {
                        if flag.load(std::sync::atomic::Ordering::SeqCst) {
                            break;
                        }
                    }
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
