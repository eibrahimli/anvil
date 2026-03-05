# Anvil Foundation

## Product Stance
- Agent-first: Anvil is an agent runtime with a UI, not an IDE plugin with chat.
- Local-first: execution, storage, and session state run on the local machine.
- Model-agnostic: multiple provider adapters behind one model interface.
- Security-first: no silent sensitive execution.

## Architecture Boundaries
- Core domain (`src-tauri/src/domain`): agent loop, session state, decision logic.
- Adapters (`src-tauri/src/adapters`): tools, model providers, storage integrations.
- UI (`src`): visualization, user intent capture, and confirmations.
- Contract boundary: UI and runtime communicate via Tauri commands/events only.

## Agent Runtime Model
- Agent loop: plan -> act -> observe -> continue/stop.
- Sessions carry workspace, message history, model selection, permissions, and mode.
- Tools are invoked through explicit schemas and isolated executors.
- Model adapters stay replaceable; core logic does not depend on provider-specific code.

## Tooling Principles
- One tool, one responsibility.
- Prefer explicit schemas and deterministic output formats.
- Enforce workspace and permission checks for file/system operations.
- Treat network operations as sensitive and policy-controlled.

## Security Model
- No silent shell execution.
- Writes and edits require explicit approval flow when policy is `ask`.
- Diff preview is required for code-changing actions.
- Workspace sandboxing should scope file operations to approved paths.
- Secrets should not be committed or exposed in tool output.

## Engineering Standards
- Hexagonal/clean architecture boundaries are non-negotiable.
- SOLID principles apply to backend and frontend modules.
- DRY: shared behavior in shared abstractions, not copy/paste branches.
- YAGNI: prioritize parity and reliability before speculative features.

## Technology Constraints
- Desktop: Tauri + Rust.
- Frontend: React + TypeScript + Tailwind + Zustand + Monaco.
- Backend runtime: Tokio async.
- Persistence: SQLite.
- IPC: Tauri commands/events.

## Canonical Runtime Docs
- Runtime behavior: `DOCS/AGENT_WORKFLOW.md`
- Roadmap and backlog: `DOCS/ROADMAP_STATUS.md`
- Agent guardrails for automation: `.anvil/rules.md`
