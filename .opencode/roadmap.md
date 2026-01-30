# Anvil Development Roadmap

## Phase 1: Agent Core (The Engine)
Focus: Building the Rust backend logic, decoupled from the UI.
- [x] **Scaffold**: Initialize Tauri app with React/TS template.
- [x] **Dependencies**: Add `tokio`, `reqwest`, `rusqlite`, `serde`, `uuid` to `src-tauri/Cargo.toml`.
- [x] **Data Structures**: Define `AgentSession`, `Message`, `Role` structs in Rust.
- [x] **Model System**:
    - [x] Define `ModelAdapter` trait.
    - [x] Implement `OpenAIAdapter`.
    - [x] Implement `AnthropicAdapter`.
    - [x] Implement `GeminiAdapter`.
- [x] **Tool System**:
    - [x] Define `Tool` trait.
    - [x] Implement `read_file` tool.
    - [x] Implement `write_file` tool.
    - [x] Implement `bash` tool (simple execution).
- [x] **Agent Logic**:
    - [x] Implement the `AgentLoop` (State Machine).
    - [x] Implement `ContextBuilder` (Gathering files/tree).

## Phase 2: Desktop UI (The Control Center)
Focus: Basic UI to interact with the Agent Core.
- [x] **Setup**: Configure Tailwind CSS.
- [x] **Editor**: Integrate `monaco-editor`.
- [x] **Chat UI**: Create a chat interface (User input vs Agent output).
- [x] **IPC**: connect Frontend Chat to Rust Agent Loop via Tauri Commands.
- [x] **File Tree**: Display workspace file structure.
- [x] **Terminal**: Integrated Terminal (PTY + XTerm).
- [x] **Theming**: Aura Theme and Font support.
- [x] **Direct Entry**: Removed forced setup screen.

## Phase 3: Parity Features (Refinement)
Focus: Closing the gap with existing tools.
- [ ] **Streaming**: Implement streaming responses from Rust to UI.
- [ ] **Diff View**: Implement specific UI for `edit_file` diffs.
- [ ] **Permissions UI**: React components to Approve/Deny tool usage.
- [ ] **Git Integration**: `git2` integration for status and commits.
- [x] **Context Builder**: Implement workspace context awareness.

## Phase 4: Power Features
- [ ] **Multi-Agent**: Orchestrator for multiple agents.
- [ ] **Session Replay**: UI to step back through agent history.
- [ ] **Local Models**: Integrate Ollama/LM Studio endpoints.
