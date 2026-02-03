# Task 4.1: MCP Research Documentation

## Overview

Model Context Protocol (MCP) is an open standard that enables seamless integration between LLM applications and external data sources and tools. Created by Anthropic, it's now maintained by The Linux Foundation.

### Key Resources
- **Specification**: https://modelcontextprotocol.io/specification/2025-11-25
- **Official Rust SDK (rmcp)**: https://github.com/modelcontextprotocol/rust-sdk
- **Spec Repository**: https://github.com/modelcontextprotocol/modelcontextprotocol

---

## Protocol Specification

### Version
- **Current Version**: 2025-11-25 (latest)
- **Protocol Type**: JSON-RPC 2.0
- **Schema Format**: JSON Schema 2020-12

### Core Components

#### 1. Message Format
All messages follow JSON-RPC 2.0 format:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

#### 2. Message Types

**Client Requests:**
- `initialize` - Initialize connection, exchange capabilities
- `ping` - Health check
- `tools/list` - List available tools
- `tools/call` - Execute a tool
- `resources/list` - List available resources
- `resources/read` - Read a resource
- `prompts/list` - List available prompts
- `prompts/get` - Get a prompt with arguments
- `sampling/createMessage` - Request LLM sampling
- `completion/complete` - Request completions
- `tasks/list` - List tasks
- `tasks/get` - Get task details
- `tasks/cancel` - Cancel a task

**Server Requests:**
- `sampling/createMessage` - Server requests client to sample LLM
- `elicitation/create` - Server requests user input from client

**Notifications:**
- `notifications/initialized` - Client initialized
- `notifications/cancelled` - Cancel pending request
- `notifications/progress` - Progress update
- `notifications/elicitation/complete` - Elicitation completed
- `notifications/roots/list_changed` - Roots list changed

#### 3. Capabilities Negotiation

**Client Capabilities:**
```json
{
  "roots": { "listChanged": true },
  "sampling": { "tools": true },
  "tasks": { "list": true, "cancel": true }
}
```

**Server Capabilities:**
```json
{
  "tools": { "listChanged": true },
  "resources": { "subscribe": true, "listChanged": true },
  "prompts": { "listChanged": true }
}
```

---

## Transport Methods

### 1. STDIO Transport (Local)

**Purpose**: Inter-process communication within same system

**Characteristics:**
- Uses stdin/stdout for bidirectional JSON-RPC messages
- Line-delimited JSON (one message per line)
- Designed for local MCP connections
- Common for CLI tools and integrations

**Process Flow:**
```
Client ──stdin──> Server Process
Client <─stdout── Server Process
```

**Example Configuration:**
```json
{
  "type": "local",
  "command": ["npx", "-y", "@modelcontextprotocol/server-everything"],
  "environment": {
    "API_KEY": "secret"
  }
}
```

### 2. Streamable HTTP Transport (Remote)

**Purpose**: Remote MCP connections

**Important**: SSE was deprecated in 2025 in favor of **Streamable HTTP**.

**Characteristics:**
- Single HTTP endpoint for bidirectional messaging
- Uses HTTP POST with streaming response
- Supports reconnection and resume
- Designed for cloud-hosted MCP servers

**Example Configuration:**
```json
{
  "type": "remote",
  "url": "https://mcp.example.com/mcp",
  "headers": {
    "Authorization": "Bearer {env:API_KEY}"
  }
}
```

---

## Tool Schema

### Tool Definition
```json
{
  "name": "create_issue",
  "description": "Create a GitHub issue",
  "inputSchema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "body": { "type": "string" }
    },
    "required": ["title"]
  }
}
```

### Tool Call Request
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "create_issue",
    "arguments": {
      "title": "Bug in auth",
      "body": "Fix login issue"
    }
  }
}
```

### Tool Call Result
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Issue #123 created successfully"
      }
    ],
    "isError": false
  }
}
```

---

## Authentication

### OAuth 2.0 (RFC 6749)
- Dynamic client registration (RFC 7591)
- Token storage in `~/.local/share/anvil/mcp-auth.json`
- Auto-refresh tokens
- Browser-based authorization flow

### API Keys
- Header-based: `Authorization: Bearer {token}`
- Environment variable expansion: `{env:API_KEY}`

---

## Error Handling

### JSON-RPC Error Response
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32601,
    "message": "Method not found",
    "data": { "detail": "tools/unknown_method" }
  }
}
```

### Error Codes
- `-32700`: Parse error
- `-32600`: Invalid request
- `-32601`: Method not found
- `-32602`: Invalid params
- `-32603`: Internal error
- Custom codes: Server-defined

---

## Rust SDK (rmcp)

### Project Structure
```
rmcp/
├── Core crate - Protocol implementation
├── Transport implementations (stdio, http)
├── Server/Client handlers
└── Tool registration macros
```

### Basic Usage (Client)
```rust
use rmcp::{ServiceExt, transport::{TokioChildProcess, ConfigureCommandExt}};

