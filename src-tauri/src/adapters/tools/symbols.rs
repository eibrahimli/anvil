use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use crate::domain::treesitter;
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

// Legacy symbol struct kept for regex fallback serialization.
#[derive(serde::Serialize)]
struct LegacySymbol {
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
            "description": "List all symbols (functions, classes, methods, interfaces, structs, enums, constants, type aliases) in a source file using AST-based parsing. Supports Rust, TypeScript, TSX, JavaScript, JSX, Python, Go, C, and Bash.",
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
        let path_str = input
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'path' parameter")?;

        let path = self.workspace_root.join(path_str);

        // Canonicalize to resolve `..` components and symlinks before the security check.
        let canonical_workspace = self.workspace_root.canonicalize()
            .unwrap_or_else(|_| self.workspace_root.clone());
        let canonical_path = std::fs::canonicalize(&path)
            .map_err(|e| format!("Failed to read file: {}", e))?;

        if !canonical_path.starts_with(&canonical_workspace) {
            return Err("Access denied: Path is outside workspace".to_string());
        }

        let content = fs::read_to_string(&canonical_path)
            .await
            .map_err(|e| format!("Failed to read file: {}", e))?;

        // ── Tree-sitter path ────────────────────────────────────────────────
        if let Some(lang) = treesitter::detect_language(&path) {
            let lang_str = lang.as_str().to_string();
            let symbols = treesitter::extract_symbols(&content, &lang);
            let count = symbols.len();
            return Ok(json!({
                "symbols": symbols,
                "count": count,
                "path": path_str,
                "language": lang_str
            }));
        }

        // ── Regex fallback for unsupported extensions ────────────────────────
        let symbols = regex_fallback(&content);
        Ok(json!({
            "symbols": symbols,
            "count": symbols.len(),
            "path": path_str,
            "language": "unknown"
        }))
    }
}

/// Regex-based extraction used when tree-sitter has no grammar for the file type.
fn regex_fallback(content: &str) -> Vec<LegacySymbol> {
    let patterns: &[(&str, &str)] = &[
        (r"(?m)^fn\s+(\w+)", "function"),
        (r"(?m)^pub\s+fn\s+(\w+)", "function"),
        (r"(?m)^struct\s+(\w+)", "struct"),
        (r"(?m)^enum\s+(\w+)", "enum"),
        (r"(?m)^trait\s+(\w+)", "trait"),
        (r"(?m)^export\s+function\s+(\w+)", "function"),
        (r"(?m)^function\s+(\w+)", "function"),
        (r"(?m)^export\s+class\s+(\w+)", "class"),
        (r"(?m)^class\s+(\w+)", "class"),
        (r"(?m)^export\s+interface\s+(\w+)", "interface"),
        (r"(?m)^interface\s+(\w+)", "interface"),
        (r"(?m)^def\s+(\w+)", "function"),
    ];

    let mut symbols: Vec<LegacySymbol> = Vec::new();
    for (pattern, kind) in patterns {
        let re = match Regex::new(pattern) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for cap in re.captures_iter(content) {
            if let Some(m) = cap.get(1) {
                let line = content[..m.start()].lines().count();
                symbols.push(LegacySymbol {
                    name: m.as_str().to_string(),
                    kind: kind.to_string(),
                    line,
                });
            }
        }
    }
    symbols.sort_by_key(|s| s.line);
    symbols
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ports::Tool;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

    async fn tool(dir: &TempDir) -> SymbolsTool {
        SymbolsTool::new(dir.path().to_path_buf())
    }

    // ── Tree-sitter integration ───────────────────────────────────────────────

    #[tokio::test]
    async fn test_symbols_tool_rust_file() {
        let dir = TempDir::new().unwrap();
        let src = r#"
struct Config { host: String }
impl Config {
    pub fn new(host: String) -> Self { Config { host } }
    fn validate(&self) -> bool { true }
}
fn main() {}
"#;
        let mut f = File::create(dir.path().join("main.rs")).unwrap();
        f.write_all(src.as_bytes()).unwrap();

        let t = tool(&dir).await;
        let result = t.execute(json!({ "path": "main.rs" })).await.unwrap();

        assert_eq!(result["language"], "rust");
        let symbols = result["symbols"].as_array().unwrap();
        let names: Vec<&str> = symbols
            .iter()
            .map(|s| s["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"Config"), "expected Config struct");
        assert!(names.contains(&"main"), "expected main fn");
        // Methods should have a parent field
        let new_method = symbols.iter().find(|s| s["name"] == "new").unwrap();
        assert_eq!(new_method["parent"], "Config");
        // line_end should be present
        assert!(new_method.get("line_end").is_some());
    }

    #[tokio::test]
    async fn test_symbols_tool_typescript_file() {
        let dir = TempDir::new().unwrap();
        let src = "export function greet(name: string) {}\nexport class App { render() {} }";
        let mut f = File::create(dir.path().join("app.ts")).unwrap();
        f.write_all(src.as_bytes()).unwrap();

        let t = tool(&dir).await;
        let result = t.execute(json!({ "path": "app.ts" })).await.unwrap();

        assert_eq!(result["language"], "typescript");
        let symbols = result["symbols"].as_array().unwrap();
        let names: Vec<&str> = symbols
            .iter()
            .map(|s| s["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"greet"));
        assert!(names.contains(&"App"));
        assert!(names.contains(&"render"));
    }

    #[tokio::test]
    async fn test_symbols_tool_python_file() {
        let dir = TempDir::new().unwrap();
        let src = "class Agent:\n    def run(self):\n        pass\n";
        let mut f = File::create(dir.path().join("agent.py")).unwrap();
        f.write_all(src.as_bytes()).unwrap();

        let t = tool(&dir).await;
        let result = t.execute(json!({ "path": "agent.py" })).await.unwrap();

        assert_eq!(result["language"], "python");
        let symbols = result["symbols"].as_array().unwrap();
        let run = symbols.iter().find(|s| s["name"] == "run").unwrap();
        assert_eq!(run["parent"], "Agent");
    }

    // ── Regex fallback ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_symbols_tool_fallback_for_unsupported_extension() {
        let dir = TempDir::new().unwrap();
        // .sql is not supported by tree-sitter — regex fallback fires.
        let src = "-- SQL does not have regex symbols either";
        let mut f = File::create(dir.path().join("schema.sql")).unwrap();
        f.write_all(src.as_bytes()).unwrap();

        let t = tool(&dir).await;
        let result = t.execute(json!({ "path": "schema.sql" })).await.unwrap();

        // Should succeed without crashing, return language: "unknown".
        assert_eq!(result["language"], "unknown");
    }

    // ── Security ──────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_symbols_tool_path_traversal_denied() {
        let dir = TempDir::new().unwrap();
        let t = tool(&dir).await;
        let result = t.execute(json!({ "path": "../../etc/passwd" })).await;
        assert!(result.is_err(), "path traversal should be denied");
    }

    // ── Count field ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_symbols_count_matches_array_length() {
        let dir = TempDir::new().unwrap();
        let src = "fn a() {}\nfn b() {}\nfn c() {}";
        let mut f = File::create(dir.path().join("lib.rs")).unwrap();
        f.write_all(src.as_bytes()).unwrap();

        let t = tool(&dir).await;
        let result = t.execute(json!({ "path": "lib.rs" })).await.unwrap();
        let symbols = result["symbols"].as_array().unwrap();
        let count = result["count"].as_u64().unwrap() as usize;
        assert_eq!(count, symbols.len());
    }
}
