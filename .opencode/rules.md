# Anvil Project Rules & Mandates

## 1. Core Philosophy
- **Agent-First:** Anvil is an agent runtime with a UI, not an IDE with a chat plugin.
- **Local-First:** All logic, storage, and execution happen locally on the user's machine.
- **Model-Agnostic:** Support multiple providers (OpenAI, Anthropic, Gemini, Ollama, etc.) via a unified adapter interface.
- **Security-First:** No silent execution. All tool usage requires permission/verification.

## 2. Architecture Principles (Non-Negotiable)
- **Hexagonal / Clean Architecture:**
  - **Core Domain:** Contains business logic (Agent loop, Context building). independent of UI, DB, or external providers.
  - **Adapters:** Implement interfaces for Models, Tools, and Storage. Replaceable without changing core logic.
  - **Explicit Boundaries:** Models, Tools, Agents, Storage, and UI must remain decoupled.

## 3. Coding Standards
- **SOLID:**
  - **S:** Single Responsibility (One tool = one job).
  - **O:** Open/Closed (Add new models via adapters, don't modify core).
  - **L:** Liskov Substitution (All model adapters must be interchangeable).
  - **I:** Interface Segregation (Avoid god interfaces).
  - **D:** Dependency Inversion (Core depends on traits, not concrete implementations).
- **DRY:** Shared logic in core. No copy-pasted provider logic.
- **YAGNI:** Build only what is needed for parity. No speculative features.

## 4. Security Model
- **No Silent Shell Execution:** User must approve or verify commands (via permission system).
- **Diff Preview:** Code changes require a diff view before application.
- **Network Default Off:** Agents cannot access the internet unless explicitly permitted.
- **Sandboxed Workspace:** Operations should be scoped to the workspace path.

## 5. Technology Stack Constraints
- **Desktop Framework:** Tauri + Rust (Linux-first, native security).
- **Frontend:** React + TypeScript + Monaco Editor + Tailwind CSS.
- **Backend:** Rust (Tokio async runtime).
- **Storage:** SQLite (rusqlite).
- **IPC:** Tauri IPC for communication between UI and Agent Runtime.
