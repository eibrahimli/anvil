use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::{timeout, Duration};
use tokio::sync::oneshot;
use url::Url;
use uuid::Uuid;

fn expand_tilde(input: &str) -> String {
    if input.starts_with("~") {
        if let Some(home) = dirs::home_dir() {
            return input.replacen("~", &home.to_string_lossy(), 1);
        }
    }
    input.to_string()
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component),
        }
    }
    normalized
}

fn canonicalize_or_normalize(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| normalize_path(path))
}

fn path_variants(input: &str, workspace_root: &Path) -> Vec<String> {
    if input.trim().is_empty() {
        return Vec::new();
    }

    let expanded = expand_tilde(input);
    let path = if Path::new(&expanded).is_absolute() {
        PathBuf::from(&expanded)
    } else {
        workspace_root.join(&expanded)
    };

    let normalized = normalize_path(&path);
    let mut variants = Vec::new();
    let absolute = normalized.to_string_lossy().to_string();
    if !absolute.is_empty() {
        variants.push(absolute.clone());
    }

    if normalized.starts_with(workspace_root) {
        if let Ok(relative) = normalized.strip_prefix(workspace_root) {
            let relative = relative.to_string_lossy().to_string();
            if !relative.is_empty() {
                variants.push(relative);
            }
        }
    }

    variants
}

fn add_allow_rule_with_variants(
    rules: &mut Vec<crate::config::manager::PermissionRule>,
    pattern: String,
    suggested_pattern: &str,
    workspace_root: &Path,
) {
    if pattern.trim().is_empty() {
        return;
    }

    let mut push_rule = |value: String| {
        if value.trim().is_empty() {
            return;
        }
        let exists = rules.iter().any(|rule| {
            rule.pattern == value && rule.action == crate::config::Action::Allow
        });
        if !exists {
            rules.push(crate::config::manager::PermissionRule {
                pattern: value,
                action: crate::config::Action::Allow,
            });
        }
    };

    push_rule(pattern.clone());

    if pattern == suggested_pattern {
        for variant in path_variants(suggested_pattern, workspace_root) {
            if variant != pattern {
                push_rule(variant);
            }
        }
    }
}

pub struct LspTool {
    pub workspace_root: PathBuf,
    pub permission_manager: std::sync::Arc<tokio::sync::Mutex<crate::config::PermissionConfig>>,
    pub lsp_config: Option<crate::config::LspConfig>,
    pub session_id: String,
    pub app: AppHandle,
    pub pending_confirmations: std::sync::Arc<Mutex<HashMap<String, oneshot::Sender<crate::domain::models::ConfirmationResponse>>>>,
}

impl LspTool {
    pub fn new(
        workspace_root: PathBuf,
        permission_manager: std::sync::Arc<tokio::sync::Mutex<crate::config::PermissionConfig>>,
        lsp_config: Option<crate::config::LspConfig>,
        session_id: String,
        app: AppHandle,
        pending_confirmations: std::sync::Arc<Mutex<HashMap<String, oneshot::Sender<crate::domain::models::ConfirmationResponse>>>>,
    ) -> Self {
        Self { workspace_root, permission_manager, lsp_config, session_id, app, pending_confirmations }
    }

    async fn request_confirmation(
        &self,
        input: &str,
        suggested_pattern: String,
    ) -> Result<crate::domain::models::ConfirmationResponse, String> {
        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();

        {
            let mut map = self.pending_confirmations.lock().unwrap();
            map.insert(request_id.clone(), tx);
        }

        let event = PermissionConfirmationRequest {
            id: request_id.clone(),
            session_id: self.session_id.clone(),
            type_: "permission".to_string(),
            tool_name: "lsp".to_string(),
            input: input.to_string(),
            suggested_pattern,
        };

        self.app.emit("request-confirmation", &event)
            .map_err(|e| format!("Failed to emit confirmation event: {}", e))?;

        rx.await.map_err(|_| "Confirmation channel closed without response".to_string())
    }
}

#[derive(Serialize, Clone)]
struct PermissionConfirmationRequest {
    id: String,
    session_id: String,
    #[serde(rename = "type")]
    type_: String,
    tool_name: String,
    input: String,
    suggested_pattern: String,
}

