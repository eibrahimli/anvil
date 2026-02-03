# Task 4.3: Stdio Transport Manual Testing Guide

## Overview
This guide explains how to manually test the Stdio Transport implementation for MCP (Model Context Protocol) servers.

## Prerequisites

1. **Anvil App** - Built and running
2. **Node.js** (optional, for testing with official MCP servers)
3. **Python 3** (optional, for testing with Python-based servers)
4. **npx** (comes with Node.js, for running npx packages)

## Quick Test: Unit Tests

Run the automated tests first:

```bash
cd src-tauri
cargo test mcp::transport::tests -- --nocapture
```

**Expected Output:**
- 8 tests passed
- Tests cover: empty command error, echo command, environment variables, process cleanup, invalid command, arguments handling, request ID assignment

## Manual Test 1: Test with Official MCP Server

### Setup
Install Node.js and ensure `npx` is available:
```bash
node --version  # Should show v18+ or v20+
npx --version
```

### Test Steps

1. **Start Anvil App:**
   ```bash
   npm run tauri dev
   ```

2. **Configure MCP Server in anvil.json:**
   Create/edit `.anvil/anvil.json` in your workspace:
   ```json
   {
     "mcp": {
       "enabled": true,
       "servers": {
         "everything": {
           "type": "local",
           "command": ["npx", "-y", "@modelcontextprotocol/server-everything"],
           "enabled": true,
           "timeout": 30000
         }
       }
    }
   }
   ```

3. **Test via UI:**
   - Open Anvil
   - Go to Settings or use the MCP Test panel
   - The server should appear as "everything"
   - Try connecting to list tools

4. **Test via Rust Integration Test:**
   ```bash
   cd src-tauri
   cargo test -- --ignored test_with_official_mcp_server --nocapture
   ```

### Expected Results
- Server spawns successfully
- Connection initializes
- Tools are listed (expect 10+ tools from the "everything" server)
- Process cleans up when disconnected

## Manual Test 2: Test with Python MCP Server

### Setup
Ensure Python 3 is available:
```bash
python3 --version  # Should show 3.8+
```

### Test Steps

1. **Create a Simple Python MCP Server:**
   Create `test_server.py`:
   ```python
   import sys
   import json

   def send_response(request_id, result=None, error=None):
       response = {"jsonrpc": "2.0", "id": request_id}
       if error:
           response["error"] = error
       else:
           response["result"] = result
       print(json.dumps(response))
       sys.stdout.flush()

   for line in sys.stdin:
       try:
           request = json.loads(line.strip())
           method = request.get("method", "")
           request_id = request.get("id")

           if method == "initialize":
               send_response(request_id, {
                   "protocolVersion": "2024-11-05",
                   "capabilities": {},
                   "serverInfo": {"name": "test-server", "version": "1.0"}
               })
           elif method == "tools/list":
               send_response(request_id, {
                   "tools": [
                       {
                           "name": "greet",
                           "description": "Greets a person",
                           "inputSchema": {
                               "type": "object",
                               "properties": {
                                   "name": {"type": "string"}
                               },
                               "required": ["name"]
                           }
                       }
                   ]
               })
           elif method == "tools/call":
               params = request.get("params", {})
               tool_name = params.get("name")
               arguments = params.get("arguments", {})
               
               if tool_name == "greet":
                   name = arguments.get("name", "World")
                   send_response(request_id, {
                       "content": [{"type": "text", "text": f"Hello, {name}!"}]
                   })
               else:
                   send_response(request_id, error={
                       "code": -32601,
                       "message": f"Unknown tool: {tool_name}"
                   })
           else:
               send_response(request_id, error={
                   "code": -32601,
                   "message": f"Unknown method: {method}"
               })
       except Exception as e:
           send_response(None, error={"code": -32603, "message": str(e)})
   ```

2. **Configure in anvil.json:**
   ```json
   {
     "mcp": {
       "enabled": true,
       "servers": {
         "test-python": {
           "type": "local",
           "command": ["python3", "/path/to/test_server.py"],
           "enabled": true,
           "timeout": 30000
         }
       }
    }
   }
   ```

3. **Test via Rust Integration Test:**
   ```bash
   cd src-tauri
   cargo test -- --ignored test_with_python_echo_server --nocapture
   ```

### Expected Results
- Python process spawns
- Initialize request succeeds
- Tools list returns the "greet" tool
- Process is killed on disconnect

## Manual Test 3: Environment Variables

### Test Steps

1. **Create a Test Script:**
   ```bash
   #!/bin/bash
   read line
   echo '{"jsonrpc":"2.0","result":"'$MY_VAR'","id":1}'
   ```
   Save as `env_test.sh` and make it executable: `chmod +x env_test.sh`

2. **Configure with Environment:**
   ```json
   {
     "mcp": {
       "enabled": true,
       "servers": {
         "env-test": {
           "type": "local",
           "command": ["./env_test.sh"],
           "environment": {
             "MY_VAR": "Hello from env!"
           },
           "enabled": true
         }
       }
    }
   }
   ```

