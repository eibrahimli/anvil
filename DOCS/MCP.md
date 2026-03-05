# MCP Guide

This document consolidates MCP specification notes, integration examples, and testing guidance for Anvil.

## What MCP Provides
- Standard protocol for external tool/resource integration.
- JSON-RPC messaging (`initialize`, `tools/list`, `tools/call`, etc.).
- Local and remote server connectivity.

## Protocol Notes
- Spec reference: `https://modelcontextprotocol.io/specification/2025-11-25`
- Message format: JSON-RPC 2.0.
- Tool schemas: JSON Schema input definitions.

## Transport Modes

### Local (`type: "local"`)
- Uses process stdio (stdin/stdout).
- Best for local packages/scripts (`npx`, Python, binaries).

### Remote (`type: "remote"`)
- Uses HTTP endpoint + streaming response flow.
- Supports custom headers (including environment expansion).

## Configuration Pattern

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "server-name": {
        "type": "local",
        "command": ["npx", "-y", "@modelcontextprotocol/server-everything"],
        "environment": {
          "API_KEY": "{env:MY_API_KEY}"
        },
        "enabled": true,
        "timeout": 30000
      }
    }
  }
}
```

## Integration Examples

### GitHub
- Server: `@modelcontextprotocol/server-github`
- Typical use: issues, PRs, file reads, code search.

### PostgreSQL
- Server: `@modelcontextprotocol/server-postgres`
- Typical use: table inspection and SQL queries.

### Filesystem (restricted dirs)
- Server: `@modelcontextprotocol/server-filesystem`
- Typical use: controlled access to specific external paths.

### Git
- Server: `@modelcontextprotocol/server-git`
- Typical use: advanced git operations beyond built-in tooling.

## Testing Checklist

### 1) Unit and transport tests
```bash
cd src-tauri
cargo test mcp::transport::tests -- --nocapture
```

### 2) Full compile validation
```bash
cd src-tauri
cargo check
```

### 3) Manual app test
```bash
npm run tauri dev
```
- Configure MCP server in `.anvil/anvil.json`.
- Open app and verify server discovery and tool listing.
- Trigger at least one MCP tool call and validate result rendering.

## Troubleshooting
- Command not found: verify Node/Python/runtime is installed and on PATH.
- First-run timeout: increase timeout because package download can be slow.
- Auth issues: verify header values and `{env:VAR}` expansion.
- Server starts but no tools: validate `initialize` then `tools/list` response.

## Safety Notes
- Keep credentials in environment variables when possible.
- Enable only trusted MCP servers.
- Apply permission rules for network/file-impacting MCP tools.
