# Anvil Project Rules & Mandates

This file is the compact agent-facing rule set. Canonical detail lives in `DOCS/FOUNDATION.md`.

## 1. Core Philosophy
- **Agent-First:** Anvil is an agent runtime with a UI.
- **Local-First:** Logic, storage, and execution run locally.
- **Model-Agnostic:** Providers are adapter-based and replaceable.
- **Security-First:** No silent sensitive execution.

## 2. Architecture Principles (Non-Negotiable)
- **Hexagonal/Clean boundaries:**
  - Core domain is independent of UI/storage/providers.
  - Adapters implement models/tools/storage interfaces.
  - UI remains orchestration and visualization layer.

## 3. Engineering Standards
- Apply **SOLID**, **DRY**, and **YAGNI** consistently.
- Prefer explicit interfaces over implicit coupling.
- Keep tool behavior deterministic and schema-driven.

## 4. Security Model
- No silent shell execution.
- Diff preview before code-changing operations.
- Network access policy-controlled.
- Workspace/path sandboxing enforced.

## 5. Runtime UX Expectations
- Tool activity must be observable in UI.
- Permission prompts must be explicit and actionable.
- File edits must be reviewable by the user.

## 6. Stack Constraints
- Desktop: Tauri + Rust.
- Frontend: React + TypeScript + Tailwind + Monaco.
- Runtime: Tokio.
- Storage: SQLite.
- IPC: Tauri commands/events.
