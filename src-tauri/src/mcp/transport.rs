use crate::mcp::error::{McpError, Result};
use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures::StreamExt;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::{mpsc, Mutex, RwLock};

/// Transport trait for MCP connections
#[async_trait]
pub trait Transport: Send + Sync {
    /// Send a JSON-RPC request and receive response
    async fn send_request(&self, request: Value) -> Result<Value>;

    /// Send a raw message without waiting for response (for notifications)
    async fn send_raw(&self, message: String) -> Result<()>;

    /// Close the transport
    async fn close(&mut self) -> Result<()>;

    /// Check if transport is connected
    fn is_connected(&self) -> bool;
}

/// Stdio transport for local MCP servers
#[derive(Debug)]
pub struct StdioTransport {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    response_rx: Arc<Mutex<mpsc::Receiver<Value>>>,
    request_id_counter: Arc<RwLock<u64>>,
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl StdioTransport {
    pub async fn new(command: Vec<String>, env: HashMap<String, String>) -> Result<Self> {
        if command.is_empty() {
            return Err(McpError::Config("Command cannot be empty".to_string()));
        }

        let mut cmd = tokio::process::Command::new(&command[0]);

        // Add arguments
        if command.len() > 1 {
            cmd.args(&command[1..]);
        }

        // Set environment variables
        for (key, value) in env {
            cmd.env(&key, &value);
        }

        // Spawn process with stdin/stdout/stderr
        let mut child = cmd
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null()) // Ignore stderr for now
            .spawn()
            .map_err(|e| McpError::Connection(format!("Failed to spawn process: {}", e)))?;

        let stdin = child
            .stdin
            .take()
            .ok_or(McpError::Connection("Failed to get stdin".to_string()))?;

        let stdout = child
            .stdout
            .take()
            .ok_or(McpError::Connection("Failed to get stdout".to_string()))?;

        // Channel for responses
        let (response_tx, response_rx) = mpsc::channel::<Value>(100);
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

        // Start reader task
        let child_arc = Arc::new(Mutex::new(child));
        let child_for_reader = child_arc.clone();

        tokio::spawn(async move {
            Self::reader_task(stdout, response_tx, shutdown_rx, child_for_reader).await;
        });

        Ok(Self {
            child: child_arc,
            stdin: Arc::new(Mutex::new(stdin)),
            response_rx: Arc::new(Mutex::new(response_rx)),
            request_id_counter: Arc::new(RwLock::new(0)),
            shutdown_tx: Some(shutdown_tx),
        })
    }

