# Phase 4: Model Context Protocol (MCP)

> **Goal:** Extensibility via external tools through MCP
> **Timeline:** 3 weeks
> **Priority:** MEDIUM - Enables infinite extensibility
> **Depends on:** Phase 3 completion

## Task 4.1: Research MCP Specification
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Deep dive into Model Context Protocol specification.

### Research Areas
1. MCP protocol version 2024-11-05
2. Message types: initialize, tools/list, tools/call
3. Transport methods: stdio, sse
4. Authentication: OAuth, API keys
5. Error handling

### Deliverables
- [ ] Protocol documentation notes
- [ ] Message flow diagrams
- [ ] Rust implementation strategy

### Resources
- https://spec.modelcontextprotocol.io/
- https://github.com/modelcontextprotocol

---

## Task 4.2: Create MCP Client Core
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 4 hours

### Description
Implement basic MCP client in Rust.

### Module Structure
```
src-tauri/src/mcp/
├── mod.rs           # Public API
├── client.rs        # MCPClient struct
├── transport.rs     # Transport trait + implementations
├── protocol.rs      # Message types
└── error.rs         # Error handling
```

### Requirements
- JSON-RPC 2.0 message format
- Async/await support
- Timeout handling
- Connection management

### Core Types
```rust
struct MCPClient {
    transport: Box<dyn Transport>,
    capabilities: ServerCapabilities,
}

enum Transport {
    Stdio { process: Child },
    Sse { url: String, client: reqwest::Client },
}
```

### Acceptance Criteria
- [ ] Client connects to MCP server
- [ ] Sends/receives JSON-RPC messages
- [ ] Handles initialization
- [ ] Error handling works

---

## Task 4.3: Implement Stdio Transport
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Implement stdio transport for local MCP servers.

### Requirements
- Spawn process with command
- Read stdout for responses
- Write stdin for requests
- Handle process lifecycle
- Environment variable support

### Example
```json
{
  "mcp": {
    "local-server": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-everything"],
      "environment": {
        "API_KEY": "secret"
      }
    }
  }
}
```

### Acceptance Criteria
- [ ] Spawns process correctly
- [ ] Bidirectional communication
- [ ] Process cleanup on disconnect
- [ ] Environment variables passed

---

## Task 4.4: Implement SSE Transport
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 3 hours

### Description
Implement Server-Sent Events transport for remote MCP servers.

### Requirements
- HTTP POST for requests
- SSE stream for responses
- Header support (auth tokens)
- Reconnection logic

### Example
```json
{
  "mcp": {
    "remote-server": {
      "type": "remote",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer {env:API_KEY}"
      }
    }
  }
}
```

### OAuth Support
- Dynamic client registration (RFC 7591)
- Token storage in `~/.local/share/anvil/mcp-auth.json`
- Auto-refresh tokens

### Acceptance Criteria
- [ ] POST requests work
- [ ] SSE streaming works
- [ ] Headers configurable
- [ ] OAuth flow implemented

---

## Task 4.5: Tool Discovery & Registration
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Discover and register MCP tools with agent.

### Requirements
- Call `tools/list` on connect
- Convert MCP tools to internal Tool trait
- Register with agent tool registry
- Prefix tools with server name (e.g., `github_*`)

### Tool Mapping
```rust
// MCP Tool -> Internal Tool
MCPTool {
    name: "create_issue",
    description: "...",
    input_schema: {...}
} -> McpToolWrapper {
    server_name: "github",
    tool_name: "create_issue",
    full_name: "github_create_issue"
}
```

### Acceptance Criteria
- [ ] Tool discovery works
- [ ] Tools registered correctly
- [ ] Agent can call MCP tools
- [ ] Tool schemas converted

---

## Task 4.6: MCP Configuration System
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1.5 hours

### Description
Add MCP config to anvil.json.

