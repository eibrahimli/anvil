use crate::mcp::{McpClient, McpServerConfig, TransportType};
use std::collections::HashMap;

/// Test with @modelcontextprotocol/server-everything (requires Node.js + npx)
#[tokio::test]
#[ignore] // Run with: cargo test -- --ignored mcp::integration_tests
async fn test_with_official_mcp_server() {
    let config = McpServerConfig {
        server_name: "everything".to_string(),
        transport_type: TransportType::Stdio,
        command: Some(vec![
            "npx".to_string(),
            "-y".to_string(),
            "@modelcontextprotocol/server-everything".to_string()
        ]),
        url: None,
        env: None,
        headers: None,
        enabled: true,
        timeout_ms: 30000,
    };

    let client_result = McpClient::new(config).await;
    
    match client_result {
        Ok(client) => {
            println!("✅ MCP Client created");
            
            // Initialize connection
            match client.initialize().await {
                Ok(_) => println!("✅ MCP connection initialized"),
                Err(e) => println!("❌ Initialize failed: {}", e),
            }
            
            // List tools
            let tools = client.get_tools().await;
            println!("📦 Found {} tools:", tools.len());
            for tool in &tools {
                println!("  - {}: {}", tool.name, tool.description);
            }
            
            // Close connection
            let _ = client.close().await;
        }
        Err(e) => {
            println!("❌ Failed to create MCP client: {}", e);
            println!("Prerequisites: Node.js and npx must be installed");
        }
    }
}

/// Test HTTP transport configuration (doesn't need a real MCP server)
#[tokio::test]
#[ignore] // Ignores because it attempts real connection
async fn test_mcp_http_transport_config() {
    let config = McpServerConfig {
        server_name: "remote-test".to_string(),
        transport_type: TransportType::Http,
        command: None,
        url: Some("https://httpbin.org/post".to_string()),
        env: None,
        headers: {
            let mut h = HashMap::new();
            h.insert("Content-Type".to_string(), "application/json".to_string());
            Some(h)
        },
        enabled: true,
        timeout_ms: 30000,
    };

    let client_result = McpClient::new(config).await;
    
    assert!(client_result.is_ok(), "HTTP client should create");
    let client = client_result.unwrap();
    
    assert_eq!(client.server_name(), "remote-test");
    assert!(client.is_connected());
    
    let _ = client.close().await;
}

/// Test with a simple Python echo server (requires Python)
#[tokio::test]
#[ignore] // Run with: cargo test -- --ignored mcp::integration_tests
async fn test_with_python_echo_server() {
    let config = McpServerConfig {
        server_name: "python-test".to_string(),
        transport_type: TransportType::Stdio,
        command: Some(vec![
            "python3".to_string(),
            "-c".to_string(),
            r#"
import sys, json
for line in sys.stdin:
    try:
        request = json.loads(line)
        if request.get('method') == 'ping':
            print(json.dumps({
                'jsonrpc': '2.0',
                'id': request.get('id'),
                'result': {}
            }))
    except:
        break
"#
        .to_string()
        ]),
        url: None,
        env: None,
        headers: None,
        enabled: true,
        timeout_ms: 5000,
    };

    let client_result = McpClient::new(config).await;
    
    match client_result {
        Ok(client) => {
            println!("✅ MCP Client with Python server");
            
            // Try to ping
            match client.ping().await {
                Ok(_) => println!("✅ Ping successful"),
                Err(e) => println!("❌ Ping failed: {}", e),
            }
            
            let _ = client.close().await;
        }
        Err(e) => {
            println!("❌ Failed: {}", e);
            println!("Prerequisites: Python 3 must be installed");
        }
    }
}

/// Test stdio transport with a simple mock MCP server
#[tokio::test]
async fn test_stdio_transport_mock_server() {
    use crate::mcp::transport::{StdioTransport, Transport};
    
    // Create a Python script that acts as a simple MCP server
    let script = r#"
import sys, json

while True:
    try:
        line = sys.stdin.readline()
        if not line:
            break
        
        request = json.loads(line)
        request_id = request.get('id')
        method = request.get('method', '')
        
        if method == 'initialize':
            response = {
                'jsonrpc': '2.0',
                'id': request_id,
                'result': {
                    'protocolVersion': '2024-11-05',
                    'capabilities': {},
                    'serverInfo': {'name': 'mock-server', 'version': '1.0.0'}
                }
            }
        elif method == 'tools/list':
            response = {
                'jsonrpc': '2.0',
                'id': request_id,
                'result': {
                    'tools': [
                        {'name': 'test_tool', 'description': 'A test tool'}
                    ]
                }
            }
        else:
            response = {
                'jsonrpc': '2.0',
                'id': request_id,
                'error': {'code': -32601, 'message': f'Method not found: {method}'}
            }
        
        print(json.dumps(response))
        sys.stdout.flush()
    except Exception as e:
        print(json.dumps({'jsonrpc': '2.0', 'error': {'code': -32603, 'message': str(e)}}))
        sys.stdout.flush()
"#;
    
    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let script_path = temp_dir.path().join("mock_mcp_server.py");
    tokio::fs::write(&script_path, script)
        .await
        .expect("Failed to write script");
    
    // Try to create transport with Python 3
    let result = StdioTransport::new(
        vec![
            "python3".to_string(),
            script_path.to_str().unwrap().to_string(),
        ],
        HashMap::new(),
    )
    .await;
    
    if result.is_err() {
        // Python might not be available, skip this test
        println!("⚠️ Python3 not available, skipping stdio transport mock server test");
        return;
    }
    
    let transport = result.expect("Failed to create transport");
    
    // Test connection
    assert!(transport.is_connected());
    
    // Send initialize request
    let init_request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "test-client", "version": "1.0.0"}
        },
        "id": 1
    });
    
    let response = transport.send_request(init_request).await;
    assert!(response.is_ok(), "Initialize request failed: {:?}", response.err());
    
    let response = response.unwrap();
    assert_eq!(response["id"], 1);
    assert!(response["result"]["serverInfo"]["name"].as_str().unwrap().contains("mock"));
    
    // Send tools/list request
    let tools_request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "tools/list",
        "id": 2
    });
    
    let response = transport.send_request(tools_request).await;
    assert!(response.is_ok(), "Tools list request failed: {:?}", response.err());
    
    let response = response.unwrap();
    assert_eq!(response["id"], 2);
    let tools = response["result"]["tools"].as_array().expect("Tools should be an array");
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0]["name"], "test_tool");
    
    // Send unknown method (should get error)
    let unknown_request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "unknown/method",
        "id": 3
    });
    
    let response = transport.send_request(unknown_request).await;
    assert!(response.is_err(), "Should get error for unknown method");
    
    if let Err(e) = response {
        let err_str = e.to_string();
        assert!(err_str.contains("Method not found"), "Error should mention method not found: {}", err_str);
    }
    
    // Cleanup
    let mut transport = transport;
    transport.close().await.expect("Failed to close transport");
    
    // Give process time to exit
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    
    assert!(!transport.is_connected());
    
    println!("✅ Stdio transport mock server test passed");
}