#[derive(Debug, Deserialize)]
struct LspInput {
    path: String,
    request: String,
    #[serde(default)]
    line: Option<u64>,
    #[serde(default)]
    character: Option<u64>,
    #[serde(default)]
    language_id: Option<String>,
    #[serde(default)]
    server: Option<String>,
    #[serde(default)]
    include_declaration: Option<bool>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

#[async_trait]
impl Tool for LspTool {
    fn name(&self) -> &'static str {
        "lsp"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "lsp",
            "description": "Query an LSP server for definitions, references, or diagnostics.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to the file relative to workspace root"
                    },
                    "request": {
                        "type": "string",
                        "enum": ["definition", "references", "diagnostics"],
                        "description": "LSP request type"
                    },
                    "line": {
                        "type": "integer",
                        "description": "0-based line number"
                    },
                    "character": {
                        "type": "integer",
                        "description": "0-based character offset"
                    },
                    "language_id": {
                        "type": "string",
                        "description": "Optional languageId override (e.g. rust, typescript)"
                    },
                    "server": {
                        "type": "string",
                        "description": "Optional LSP server command to use"
                    },
                    "include_declaration": {
                        "type": "boolean",
                        "description": "Include declaration in references request"
                    },
                    "timeout_ms": {
                        "type": "integer",
                        "description": "Timeout in milliseconds for LSP response"
                    }
                },
                "required": ["path", "request"]
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let args: LspInput = serde_json::from_value(input)
            .map_err(|e| format!("Invalid LSP input: {}", e))?;

        let config = self.lsp_config.clone().ok_or("LSP not configured. Set lsp.enabled and lsp.servers in .anvil/anvil.json".to_string())?;
        if config.enabled == Some(false) {
            return Err("LSP is disabled. Enable lsp.enabled in .anvil/anvil.json".to_string());
        }

        let servers = config.servers.unwrap_or_default();
        if servers.is_empty() {
            return Err("No LSP servers configured. Set lsp.servers in .anvil/anvil.json".to_string());
        }

        let server_command = if let Some(server) = args.server.as_ref() {
            if servers.iter().any(|entry| entry == server) {
                server.clone()
            } else {
                return Err(format!("Requested LSP server not found in config: {}", server));
            }
        } else {
            servers[0].clone()
        };

        let path = resolve_target_path(&self.workspace_root, &args.path)?;

        let location_action = {
            let config = self.permission_manager.lock().await;
            config.check_path_access(&path, &self.workspace_root)
        };
        if location_action == crate::config::Action::Deny {
            return Err("Access denied: Path is outside workspace and not allowed by config".to_string());
        }
        if location_action == crate::config::Action::Ask {
            let input = path.to_string_lossy().to_string();
            let suggested_pattern = canonicalize_or_normalize(&path).to_string_lossy().to_string();
            let response = self.request_confirmation(&input, suggested_pattern.clone()).await?;
            if !response.allowed {
                return Err("User denied external path access.".to_string());
            }
            if response.always {
                let pattern = response.pattern.unwrap_or(suggested_pattern);
                let mut config = self.permission_manager.lock().await;
                let rules = config.external_directory.get_or_insert_with(HashMap::new);
                rules.insert(pattern, crate::config::Action::Allow);
            }
        }

        let action = {
            let config = self.permission_manager.lock().await;
            config.read.evaluate(&args.path)
        };
        match action {
            crate::config::Action::Deny => {
                return Err("Access denied: Permission denied for this file type".to_string());
            }
            crate::config::Action::Ask => {
                let suggested_pattern = args.path.clone();
                let response = self.request_confirmation(&args.path, suggested_pattern.clone()).await?;
                if !response.allowed {
                    return Err("User denied file access.".to_string());
                }
                if response.always {
                    let pattern = response.pattern.unwrap_or(suggested_pattern.clone());
                    let mut config = self.permission_manager.lock().await;
                    add_allow_rule_with_variants(
                        &mut config.read.rules,
                        pattern,
                        &suggested_pattern,
                        &self.workspace_root,
                    );
                }
            }
            crate::config::Action::Allow => {}
        }

        let file_content = tokio::fs::read_to_string(&path).await
            .map_err(|e| format!("Failed to read file: {}", e))?;

        let language_id = args.language_id
            .or_else(|| infer_language_id(&path).map(|id| id.to_string()))
            .unwrap_or_else(|| "plaintext".to_string());

        let line = args.line.unwrap_or(0);
        let character = args.character.unwrap_or(0);
        let include_declaration = args.include_declaration.unwrap_or(false);
        let timeout_ms = args.timeout_ms.unwrap_or(4000);

        let result = run_lsp_request(
            &server_command,
            &self.workspace_root,
            &path,
            &language_id,
            &file_content,
            &args.request,
            line,
            character,
            include_declaration,
            Duration::from_millis(timeout_ms),
        ).await?;

        Ok(json!({
            "server": server_command,
            "request": args.request,
            "result": result,
        }))
    }
}

