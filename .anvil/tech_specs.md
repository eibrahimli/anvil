# Anvil — Agentic AI Coding Platform

> **Anvil** is a Linux-first, cross-platform (Linux / macOS / Windows) **OpenCode.ai (reference product) alternative** — a local-first, model-agnostic, agentic AI coding environment with tool execution, project awareness, and BYOK (Bring Your Own Key).

> **Purpose**: Build a Linux-first, cross-platform (Linux / macOS / Windows) **OpenCode.ai (reference product) alternative** — a local-first, model-agnostic, agentic AI coding environment with tool execution, project awareness, and BYOK (Bring Your Own Key).

This document is written to be **directly executable by AI coding agents (Cursor / cloud code)**.

---

## 0. NON-GOALS (IMPORTANT)

This is **NOT** just an IDE with chat.

This **IS**:
- An **agent runtime**
- With **tools** (fs, bash, edit, search, git)
- With **model adapters** (OpenAI, Anthropic, Gemini, local)
- With **permissioned execution**
- With **session + workspace memory**

UI exists to **control and observe agents**, not replace them.

---

## 1. HIGH-LEVEL ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│                    DESKTOP UI (TAURI)                        │
│  React / Svelte + TypeScript                                 │
│  - Monaco Editor                                             │
│  - Chat / Agent Console                                      │
│  - File Explorer                                             │
│  - Terminal                                                  │
└─────────────────────────────────────────────────────────────┘
                             │ IPC
┌─────────────────────────────────────────────────────────────┐
│                  AGENT RUNTIME (RUST)                        │
│  - Agent Loop (Plan → Act → Observe)                         │
│  - Tool Executor                                             │
│  - Model Router                                              │
│  - Permission System                                         │
│  - Workspace Context Builder                                 │
└─────────────────────────────────────────────────────────────┘
                             │
┌─────────────────────────────────────────────────────────────┐
│                  EXTERNAL / LOCAL MODELS                     │
│  OpenAI | Anthropic | Gemini | Ollama | LM Studio            │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. CORE TECHNOLOGY DECISIONS

### Desktop Framework
**Tauri + Rust** (mandatory)
- Linux-first
- Small binary (<15MB)
- Native security model

### Frontend
- React + TypeScript (default)
- Monaco Editor
- Tailwind CSS
- Zustand (state)

### Backend (Rust)
- Tokio (async runtime)
- Reqwest (HTTP)
- Portable-pty (terminal)
- Git2
- SQLite (rusqlite)
- Tree-sitter (code parsing)

---

## 3. AGENT SYSTEM (CORE OF OPENCODE)

### 3.1 Agent Loop

```text
1. Receive user goal
2. Build workspace context
3. Ask model to PLAN
4. Execute tools step-by-step
5. Observe results
6. Continue or stop
```

### 3.2 Agent Data Structures

```rust
struct AgentSession {
  id: Uuid,
  workspace_path: PathBuf,
  model: ModelId,
  messages: Vec<Message>,
  permissions: AgentPermissions,
}

struct Message {
  role: Role, // system | user | assistant | tool
  content: String,
}
```

---

## 4. TOOL SYSTEM (CRITICAL)

### 4.1 Required Tools (Parity with OpenCode)

| Tool | Description |
|-----|------------|
| read_file | Read file contents |
| write_file | Overwrite file |
| edit_file | Apply diff |
| list_files | Recursive tree |
| search | Ripgrep-style search |
| bash | Execute shell commands |
| git | Status / commit |

### 4.2 Tool Contract

```rust
trait Tool {
  fn name(&self) -> &'static str;
  fn schema(&self) -> JsonSchema;
  async fn execute(&self, input: Value) -> ToolResult;
}
```

### 4.3 Permission Model

```rust
enum Permission {
  ReadFS,
  WriteFS,
  ExecShell,
  Network,
}
```

Agent **cannot execute tools** without explicit permission.

---

## 5. MODEL ABSTRACTION (BYOK)

### 5.1 Model Adapter Interface

