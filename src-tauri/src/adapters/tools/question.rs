use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use uuid::Uuid;

/// Global registry for pending questions
/// This allows the resolve_question command to find and answer questions
static GLOBAL_QUESTION_REGISTRY: once_cell::sync::Lazy<Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>> = 
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

pub struct QuestionTool {
    app: AppHandle,
}

impl QuestionTool {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    /// Resolve a question by ID with the given answers
    pub fn resolve_question(question_id: String, answers: Value) -> Result<(), String> {
        let registry = GLOBAL_QUESTION_REGISTRY.clone();
        let mut pending = registry.lock()
            .map_err(|e| format!("Failed to lock question registry: {}", e))?;
        
        if let Some(sender) = pending.remove(&question_id) {
            sender.send(answers)
                .map_err(|_| "Failed to send answer - receiver dropped".to_string())?;
            Ok(())
        } else {
            Err(format!("Question {} not found or already answered", question_id))
        }
    }
}

#[derive(serde::Serialize, Clone)]
struct QuestionRequest {
    id: String,
    questions: Vec<Question>,
}

#[derive(serde::Serialize, Clone)]
struct Question {
    id: String,
    header: String,
    question: String,
    options: Vec<QuestionOption>,
    multiple: bool,
}

#[derive(serde::Serialize, Clone)]
struct QuestionOption {
    label: String,
    description: String,
    value: String,
}

#[async_trait]
impl Tool for QuestionTool {
    fn name(&self) -> &'static str {
        "question"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "question",
            "description": "Ask the user one or more questions and wait for their response. Use this when you need user input to make a decision, choose between options, or gather information. The tool will pause execution until the user responds.",
            "parameters": {
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "description": "Array of questions to ask the user",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {
                                    "type": "string",
                                    "description": "Unique identifier for this question"
                                },
                                "header": {
                                    "type": "string",
                                    "description": "Short label shown to the user (max 30 chars)"
                                },
                                "question": {
                                    "type": "string",
                                    "description": "Full question text shown to the user"
                                },
                                "options": {
                                    "type": "array",
                                    "description": "Available choices for the user",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "label": {
                                                "type": "string",
                                                "description": "Display text (1-5 words)"
                                            },
                                            "description": {
                                                "type": "string",
                                                "description": "Detailed explanation of this option"
                                            },
                                            "value": {
                                                "type": "string",
                                                "description": "Value returned when this option is selected"
                                            }
                                        },
                                        "required": ["label", "description", "value"]
                                    }
                                },
                                "multiple": {
                                    "type": "boolean",
                                    "description": "Whether user can select multiple options (default: false)",
                                    "default": false
                                }
                            },
                            "required": ["id", "header", "question", "options"]
                        }
                    }
                },
                "required": ["questions"]
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let questions_data = input.get("questions")
            .and_then(|v| v.as_array())
            .ok_or("Missing 'questions' parameter")?;

        if questions_data.is_empty() {
            return Err("Questions array cannot be empty".to_string());
        }

        // Parse questions
        let mut questions: Vec<Question> = Vec::new();
        for q in questions_data {
            let id = q.get("id")
                .and_then(|v| v.as_str())
                .ok_or("Question missing 'id'")?
                .to_string();
            
            let header = q.get("header")
                .and_then(|v| v.as_str())
                .ok_or("Question missing 'header'")?
                .to_string();
            
            let question_text = q.get("question")
                .and_then(|v| v.as_str())
                .ok_or("Question missing 'question'")?
                .to_string();

            let options_data = q.get("options")
                .and_then(|v| v.as_array())
                .ok_or("Question missing 'options'")?;

            let mut options: Vec<QuestionOption> = Vec::new();
            for opt in options_data {
                let label = opt.get("label")
                    .and_then(|v| v.as_str())
                    .ok_or("Option missing 'label'")?
                    .to_string();
                
                let description = opt.get("description")
                    .and_then(|v| v.as_str())
                    .ok_or("Option missing 'description'")?
                    .to_string();
                
                let value = opt.get("value")
                    .and_then(|v| v.as_str())
                    .ok_or("Option missing 'value'")?
                    .to_string();

                options.push(QuestionOption {
                    label,
                    description,
                    value,
                });
            }

            let multiple = q.get("multiple")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            questions.push(Question {
                id,
                header,
                question: question_text,
                options,
                multiple,
            });
        }

        // Generate unique ID for this question set
        let question_id = Uuid::new_v4().to_string();

        // Create channel for receiving answer
        let (tx, rx) = oneshot::channel();

        // Store the sender in global registry
        {
            let registry = GLOBAL_QUESTION_REGISTRY.clone();
            let mut pending = registry.lock()
                .map_err(|e| format!("Failed to lock question registry: {}", e))?;
            pending.insert(question_id.clone(), tx);
        }

        // Emit event to frontend
        let request = QuestionRequest {
            id: question_id.clone(),
            questions,
        };

        self.app.emit("agent:question", request)
            .map_err(|e| format!("Failed to emit question event: {}", e))?;

        // Wait for response (with timeout)
        let timeout_duration = std::time::Duration::from_secs(300); // 5 minute timeout
        
        let answers = match tokio::time::timeout(timeout_duration, rx).await {
            Ok(Ok(answers)) => answers,
            Ok(Err(_)) => return Err("Question channel closed unexpectedly".to_string()),
            Err(_) => {
                // Timeout - clean up
                let registry = GLOBAL_QUESTION_REGISTRY.clone();
                let mut pending = registry.lock()
                    .map_err(|e| format!("Failed to lock question registry: {}", e))?;
                pending.remove(&question_id);
                return Err("Question timed out - no response within 5 minutes".to_string());
            }
        };

        Ok(json!({
            "question_id": question_id,
            "answers": answers,
            "completed": true
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_question_parsing() {
        let input = json!({
            "questions": [{
                "id": "q1",
                "header": "Test",
                "question": "What is your choice?",
                "options": [
                    {"label": "Option A", "description": "First option", "value": "a"},
                    {"label": "Option B", "description": "Second option", "value": "b"}
                ]
            }]
        });

        let questions = input.get("questions").unwrap().as_array().unwrap();
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].get("id").unwrap().as_str().unwrap(), "q1");
    }

    #[test]
    fn test_question_missing_field() {
        let input = json!({
            "questions": [{
                "id": "q1",
                // Missing header
                "question": "What?",
                "options": []
            }]
        });

        let result = input.get("questions").unwrap()[0].get("header");
        assert!(result.is_none());
    }
}