fn resolve_target_path(workspace_root: &Path, input_path: &str) -> Result<PathBuf, String> {
    let expanded_path = if input_path.starts_with("~") {
        if let Some(home) = dirs::home_dir() {
            input_path.replacen("~", &home.to_string_lossy(), 1)
        } else {
            input_path.to_string()
        }
    } else {
        input_path.to_string()
    };

    if Path::new(&expanded_path).is_absolute() {
        Ok(PathBuf::from(expanded_path))
    } else {
        Ok(workspace_root.join(expanded_path))
    }
}

fn path_to_uri(path: &Path) -> Result<String, String> {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    Url::from_file_path(canonical)
        .map(|url| url.to_string())
        .map_err(|_| "Failed to convert file path to URI".to_string())
}

fn parse_server_command(command: &str) -> Result<(String, Vec<String>), String> {
    let mut parts = command.split_whitespace();
    let program = parts.next().ok_or("LSP server command is empty")?.to_string();
    let args = parts.map(|part| part.to_string()).collect::<Vec<_>>();
    Ok((program, args))
}

fn infer_language_id(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("rs") => Some("rust"),
        Some("ts") => Some("typescript"),
        Some("tsx") => Some("typescriptreact"),
        Some("js") => Some("javascript"),
        Some("jsx") => Some("javascriptreact"),
        Some("py") => Some("python"),
        Some("go") => Some("go"),
        Some("java") => Some("java"),
        Some("c") => Some("c"),
        Some("h") => Some("c"),
        Some("cpp") => Some("cpp"),
        Some("hpp") => Some("cpp"),
        Some("json") => Some("json"),
        Some("yaml") | Some("yml") => Some("yaml"),
        Some("md") => Some("markdown"),
        _ => None,
    }
}

async fn write_message(writer: &mut tokio::process::ChildStdin, value: &Value) -> Result<(), String> {
    let payload = value.to_string();
    let header = format!("Content-Length: {}\r\n\r\n", payload.as_bytes().len());
    writer.write_all(header.as_bytes()).await.map_err(|e| e.to_string())?;
    writer.write_all(payload.as_bytes()).await.map_err(|e| e.to_string())?;
    writer.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn read_message(reader: &mut BufReader<tokio::process::ChildStdout>) -> Result<Value, String> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let bytes = reader.read_line(&mut line).await.map_err(|e| e.to_string())?;
        if bytes == 0 {
            return Err("LSP server closed the connection".to_string());
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = value.trim().parse::<usize>().ok();
        }
    }

    let length = content_length.ok_or("Missing Content-Length header from LSP server".to_string())?;
    let mut buffer = vec![0u8; length];
    reader.read_exact(&mut buffer).await.map_err(|e| e.to_string())?;
    serde_json::from_slice(&buffer).map_err(|e| format!("Invalid LSP JSON: {}", e))
}

async fn read_response_with_id(
    reader: &mut BufReader<tokio::process::ChildStdout>,
    expected_id: i64,
    timeout_duration: Duration,
) -> Result<Value, String> {
    let deadline = tokio::time::Instant::now() + timeout_duration;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("Timed out waiting for LSP response".to_string());
        }
        let message = timeout(remaining, read_message(reader))
            .await
            .map_err(|_| "Timed out waiting for LSP response".to_string())??;
        if message.get("id").and_then(|id| id.as_i64()) == Some(expected_id) {
            return Ok(message);
        }
    }
}

async fn request_with_retry(
    stdin: &mut tokio::process::ChildStdin,
    reader: &mut BufReader<tokio::process::ChildStdout>,
    method: &str,
    params: Value,
    timeout_duration: Duration,
) -> Result<Value, String> {
    let mut attempt = 0;
    loop {
        let id = 2 + attempt;
        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        write_message(stdin, &request).await?;
        let response = read_response_with_id(reader, id, timeout_duration).await?;

        if let Some(error) = response.get("error") {
            return Err(format!("LSP error: {}", error));
        }

        let result = response.get("result").cloned().unwrap_or(json!(null));
        if !result.is_null() || attempt > 0 {
            return Ok(result);
        }

        attempt += 1;
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn collect_diagnostics(
    reader: &mut BufReader<tokio::process::ChildStdout>,
    uri: &str,
    timeout_duration: Duration,
) -> Result<Value, String> {
    let deadline = tokio::time::Instant::now() + timeout_duration;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Ok(json!([]));
        }

        let message = match timeout(remaining, read_message(reader)).await {
            Ok(result) => result?,
            Err(_) => return Ok(json!([])),
        };

        if message.get("method").and_then(|m| m.as_str()) == Some("textDocument/publishDiagnostics") {
            if let Some(params) = message.get("params") {
                if params.get("uri").and_then(|u| u.as_str()) == Some(uri) {
                    return Ok(params.get("diagnostics").cloned().unwrap_or(json!([])));
                }
            }
        }
    }
}