3. **Test:**
   Run the unit test:
   ```bash
   cd src-tauri
   cargo test test_stdio_transport_environment_variables -- --nocapture
   ```

### Expected Results
- Environment variable is passed to the process
- Response contains the environment variable value

## Manual Test 4: Process Lifecycle

### Test Steps

1. **Create a Long-Running Script:**
   ```python
   import sys
   import json
   import signal

   def handle_signal(signum, frame):
       sys.exit(0)

   signal.signal(signal.SIGTERM, handle_signal)
   signal.signal(signal.SIGINT, handle_signal)

   print("Server starting...", file=sys.stderr)
   sys.stderr.flush()

   for line in sys.stdin:
       try:
           request = json.loads(line)
           request_id = request.get("id")
           response = {
               "jsonrpc": "2.0",
               "id": request_id,
               "result": {"status": "ok"}
           }
           print(json.dumps(response))
           sys.stdout.flush()
       except:
           break

   print("Server exiting...", file=sys.stderr)
   ```
   Save as `lifecycle_test.py`

2. **Test via Terminal:**
   Open a terminal and run:
   ```bash
   ps aux | grep lifecycle_test  # Check no existing process
   
   # Start the server manually to test
   echo '{"jsonrpc":"2.0","id":1}' | python3 lifecycle_test.py
   ```

3. **Test via Anvil:**
   - Configure the server in anvil.json
   - Connect to it via the UI
   - Verify process appears: `ps aux | grep lifecycle_test`
   - Disconnect via UI
   - Verify process is gone: `ps aux | grep lifecycle_test`

### Expected Results
- Process starts when transport connects
- Process receives SIGTERM when transport closes
- Process is no longer in process list after disconnect
- No zombie processes remain

## Manual Test 5: Error Handling

### Test Invalid Commands

1. **Test with non-existent command:**
   ```json
   {
     "mcp": {
       "servers": {
         "bad-server": {
           "type": "local",
           "command": ["this_command_does_not_exist"],
           "enabled": true
         }
       }
    }
   }
   ```
   Expected: Error message "Failed to spawn process"

2. **Test with empty command:**
   ```json
   {
     "mcp": {
       "servers": {
         "empty-server": {
           "type": "local",
           "command": [],
           "enabled": true
         }
       }
    }
   }
   ```
   Expected: Error message "Command cannot be empty"

3. **Test with crashing server:**
   Create `crash.py`:
   ```python
   import sys
   print("Crashing...", file=sys.stderr)
   sys.exit(1)
   ```
   
   Configure and test:
   ```json
   {
     "mcp": {
       "servers": {
         "crash-server": {
           "type": "local",
           "command": ["python3", "crash.py"],
           "enabled": true
         }
       }
    }
   }
   ```
   Expected: Connection fails, proper error handling

## Debugging Tips

### Enable Debug Logging
Add to `src-tauri/src/mcp/transport.rs`:
```rust
eprintln!("[MCP] Sending: {}", message);
eprintln!("[MCP] Received: {}", response);
```

### Check Process Status
```bash
# List MCP processes
ps aux | grep -E "(npx|python|node)" | grep -v grep

# Check file descriptors
lsof -p <PID>

# Monitor process tree
pstree -p | grep -A5 anvil
```

### Test Transport Directly
Create a minimal test in Rust:
```rust
use anvil::mcp::transport::{StdioTransport, Transport};

#[tokio::main]
async fn main() {
    let transport = StdioTransport::new(
        vec!["cat".to_string()],
        std::collections::HashMap::new()
    ).await.unwrap();
    
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "test",
        "id": 1
    });
    
    let response = transport.send_request(request).await;
    println!("Response: {:?}", response);
}
```

## Acceptance Criteria Checklist

- [x] **Spawns process correctly**
  - Test: Run `test_stdio_transport_with_arguments`
  - Process starts and responds to requests

- [x] **Bidirectional communication**
  - Test: Run `test_stdio_transport_echo_command`
  - Requests sent via stdin, responses read from stdout

- [x] **Process cleanup on disconnect**
  - Test: Run `test_stdio_transport_process_cleanup`
  - Process killed when `close()` is called
  - No zombie processes remain

- [x] **Environment variables passed**
  - Test: Run `test_stdio_transport_environment_variables`
  - Environment variables available in child process

## Known Limitations

1. **Stderr is ignored** - Currently stderr output is discarded to avoid cluttering the logs
2. **No automatic restart** - If a process crashes, it stays dead until manually reconnected
3. **Single-threaded per server** - Each MCP server runs in its own process

## Next Steps

After stdio transport is working:
1. Implement HTTP/SSE transport (Task 4.4)
2. Add tool discovery and registration (Task 4.5)
3. Implement tool execution (Task 4.7)
