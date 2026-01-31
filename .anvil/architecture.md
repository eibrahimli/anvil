# Anvil Architecture Blueprint

## 1. High-Level Diagram
```
┌─────────────────────────────────────────────────────────────┐
│                    DESKTOP UI (TAURI)                        │
│  React + TypeScript                                          │
│  - Monaco Editor (Code View/Edit)                            │
│  - Chat Console (Agent Interaction)                          │
│  - File Explorer                                             │
│  - Terminal                                                  │
└─────────────────────────────────────────────────────────────┘
                             │ IPC (Commands/Events)
┌─────────────────────────────────────────────────────────────┐
│                  AGENT RUNTIME (RUST)                        │
│  - Agent Loop (Plan → Act → Observe)                         │
│  - Tool Executor (Sandboxed)                                 │
│  - Model Router (Adapter Pattern)                            │
│  - Permission System                                         │
│  - Workspace Context Builder                                 │
└─────────────────────────────────────────────────────────────┘
                             │ HTTP / FFI
┌─────────────────────────────────────────────────────────────┐
│                  EXTERNAL / LOCAL MODELS                     │
│  OpenAI | Anthropic | Gemini | Ollama | LM Studio            │
└─────────────────────────────────────────────────────────────┘
```

## 2. Core Data Structures (Rust)

### Agent Session
```rust
struct AgentSession {
  id: Uuid,
  workspace_path: PathBuf,
  model: ModelId,
  messages: Vec<Message>,
  permissions: AgentPermissions,
}
```

### Message
```rust
struct Message {
  role: Role, // system | user | assistant | tool
  content: String,
}
```

### Tool Interface
```rust
trait Tool {
  fn name(&self) -> &'static str;
  fn schema(&self) -> JsonSchema; // For LLM function calling definition
  async fn execute(&self, input: Value) -> ToolResult;
}
```

### Model Adapter Interface
```rust
trait ModelAdapter {
  async fn chat(&self, req: ChatRequest) -> ChatResponse;
  async fn stream(&self, req: ChatRequest, tx: Sender<String>);
}
```

### Permission Enum
```rust
enum Permission {
  ReadFS,
  WriteFS,
  ExecShell,
  Network,
}
```

## 3. Storage Schema (SQLite)
```sql
CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at DATETIME);
CREATE TABLE messages (session_id TEXT, role TEXT, content TEXT);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE models (id TEXT PRIMARY KEY, provider TEXT, name TEXT);
```

## 4. Key Libraries
- **Runtime:** `tokio`
- **HTTP:** `reqwest`
- **Terminal:** `portable-pty`
- **Git:** `git2`
- **Database:** `rusqlite`
- **Parsing:** `tree-sitter`