```rust
trait ModelAdapter {
  async fn chat(&self, req: ChatRequest) -> ChatResponse;
  async fn stream(&self, req: ChatRequest, tx: Sender<String>);
}
```

### 5.2 Supported Providers

| Provider | Status |
|--------|-------|
| OpenAI | Required |
| Anthropic | Required |
| Gemini | Required |
| Ollama | Required |
| LM Studio | Optional |

### 5.3 API Key Storage
- OS keychain (keyring crate)
- Never stored in plaintext

---

## 6. WORKSPACE CONTEXT BUILDER

Before each agent step:
- Detect language(s)
- Collect relevant files
- Summarize tree
- Attach diffs

```text
workspace/
 ├─ src/
 ├─ README.md
 ├─ package.json
```

Context size **must be capped**.

---

## 7. FRONTEND RESPONSIBILITIES

Frontend is **NOT intelligent**.

It only:
- Displays files
- Displays diffs
- Displays agent thoughts
- Sends user goals

All reasoning lives in Rust.

---

## 8. STORAGE

SQLite tables:

```sql
sessions(id, created_at)
messages(session_id, role, content)
settings(key, value)
models(id, provider, name)
```

---

## 9. SECURITY MODEL

- No silent shell execution
- Diff preview required
- Network off by default
- Workspace sandboxing

---

## 10. DEVELOPMENT PHASES

### Phase 1 — Agent Core
- Agent loop
- Tool system
- Model adapters

### Phase 2 — Desktop UI
- Editor
- Chat console
- Diff viewer

### Phase 3 — Parity with OpenCode
- Multi-file edits
- Streaming
- Permissions UI

### Phase 4 — Power Features
- Multiple agents
- Replay sessions
- Templates

---

## 11. WHAT MAKES THIS OPENCODE-CLASS

✔ Agent-driven (not chat-driven)
✔ Tool execution
✔ Workspace reasoning
✔ Model-agnostic
✔ Local-first

---

## 12. AI TASK DECOMPOSITION (FOR CURSOR)

Each bullet = **one Cursor task**

- Implement agent loop
- Implement tool trait
- Implement bash tool
- Implement edit tool
- Implement OpenAI adapter
- Implement Anthropic adapter
- Implement permission system
- Implement context builder
- Implement diff applier

---

## 13. DESIGN & ARCHITECTURE PRINCIPLES (MANDATORY)

These rules are **non-negotiable** and apply to all code written by humans or AI agents.

### 13.1 Software Architecture

- **Agent-first architecture**
  - Business logic lives in the Rust backend
  - UI is a thin controller/view layer
- **Hexagonal / Clean Architecture**
  - Core domain has no dependency on UI, DB, or providers
  - Adapters are replaceable
- **Explicit boundaries**
  - Models, tools, agents, storage, UI must not bleed into each other

---

### 13.2 SOLID Principles

- **S — Single Responsibility**
  - Each module does one thing (e.g. one tool = one responsibility)
- **O — Open / Closed**
  - New models/tools added via adapters, not core edits
- **L — Liskov Substitution**
  - All model adapters interchangeable
- **I — Interface Segregation**
  - No large "god interfaces"
- **D — Dependency Inversion**
  - Core depends on traits, not implementations

---

### 13.3 DRY (Don’t Repeat Yourself)

- Shared logic must live in the core
- No copy-pasted provider logic
- Tool schemas defined once

---

### 13.4 YAGNI (You Aren’t Gonna Need It)

- No speculative features
- No premature optimization
- Build only what is required for OpenCode parity first

---

### 13.5 Design Patterns (Recommended)

- **Strategy** → model adapters, tool selection
- **Command** → tool execution
- **Observer** → streaming responses
- **Factory** → agent creation
- **State Machine** → agent lifecycle

---

## FINAL NOTE

This document defines an **agent platform**, not an editor plugin.

If you build strictly according to this spec and principles:
- You will achieve OpenCode-level capability
- You will avoid architectural debt
- You will be able to scale agents, tools, and models safely