    /// Background task to read responses from stdout
    async fn reader_task(
        stdout: ChildStdout,
        response_tx: mpsc::Sender<Value>,
        mut shutdown_rx: mpsc::Receiver<()>,
        child: Arc<Mutex<Child>>,
    ) {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();

        loop {
            line.clear();

            tokio::select! {
                result = reader.read_line(&mut line) => {
                    match result {
                        Ok(0) => {
                            // EOF - process exited
                            break;
                        }
                        Ok(_) => {
                            let trimmed = line.trim();
                            if !trimmed.is_empty() {
                                if let Ok(json) = serde_json::from_str::<Value>(trimmed) {
                                    let _ = response_tx.send(json).await;
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
                _ = shutdown_rx.recv() => {
                    break;
                }
            }
        }

        // Ensure child is killed when reader exits
        let mut child_guard = child.lock().await;
        let _ = child_guard.kill().await;
        let _ = child_guard.wait().await;
    }

    /// Send a raw message without waiting for response
    async fn send_raw_internal(&self, message: String) -> Result<()> {
        let mut stdin_guard = self.stdin.lock().await;

        stdin_guard
            .write_all(message.as_bytes())
            .await
            .map_err(|e| McpError::Transport(format!("Failed to write to stdin: {}", e)))?;
        stdin_guard
            .write_all(b"\n")
            .await
            .map_err(|e| McpError::Transport(format!("Failed to write newline: {}", e)))?;
        stdin_guard
            .flush()
            .await
            .map_err(|e| McpError::Transport(format!("Failed to flush stdin: {}", e)))?;

        Ok(())
    }

    fn get_next_request_id(&self) -> u64 {
        let mut counter = self.request_id_counter.try_write().unwrap();
        *counter += 1;
        *counter
    }
}

#[async_trait]
impl Transport for StdioTransport {
    async fn send_request(&self, request: Value) -> Result<Value> {
        // Ensure request has an id
        let mut request = request;
        let request_id = request
            .get("id")
            .and_then(|v| v.as_u64())
            .unwrap_or_else(|| {
                let id = self.get_next_request_id();
                request["id"] = Value::from(id);
                id
            });

        let json_str = serde_json::to_string(&request)
            .map_err(|e| McpError::Protocol(format!("Failed to serialize request: {}", e)))?;

        self.send_raw_internal(json_str).await?;

        // Wait for response with matching id
        let mut rx = self.response_rx.lock().await;
        let timeout = tokio::time::Duration::from_secs(60); // Increased for npx download time

        let response = tokio::time::timeout(timeout, async {
            while let Some(msg) = rx.recv().await {
                // Check if this is the response we're looking for
                if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                    if id == request_id {
                        return Some(msg);
                    }
                }
                // Continue waiting if this is a notification or different response
            }
            None
        })
        .await
        .map_err(|_| McpError::Timeout("Request timed out".to_string()))?
        .ok_or_else(|| McpError::Transport("Reader channel closed".to_string()))?;

        // Check for JSON-RPC error
        if let Some(error) = response.get("error") {
            let code = error
                .get("code")
                .and_then(|v| v.as_i64())
                .unwrap_or(-1) as i32;
            let message = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            return Err(McpError::JsonRpc {
                code,
                message: message.to_string(),
            });
        }

        Ok(response)
    }

    async fn send_raw(&self, message: String) -> Result<()> {
        self.send_raw_internal(message).await
    }

    async fn close(&mut self) -> Result<()> {
        // Signal reader to stop
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(()).await;
        }

        // Give reader a moment to clean up
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Ensure child is killed
        let mut child_guard = self.child.lock().await;
        if let Err(e) = child_guard.kill().await {
            // Process might already be dead, which is fine
            if e.kind() != std::io::ErrorKind::InvalidInput {
                return Err(McpError::Connection(format!(
                    "Failed to kill process: {}",
                    e
                )));
            }
        }

        // Wait for process to fully exit
        let _ = child_guard.wait().await;

        Ok(())
    }

    fn is_connected(&self) -> bool {
        // Check if child process is still running
        if let Ok(mut child) = self.child.try_lock() {
            // try_wait returns Ok(None) if still running, Ok(Some(_)) if exited
            matches!(child.try_wait(), Ok(None))
        } else {
            false
        }
    }
}

/// Streamable HTTP transport for remote MCP servers
pub struct HttpTransport {
    _sse_url: String,
    post_url: Arc<RwLock<Option<String>>>,
    headers: HashMap<String, String>,
    client: reqwest::Client,
    response_rx: Arc<Mutex<mpsc::Receiver<Value>>>,
    request_id_counter: Arc<RwLock<u64>>,
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl HttpTransport {
    pub async fn new(url: String, headers: HashMap<String, String>) -> Result<Self> {
        let client = reqwest::Client::new();
        let (response_tx, response_rx) = mpsc::channel::<Value>(100);
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);
        
        let post_url = Arc::new(RwLock::new(None));
        
        // Start SSE listener
        let sse_client = client.clone();
        let sse_url = url.clone();
        let sse_headers = headers.clone();
        let post_url_clone = post_url.clone();
        
        tokio::spawn(async move {
            Self::sse_task(
                sse_client, 
                sse_url, 
                sse_headers, 
                post_url_clone, 
                response_tx, 
                shutdown_rx
            ).await;
        });

        Ok(Self {
            _sse_url: url,
            post_url,
            headers,
            client,
            response_rx: Arc::new(Mutex::new(response_rx)),
            request_id_counter: Arc::new(RwLock::new(0)),
            shutdown_tx: Some(shutdown_tx),
        })
    }

    async fn sse_task(
        client: reqwest::Client,
        url: String,
        headers: HashMap<String, String>,
        post_url: Arc<RwLock<Option<String>>>,
        response_tx: mpsc::Sender<Value>,
        mut shutdown_rx: mpsc::Receiver<()>,
    ) {
        let mut request = client.get(&url);
        for (key, value) in &headers {
            request = request.header(key, value);
        }
        
        // Add Accept: text/event-stream header
        request = request.header("Accept", "text/event-stream");

        match request.send().await {
            Ok(response) => {
                if !response.status().is_success() {
                    eprintln!("[MCP SSE] Connection failed: {}", response.status());
                    return;
                }

                let mut stream = response.bytes_stream().eventsource();

                loop {
                    tokio::select! {
                        event = stream.next() => {
                            match event {
                                Some(Ok(event)) => {
                                    match event.event.as_str() {
                                        "endpoint" => {
                                            // Handle endpoint discovery
                                            let endpoint = event.data;
                                            let full_post_url = if endpoint.starts_with("http") {
                                                endpoint
                                            } else {
                                                // Resolve relative URL
                                                let base = reqwest::Url::parse(&url).unwrap();
                                                base.join(&endpoint).unwrap().to_string()
                                            };
                                            
                                            let mut guard = post_url.write().await;
                                            *guard = Some(full_post_url);
                                        },
                                        "message" => {
                                            // Handle JSON-RPC message
                                            if let Ok(json) = serde_json::from_str::<Value>(&event.data) {
                                                let _ = response_tx.send(json).await;
                                            }
                                        },
                                        _ => {} // Ignore other events
                                    }
                                },
                                Some(Err(e)) => {
                                    eprintln!("[MCP SSE] Stream error: {}", e);
                                    break;
                                },
                                None => {
                                    eprintln!("[MCP SSE] Stream ended");
                                    break;
                                }
                            }
                        }
                        _ = shutdown_rx.recv() => {
                            break;
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[MCP SSE] Request failed: {}", e);
            }
        }
    }

    async fn send_raw_internal(&self, message: String) -> Result<()> {
        let post_url = {
            let guard = self.post_url.read().await;
            guard.clone()
        };

        let target_url = post_url.ok_or_else(|| 
            McpError::Connection("SSE connection not established or endpoint not received".to_string())
        )?;

        let request_value: Value = serde_json::from_str(&message)
            .map_err(|e| McpError::Protocol(format!("Invalid JSON: {}", e)))?;
        
        let mut request = self.client.post(&target_url);
        for (key, value) in &self.headers {
            request = request.header(key, value);
        }
        
        let response = request.json(&request_value).send().await
            .map_err(|e| McpError::Transport(format!("HTTP request failed: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(McpError::Transport(format!("HTTP error {}: {}", status, text)));
        }
        
        Ok(())
    }

    fn get_next_request_id(&self) -> u64 {
        let mut counter = self.request_id_counter.try_write().unwrap();
        *counter += 1;
        *counter
    }
}

#[async_trait]
impl Transport for HttpTransport {
    async fn send_request(&self, request: Value) -> Result<Value> {
        // Ensure request has an id
        let mut request = request;
        let request_id = request
            .get("id")
            .and_then(|v| v.as_u64())
            .unwrap_or_else(|| {
                let id = self.get_next_request_id();
                request["id"] = Value::from(id);
                id
            });

        let json_str = serde_json::to_string(&request)
            .map_err(|e| McpError::Protocol(format!("Failed to serialize request: {}", e)))?;

        self.send_raw_internal(json_str).await?;

        // Wait for response from SSE stream
        let mut rx = self.response_rx.lock().await;
        let timeout = tokio::time::Duration::from_secs(30);

        let response = tokio::time::timeout(timeout, async {
            while let Some(msg) = rx.recv().await {
                if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                    if id == request_id {
                        return Some(msg);
                    }
                }
            }
            None
        })
        .await
        .map_err(|_| McpError::Timeout("Request timed out".to_string()))?
        .ok_or_else(|| McpError::Transport("Reader channel closed".to_string()))?;

        if let Some(error) = response.get("error") {
            let code = error.get("code").and_then(|v| v.as_i64()).unwrap_or(-1) as i32;
            let message = error.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error");
            return Err(McpError::JsonRpc { code, message: message.to_string() });
        }

        Ok(response)
    }

    async fn send_raw(&self, message: String) -> Result<()> {
        self.send_raw_internal(message).await
    }

    async fn close(&mut self) -> Result<()> {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(()).await;
        }
        Ok(())
    }

    fn is_connected(&self) -> bool {
        // Check if shutdown channel is still open
        self.shutdown_tx.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn test_stdio_transport_empty_command_error() {
        let result = StdioTransport::new(vec![], HashMap::new()).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Command cannot be empty"));
    }

    #[tokio::test]
    async fn test_stdio_transport_echo_command() {
        // Test with a simple echo-like command that reads stdin and writes to stdout
        // Using cat as a simple passthrough
        let transport = StdioTransport::new(
            vec!["cat".to_string()], // cat will echo back what we send
            HashMap::new(),
        )
        .await
        .expect("Failed to create transport");

        // Test is_connected initially
        assert!(transport.is_connected());

        // Send a JSON-RPC request
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "test",
            "id": 1
        });

        // Since cat just echoes back, we should get the same message
        let response = transport.send_request(request.clone()).await;
        
        // cat echoes the request back as a response
        assert!(response.is_ok());
        let response_value = response.unwrap();
        assert_eq!(response_value["id"], 1);
        assert_eq!(response_value["jsonrpc"], "2.0");
        assert_eq!(response_value["method"], "test");

        // Close transport
        let mut transport = transport;
        transport.close().await.expect("Failed to close transport");

        // Give process time to exit
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Should not be connected after close
        assert!(!transport.is_connected());
    }

    #[tokio::test]
    async fn test_stdio_transport_environment_variables() {
        // Create a script that outputs an environment variable
        let script = r#"#!/bin/sh
read line
echo '{"jsonrpc":"2.0","result":"'$TEST_VAR'","id":1}'"#;

        // Write script to temp file
        let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
        let script_path = temp_dir.path().join("test_script.sh");
        tokio::fs::write(&script_path, script)
            .await
            .expect("Failed to write script");
        
        // Make executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&script_path, perms).unwrap();
        }

        // Create transport with environment variable
        let mut env = HashMap::new();
        env.insert("TEST_VAR".to_string(), "hello_from_env".to_string());

        let transport = StdioTransport::new(
            vec!["sh".to_string(), script_path.to_str().unwrap().to_string()],
            env,
        )
        .await
        .expect("Failed to create transport");

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "test",
            "id": 1
        });

        let response = transport
            .send_request(request)
            .await
            .expect("Failed to send request");

        assert_eq!(response["result"], "hello_from_env");

        // Cleanup
        let mut transport = transport;
        transport.close().await.ok();
    }

    #[tokio::test]
    async fn test_stdio_transport_process_cleanup() {
        // Test that process is properly killed when transport is closed
        let transport = StdioTransport::new(
            vec!["sleep".to_string(), "60".to_string()],
            HashMap::new(),
        )
        .await
        .expect("Failed to create transport");

        assert!(transport.is_connected());

        // Close transport
        let mut transport = transport;
        transport.close().await.expect("Failed to close");

        // Give time for process to be killed
        tokio::time::sleep(Duration::from_millis(200)).await;

        assert!(!transport.is_connected());
    }

    #[tokio::test]
    async fn test_stdio_transport_invalid_command() {
        let result = StdioTransport::new(
            vec!["this_command_definitely_does_not_exist_12345".to_string()],
            HashMap::new(),
        )
        .await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Failed to spawn process"));
    }

    #[tokio::test]
    async fn test_stdio_transport_with_arguments() {
        // Create a Python script that handles JSON-RPC
        let script = r#"import sys, json
while True:
    line = sys.stdin.readline()
    if not line:
        break
    try:
        msg = json.loads(line)
        response = {"jsonrpc": "2.0", "result": "processed", "id": msg.get("id")}
        print(json.dumps(response))
        sys.stdout.flush()
    except:
        pass"#;

        let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
        let script_path = temp_dir.path().join("rpc_server.py");
        tokio::fs::write(&script_path, script)
            .await
            .expect("Failed to write script");

        // Test with Python if available
        if let Ok(transport) = StdioTransport::new(
            vec![
                "python3".to_string(),
                script_path.to_str().unwrap().to_string(),
            ],
            HashMap::new(),
        )
        .await
        {
            let request = serde_json::json!({
                "jsonrpc": "2.0",
                "method": "test",
                "id": 42
            });

            let response = transport
                .send_request(request)
                .await
                .expect("Failed to send request");

            assert_eq!(response["id"], 42);
            assert_eq!(response["result"], "processed");

            let mut transport = transport;
            transport.close().await.ok();
        }
    }

    #[tokio::test]
    async fn test_stdio_transport_request_id_assignment() {
        // Test that requests without id get auto-assigned
        let transport = StdioTransport::new(vec!["cat".to_string()], HashMap::new())
            .await
            .expect("Failed to create transport");

        // Send request without id
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "test"
            // no id field
        });

        let response = transport
            .send_request(request)
            .await
            .expect("Failed to send request");

        // Response should have an id (cat echoes it back)
        assert!(response.get("id").is_some());

        let mut transport = transport;
        transport.close().await.ok();
    }

    #[tokio::test]
    async fn test_http_transport_is_connected() {
        let transport = HttpTransport::new(
            "http://localhost:8080".to_string(),
            HashMap::new(),
        )
        .await
        .unwrap();
        assert!(transport.is_connected()); // HTTP is always "connected" in this implementation
    }
}