async fn run_lsp_request(
    server_command: &str,
    workspace_root: &Path,
    file_path: &Path,
    language_id: &str,
    file_content: &str,
    request_type: &str,
    line: u64,
    character: u64,
    include_declaration: bool,
    timeout_duration: Duration,
) -> Result<Value, String> {
    let (program, args) = parse_server_command(server_command)?;

    let mut child = Command::new(program)
        .args(args)
        .current_dir(workspace_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start LSP server: {}", e))?;

    let mut stdin = child.stdin.take().ok_or("Failed to open LSP stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to open LSP stdout")?;
    let mut reader = BufReader::new(stdout);

    let workspace_uri = path_to_uri(workspace_root)?;
    let document_uri = path_to_uri(file_path)?;
    let workspace_name = workspace_root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("workspace")
        .to_string();

    let initialize = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "processId": std::process::id(),
            "rootUri": workspace_uri,
            "rootPath": workspace_root.to_string_lossy(),
            "workspaceFolders": [{
                "uri": workspace_uri,
                "name": workspace_name,
            }],
            "capabilities": {
                "textDocument": {
                    "definition": { "dynamicRegistration": false },
                    "references": { "dynamicRegistration": false }
                }
            }
        }
    });

    write_message(&mut stdin, &initialize).await?;
    let _ = read_response_with_id(&mut reader, 1, timeout_duration).await?;

    let initialized = json!({
        "jsonrpc": "2.0",
        "method": "initialized",
        "params": {}
    });
    write_message(&mut stdin, &initialized).await?;

    let did_open = json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didOpen",
        "params": {
            "textDocument": {
                "uri": document_uri,
                "languageId": language_id,
                "version": 1,
                "text": file_content
            }
        }
    });
    write_message(&mut stdin, &did_open).await?;
    tokio::time::sleep(Duration::from_millis(150)).await;

    let result = match request_type {
        "definition" => {
            request_with_retry(
                &mut stdin,
                &mut reader,
                "textDocument/definition",
                json!({
                    "textDocument": { "uri": document_uri },
                    "position": { "line": line, "character": character }
                }),
                timeout_duration,
            ).await?
        }
        "references" => {
            request_with_retry(
                &mut stdin,
                &mut reader,
                "textDocument/references",
                json!({
                    "textDocument": { "uri": document_uri },
                    "position": { "line": line, "character": character },
                    "context": { "includeDeclaration": include_declaration }
                }),
                timeout_duration,
            ).await?
        }
        "diagnostics" => {
            collect_diagnostics(&mut reader, &document_uri, timeout_duration).await?
        }
        _ => {
            return Err("Unsupported LSP request. Use definition, references, or diagnostics".to_string());
        }
    };

    let shutdown = json!({
        "jsonrpc": "2.0",
        "id": 99,
        "method": "shutdown",
        "params": null
    });
    let _ = write_message(&mut stdin, &shutdown).await;
    let _ = read_response_with_id(&mut reader, 99, timeout_duration).await;

    let exit = json!({
        "jsonrpc": "2.0",
        "method": "exit",
        "params": null
    });
    let _ = write_message(&mut stdin, &exit).await;

    let _ = child.kill().await;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{infer_language_id, parse_server_command};
    use std::path::PathBuf;

    #[test]
    fn infer_language_from_extension() {
        assert_eq!(infer_language_id(&PathBuf::from("main.rs")), Some("rust"));
        assert_eq!(infer_language_id(&PathBuf::from("app.tsx")), Some("typescriptreact"));
        assert_eq!(infer_language_id(&PathBuf::from("script.py")), Some("python"));
        assert_eq!(infer_language_id(&PathBuf::from("README.md")), Some("markdown"));
    }

    #[test]
    fn parse_server_command_splits_args() {
        let (program, args) = parse_server_command("typescript-language-server --stdio").unwrap();
        assert_eq!(program, "typescript-language-server");
        assert_eq!(args, vec!["--stdio".to_string()]);
    }

    #[test]
    fn parse_server_command_requires_program() {
        let err = parse_server_command("").unwrap_err();
        assert!(err.contains("empty"));
    }
}