let client = ().serve(TokioChildProcess::new(
    Command::new("npx").configure(|cmd| {
        cmd.arg("-y").arg("@modelcontextprotocol/server-everything");
    })
)?).await?;

let tools = client.list_tools().await?;
```

### Dependencies
- **tokio**: Async runtime
- **serde**: JSON serialization
- **schemars**: JSON Schema generation

---

## Message Flow Diagram

### Initialization Flow
```
Client                     Server
  │                           │
  │── initialize ──────────────>│
  │                           │
  │<─ initialize result ────────│
  │  (with server capabilities) │
  │                           │
  │── notifications/initialized >│
  │                           │
  │── tools/list ─────────────>│
  │                           │
  │<─ tools/list result ────────│
  │  (list of tools)          │
```

### Tool Call Flow
```
Client                     Server
  │                           │
  │── tools/call ─────────────>│
  │  (with arguments)          │
  │                           │
  │<─ CallToolResult ──────────│
  │  (content array)           │
```

---

## Implementation Strategy for Anvil

### Option A: Use Official Rust SDK (rmcp)
**Pros:**
- Official support, actively maintained
- Battle-tested implementations
- Handles edge cases and spec compliance
- Easy to stay updated with spec changes

**Cons:**
- May not perfectly match Anvil's architecture
- Additional dependency

### Option B: Custom Implementation
**Pros:**
- Full control over architecture
- Can integrate tightly with existing code
- No external dependencies

**Cons:**
- More development work
- Need to handle spec updates manually
- Risk of non-compliance

### Recommendation
**Use rmcp as foundation** with custom wrapper to integrate with Anvil's Tool trait.

---

## Key Design Decisions for Anvil

### 1. Server Management
- Spawn stdio processes using `tokio::process::Command`
- Use reqwest for HTTP (Streamable) transport
- Manage process lifecycle (start, stop, restart)

### 2. Tool Registration
- Prefix MCP tools with server name: `github_create_issue`
- Store tool schemas for LLM context
- Implement `Tool` trait for each discovered MCP tool

### 3. Error Handling
- Wrap MCP errors in Anvil's error types
- Graceful degradation when MCP server unavailable
- Retry logic for transient failures

### 4. Security
- OAuth token storage in secure keychain
- Environment variable expansion
- Permission checks before tool execution

---

## Configuration Schema (for anvil.json)

```json
{
  "mcp": {
    "servers": {
      "github": {
        "type": "local",
        "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
        "environment": {
          "GITHUB_TOKEN": "{env:GITHUB_TOKEN}"
        },
        "enabled": true,
        "timeout": 30000
      },
      "postgres": {
        "type": "local",
        "command": ["postgres-mcp-server"],
        "environment": {
          "DATABASE_URL": "{env:DATABASE_URL}"
        },
        "enabled": true
      },
      "remote-tools": {
        "type": "remote",
        "url": "https://api.example.com/mcp",
        "headers": {
          "Authorization": "Bearer {env:API_KEY}"
        },
        "oauth": {
          "clientId": "client-id",
          "authEndpoint": "https://auth.example.com/oauth/authorize",
          "tokenEndpoint": "https://auth.example.com/oauth/token"
        },
        "enabled": true,
        "timeout": 60000
      }
    }
  }
}
```

---

## Known Limitations & Considerations

1. **Protocol Stability**: MCP is relatively new, may have breaking changes
2. **Server Compliance**: Not all servers implement full spec
3. **Context Limits**: Many MCP tools = large context for LLM
4. **Network Latency**: Remote servers add latency
5. **Token Storage**: Need secure storage for OAuth tokens

---

## Next Steps (Task 4.2)

1. Create `src-tauri/src/mcp/` module structure
2. Decide on using `rmcp` vs custom implementation
3. Implement `MCPClient` struct with Transport trait
4. Set up basic stdio transport
5. Write unit tests for JSON-RPC message parsing

---

## References

- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [rmcp Rust SDK](https://github.com/modelcontextprotocol/rust-sdk)
- [MCP Server List](https://github.com/modelcontextprotocol/servers)
- [JSON Schema 2020-12](https://json-schema.org/)
- [JSON-RPC 2.0](https://www.jsonrpc.org/specification)

---

**Research Complete**: Task 4.1 deliverables met
- ✅ Protocol documentation notes
- ✅ Message flow diagrams
- ✅ Rust implementation strategy
