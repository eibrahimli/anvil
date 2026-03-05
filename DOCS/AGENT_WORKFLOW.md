# Agent Workflow

This document describes what happens when a user gives a task, what the agent does internally, and what the user can observe.

## Runtime Entry
1. User submits a prompt in `src/components/Chat.tsx`.
2. UI ensures a session exists (`create_session` in `src-tauri/src/commands.rs`).
3. UI starts streaming (`stream_chat`) and marks session as running.

## Request Lifecycle
1. User message is appended to the active session.
2. Assistant placeholder message is created for token streaming.
3. Backend agent executes the loop in `src-tauri/src/domain/agent.rs`.
4. Tokens are streamed through `chat-token` events and appended in real time.
5. Tool calls and tool results are emitted as events.
6. Session is saved after completion (or failure) and status returns to idle/error.

## Tool Execution Workflow
1. Agent decides to call a tool (read/edit/bash/search/etc.).
2. Backend emits `agent-tool-call`.
3. Tool executes and returns output/error.
4. Backend emits `agent-tool-result`.
5. UI renders action cards in `src/components/ActivityStream.tsx`.

## Confirmation and Permission Gates
- Sensitive operations can require approval via `request-confirmation`.
- UI presents the request in `src/components/ConfirmationModal.tsx`.
- User can allow/deny and optionally persist rules (`always` + pattern).
- Backend receives the decision via `confirm_action`.

## What the User Sees
- Streaming assistant response tokens while the task is running.
- Tool execution cards with status (`pending`, `running`, `success`, `error`).
- System messages for mode/provider/session guidance.
- Session-level status bar updates (planning/researching/executing/testing/responding/done).
- Session tabs with per-session status badges.

## File Edit Visibility
Yes, edits are visible to the user.

- Before apply (when approval is required): write/edit requests include before/after content and are shown in confirmation UI as a review gate.
- During execution: tool call/result entries appear in activity stream.
- After apply: changed files are visible in the explorer/editor "Changes" views and via git status summaries.

## Modes and Behavior
- `plan`: stronger planning/task decomposition behavior.
- `research`: focuses on exploration and evidence gathering.
- `build`: implementation-focused behavior.
- Mode can be set per session and changed during conversation.

## Failure and Cancellation
- If stream is interrupted or provider fails, session moves to error state and UI receives a mapped error.
- If session expires, user is prompted to resend and re-create session.
- User can stop streaming explicitly (`stop_stream`).

## Practical UX Guarantees
- No silent high-risk action when policy is `ask`.
- User can inspect tool actions in context, not only final output.
- File-changing actions are reviewable and auditable in-session.
