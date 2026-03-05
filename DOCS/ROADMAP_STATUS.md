# Roadmap and Status

This is the single consolidated roadmap/status file.

## Snapshot
- Foundation phases are complete (core runtime, UI shell, streaming, permissions, git, session history).
- MCP integration is implemented (client, transport, tool discovery, config wiring, UI hooks).
- UX parity work is largely complete (activity stream, status bar, timeline, grouped actions).
- Remaining work is concentrated in reliability hardening, packaging, and surface expansion.

## Completed Tracks (Consolidated)
- Core runtime and architecture boundaries.
- Provider/mode/session switching and multi-session tabs.
- Tooling baseline: read/write/edit/bash/search/glob/list/webfetch/patch/todo/skill/lsp/mcp.
- Session persistence/replay/export/import and local sharing.
- Orchestration and workflow-related UI foundations.
- Terminal intelligence and workflow library baseline tasks.

## Active Open Work

### Reliability and QA
- Execute full manual QA scenario pack and record dated evidence.
- Close remaining risk-closure acceptance gate from stability checklist.
- Complete Rust tool test sweep plus manual Tauri end-to-end verification.

### Permissions and Settings UX
- Finish dedicated permissions settings UI flow (per-tool defaults, rule CRUD, save/apply behavior).
- Ensure permission changes apply consistently without ambiguous session state.

### Release Readiness
- Distribution packaging (AppImage/DMG/MSI pipeline).
- Security audit for local-first compliance and permission boundaries.

### Platform Expansion
- CLI wrapper for headless usage.
- Local IPC server for external clients.
- VS Code extension connection to local runtime.

## Deferred / Parity Backlog (Grouped)
- Web search parity as a dedicated tool surface (separate from raw web fetch).
- Local custom tool registry and runtime controls.
- Permission preset profiles (full access / ask / locked) and policy UX polish.
- Additional manual regression suites for provider and stream edge cases.

## Candidate Future Work (Backlog Inputs)
- Harden credential storage and migration behavior across providers.
- Expand provider ecosystem through OpenAI-compatible and enterprise adapters.
- Tighten workspace sandbox enforcement across every tool path.
- Improve config-driven per-agent permission/tool allowlists.

## How to Update This File
- Add new status changes here only; do not create phase/task side files.
- Keep this file outcome-focused: shipped, in progress, blocked, next.
