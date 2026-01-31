use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::PathBuf;
use tokio::fs;
use regex::Regex;

pub struct SymbolsTool {
    pub workspace_root: PathBuf,
}

impl SymbolsTool {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }
}

#[derive(serde::Serialize)]
struct Symbol {
    name: String,
    kind: String,
    line: usize,
}

#[async_trait]
impl Tool for SymbolsTool {
    fn name(&self) -> &'static str {
        "list_symbols"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "list_symbols",
            "description": "List all symbols (functions, classes, interfaces) in a file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to the file relative to workspace root"
                    }
                },
                "required": ["path"]
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let path_str = input.get("path")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'path' parameter")?;

        let path = self.workspace_root.join(path_str);

        if !path.starts_with(&self.workspace_root) {
            return Err("Access denied: Path is outside workspace".to_string());
        }

        let content = fs::read_to_string(path).await
            .map_err(|e| format!("Failed to read file: {}", e))?;

        let mut symbols = Vec::new();
        
        // Very basic regex-based symbol detection
        // Patterns for Rust, TS, JS, Python
        let patterns = [
            (r"(?m)^fn\s+(\w+)", "function"),                // Rust fn
            (r"(?m)^pub\s+fn\s+(\w+)", "function"),          // Rust pub fn
            (r"(?m)^struct\s+(\w+)", "struct"),              // Rust struct
            (r"(?m)^enum\s+(\w+)", "enum"),                  // Rust enum
            (r"(?m)^trait\s+(\w+)", "trait"),                // Rust trait
            (r"(?m)^export\s+function\s+(\w+)", "function"), // TS/JS export fn
            (r"(?m)^function\s+(\w+)", "function"),          // TS/JS fn
            (r"(?m)^export\s+class\s+(\w+)", "class"),       // TS/JS class
            (r"(?m)^class\s+(\w+)", "class"),                // TS/JS/Py class
            (r"(?m)^export\s+interface\s+(\w+)", "interface"), // TS interface
            (r"(?m)^interface\s+(\w+)", "interface"),        // TS interface
            (r"(?m)^def\s+(\w+)", "function"),                // Python def
        ];

        for (pattern, kind) in patterns {
            let re = Regex::new(pattern).unwrap();
            for cap in re.captures_iter(&content) {
                if let Some(m) = cap.get(1) {
                    let line = content[..m.start()].lines().count();
                    symbols.push(Symbol {
                        name: m.as_str().to_string(),
                        kind: kind.to_string(),
                        line,
                    });
                }
            }
        }

        symbols.sort_by_key(|s| s.line);

        Ok(json!({
            "symbols": symbols,
            "count": symbols.len(),
            "path": path_str
        }))
    }
}
