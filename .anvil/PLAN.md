# Anvil: Master Transformation Plan

## 1. Architecture & Layout (The "Shell") - [DONE]
- [x] Create `AppShell` with Aura Theme.
- [x] Set Agent Console (Chat) as central focal point.
- [x] Move Code Editor to a toggleable right side "Observation Window".
- [x] Fix global font stack (JetBrains Mono, Fira Code, etc.).
- [x] Fix terminal toggle and persistence.

## 2. Model & Session Management - [DONE]
- [x] Implement adapters for OpenAI, Google Gemini, and Anthropic.
- [x] Dynamic model switching in the chat header.
- [x] Provider management in Settings modal (API Keys).
- [x] Persistent Workspace list in Activity Bar (+ button with native dialog).
- [x] Auto-initialization of agent sessions on first message.

## 3. Project Awareness - [DONE]
- [x] Implement `ContextBuilder` in Rust.
- [x] Automatically scan workspace tree and inject into agent system instructions.
- [x] Skip `node_modules`, `.git`, etc., to save tokens.

## 4. Parity & Professional Features - [DONE]
- [x] **Real-time Streaming**: Update UI as the model generates text.
- [x] **Side-by-Side Diff View**: Visual confirmation before agent writes files.
- [x] **Interactive Permissions**: Pause agent on sensitive actions (Shell/Write).
- [x] **Git Integration**: Agent-driven commits and status checks.

## 5. Power Features - [DONE]
- [x] **Local Model Support (Ollama)**: Added OllamaAdapter with streaming support. Configurable base URL in settings. No API key required.
- [x] **Session Replay/History**: Added SQLite storage module with session persistence. Created HistoryModal UI for browsing and replaying sessions. Auto-save after each message.
- [x] **Multi-Agent Orchestration**: Implemented Orchestrator with agent roles (Coder, Reviewer, Planner, Debugger), task queue system, task assignment, and task processing UI.
