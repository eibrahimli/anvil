# Anvil Master Plan

This file is the compact planning snapshot used by agents.
Detailed roadmap and backlog are maintained in `DOCS/ROADMAP_STATUS.md`.

## Completed Foundation
- Architecture shell, chat-centric workflow, and observation editor layout.
- Core model/session management with provider + mode switching.
- Project context awareness and token-conscious workspace scanning.
- Streaming, permission gates, diff review flow, and git/status integration.
- Local model support, replay/history, multi-session tabs, and sharing/export.
- MCP and advanced tooling/search UX baseline.
- Terminal intelligence and workflow-library baseline implementation.

## Active Priorities
1. Reliability hardening + manual QA evidence closure.
2. Permissions settings UX completion and consistency.
3. Release readiness (packaging, security audit, test confidence).

## Open Expansion Tracks
- CLI wrapper for headless runtime access.
- Local IPC server for external clients.
- VS Code extension to connect to local Anvil runtime.
- Additional parity surfaces (web search tooling, custom tool registry, policy presets).

## Planning Rule
- Do not create new phase/task markdown files.
- Update `DOCS/ROADMAP_STATUS.md` for all status changes.