### Config Schema
```rust
struct McpConfig {
    servers: HashMap<String, McpServerConfig>,
}

enum McpServerConfig {
    Local {
        command: Vec<String>,
        environment: Option<HashMap<String, String>>,
        enabled: bool,
        timeout: u64,  // ms
    },
    Remote {
        url: String,
        headers: Option<HashMap<String, String>>,
        oauth: Option<OAuthConfig>,
        enabled: bool,
        timeout: u64,
    }
}
```

### Features
- Enable/disable servers
- Per-agent MCP config
- Tool filtering (enable specific MCP tools)

### Acceptance Criteria
- [ ] Config parsing works
- [ ] Server lifecycle managed
- [ ] Per-agent overrides work

---

## Task 4.7: MCP Tool Execution
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Implement tool call execution through MCP.

### Requirements
- Convert internal tool call to MCP format
- Send `tools/call` request
- Handle responses
- Convert results back to internal format
- Error propagation

### Flow
```
Agent -> ToolRegistry -> McpToolWrapper -> MCPClient -> Transport -> MCP Server
```

### Acceptance Criteria
- [ ] Tool calls work end-to-end
- [ ] Results returned correctly
- [ ] Errors handled gracefully
- [ ] Timeout handling

---

## Task 4.8: MCP Management UI
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
UI for managing MCP servers and viewing status.

### Components
1. **MCP Panel**: List configured servers
2. **Connection Status**: Connected/Disconnected indicator
3. **Tool List**: Show available tools per server
4. **Auth UI**: OAuth flow handling (browser open)

### Features
- Enable/disable servers
- View server logs
- Reconnect button
- Tool enable/disable

### Acceptance Criteria
- [ ] Panel shows servers
- [ ] Status indicators work
- [ ] Auth flow handled
- [ ] Tools displayed

---

## Task 4.9: Sample MCP Integrations
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Create sample configurations for popular MCP servers.

### Samples
1. **GitHub MCP**: PRs, issues, repos
2. **PostgreSQL MCP**: Database queries
3. **Context7 MCP**: Documentation search
4. **Sentry MCP**: Error tracking

### Deliverables
- [ ] Example configs in docs
- [ ] Tested connections
- [ ] Usage examples

---

## Task 4.10: Phase 4 Testing
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 3 hours

### Test Plan
- [ ] Unit tests for MCP client
- [ ] Transport tests (stdio + sse)
- [ ] OAuth flow tests
- [ ] E2E with test MCP server
- [ ] Error handling tests
- [ ] Performance tests (100+ tools)

### Acceptance Criteria
- [ ] All tests pass
- [ ] E2E with real MCP servers
- [ ] Documentation complete

---

## Progress Summary

- [ ] Task 4.1: Research MCP Specification
- [ ] Task 4.2: Create MCP Client Core
- [ ] Task 4.3: Implement Stdio Transport
- [ ] Task 4.4: Implement SSE Transport
- [ ] Task 4.5: Tool Discovery & Registration
- [ ] Task 4.6: MCP Configuration System
- [ ] Task 4.7: MCP Tool Execution
- [ ] Task 4.8: MCP Management UI
- [ ] Task 4.9: Sample MCP Integrations
- [ ] Task 4.10: Phase 4 Testing

---

## Design Principles

1. **Transparency**: User sees all MCP servers and tools
2. **Security**: OAuth tokens stored securely, user controls access
3. **Reliability**: Reconnection, timeout handling, error recovery
4. **Performance**: Lazy loading, efficient caching

## Notes

### MCP vs Custom Tools
- **MCP**: External servers, reusable across projects
- **Custom Tools**: Project-specific, TypeScript/Python

### Token Storage
- Path: `~/.local/share/anvil/mcp-auth.json`
- Permissions: 600 (user read/write only)
- Encryption: Platform keychain if available

### Known Limitations
- MCP is new protocol, may change
- Not all servers implement full spec
- Context limits: Many tools = large context
