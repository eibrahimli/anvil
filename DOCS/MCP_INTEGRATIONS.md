# MCP Integration Guide

This guide provides examples of how to integrate popular Model Context Protocol (MCP) servers with Anvil.

## 1. GitHub Integration

Connect Anvil to GitHub to create issues, pull requests, and search code.

### Prerequisites
- Node.js installed
- GitHub Personal Access Token (PAT)

### Configuration (anvil.json)
```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "github": {
        "type": "local",
        "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
        "environment": {
          "GITHUB_PERSONAL_ACCESS_TOKEN": "your_github_pat_here"
        },
        "enabled": true
      }
    }
  }
}
```

### Available Tools
- `github_create_issue`: Create a new issue
- `github_list_issues`: List repository issues
- `github_get_file_contents`: Read files from GitHub
- `github_create_pull_request`: Create a PR
- `github_search_code`: Search for code

---

## 2. PostgreSQL Integration

Query your PostgreSQL database directly from Anvil.

### Prerequisites
- Node.js installed
- PostgreSQL database accessible locally or remotely

### Configuration (anvil.json)
```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "postgres": {
        "type": "local",
        "command": ["npx", "-y", "@modelcontextprotocol/server-postgres", "postgresql://user:password@localhost:5432/dbname"],
        "enabled": true
      }
    }
  }
}
```

### Available Tools
- `postgres_query`: Execute SQL queries (read-only recommended)
- `postgres_list_tables`: List database tables
- `postgres_describe_table`: Get table schema

---

## 3. Filesystem Integration (Remote/Restricted)

Access specific directories outside your workspace securely.

### Configuration (anvil.json)
```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "fs-logs": {
        "type": "local",
        "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/var/log", "/tmp"],
        "enabled": true
      }
    }
  }
}
```

### Available Tools
- `fs-logs_read_file`: Read allowed files
- `fs-logs_list_directory`: List allowed directories

---

## 4. Git Integration (Official)

Advanced Git operations beyond Anvil's built-in git tool.

### Configuration (anvil.json)
```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "git": {
        "type": "local",
        "command": ["npx", "-y", "@modelcontextprotocol/server-git"],
        "enabled": true
      }
    }
  }
}
```

## Troubleshooting

### "Command not found" or "Failed to spawn process"
- Ensure Node.js and `npx` are in your system PATH.
- On macOS/Linux, `npx` might be in `/usr/local/bin` or similar. You may need to use the full path.

### Connection Timeout
- Increase `timeout` in config (default: 30000ms).
- Initial `npx` run takes longer to download packages.

### Environment Variables
- You can use `{env:VAR_NAME}` in your config to reference system environment variables securely.
```json
"environment": {
  "GITHUB_TOKEN": "{env:MY_GITHUB_TOKEN}"
}
```
