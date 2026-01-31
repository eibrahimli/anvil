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
- [x] **Streaming**: Implement streaming responses from Rust to UI.
- [x] **Diff View**: Implement specific UI for `edit_file` diffs.
- [x] **Permissions UI**: React components to Approve/Deny tool usage.
- [x] **Git Integration**: `git2` integration for status and commits.
- [x] **Context Builder**: Implement workspace context awareness.

## Phase 4: Power Features
- [x] **Multi-Agent**: Orchestrator for multiple agents with roles (Coder, Reviewer, Planner, Debugger).
- [x] **Session Replay**: UI to step back through agent history with HistoryModal.
- [x] **Local Models**: Integrate Ollama/LM Studio endpoints with OllamaAdapter.

## Phase 5: Advanced Tooling
- [ ] **edit_file Tool**: Token-efficient partial file edits using diffs.
- [ ] **search Tool**: Fast project-wide search using Ripgrep.
- [ ] **lsp Tool**: Integration with Language Servers for smarter navigation.

## Phase 6: Release & Polish
- [ ] **Global Search UI**: Integrated search panel.
- [ ] **Editor Tabs**: Handle multiple open files.
- [ ] **App Icons & Branding**: Final desktop polish.
- [ ] **Distribution**: DMG/AppImage/MSI packaging.
