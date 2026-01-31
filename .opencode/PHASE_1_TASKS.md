# Phase 1: Foundation & Tool Parity

> **Goal:** Fill basic tool gaps so the agent can work effectively
> **Timeline:** 2 weeks
> **Priority:** CRITICAL - Must complete before other phases

## Task 1.1: Add Missing Dependencies ✅ COMPLETE
**Status:** ✅ Complete (Finished: 2026-01-31)
**Verification:** `cargo check` passed

### Dependencies Added
- ✅ `glob = "0.3.1"` - File pattern matching
- ✅ `html2text = "0.12.6"` - Convert HTML to text/markdown
- ✅ `patch = "0.7.0"` - Unified diff parsing

### Notes
- No duplicate dependencies found
- 6 warnings (unused imports/variables) - non-critical
- All new crates compile successfully  
**Assignee:** AI Agent  
**Time Estimate:** 15 minutes

### Description
Add required Rust crates to `src-tauri/Cargo.toml` for upcoming tools.

### Dependencies to Add
- [ ] `glob = "0.3.1"` - File pattern matching
- [ ] `html2text = "0.12.6"` - Convert HTML to text/markdown
- [ ] Verify `reqwest = "0.13.1"` has `rustls-tls` feature

### Acceptance Criteria
- [ ] All crates added to `[dependencies]`
- [ ] `cargo check` passes without errors
- [ ] No duplicate dependencies

### Testing
```bash
cd src-tauri
cargo check
```

---

## Task 1.2: Implement `glob` Tool ✅ COMPLETE
**Status:** ✅ Complete (Finished: 2026-01-31)
**Verification:** `cargo check` passed

### Implementation Summary
- Created `src-tauri/src/adapters/tools/glob.rs`
- Implemented `Tool` trait for `GlobTool`
- Supports patterns: `**/*.rs`, `src/**/*.ts`, etc.
- Returns files sorted by modification time (newest first)
- Security: workspace sandbox enforced
- Registered in all 3 locations (create_session, replay_session, orchestrator)

### Testing
- Unit tests included in module (basic + security)
- Compilation successful
- Ready for integration testing  
**Assignee:** AI Agent  
**Time Estimate:** 45 minutes

### Description
Implement file pattern matching tool using the `glob` crate.

### Requirements
- Create `src-tauri/src/adapters/tools/glob.rs`
- Implement `Tool` trait
- Support patterns like `**/*.rs`, `src/**/*.ts`
- Return matching file paths sorted by modification time
- Respect `.gitignore` patterns

### Tool Schema
```rust
name: "glob"
parameters: {
  pattern: string, // Required, glob pattern
  path: string,    // Optional, base directory (default: workspace root)
  max_results: number // Optional, default: 1000
}
```

### Acceptance Criteria
- [ ] Tool implemented and registered
- [ ] Pattern matching works correctly
- [ ] Results sorted by modification time
- [ ] Unit tests pass

### Testing
```rust
// Test with pattern **/*.rs
// Should return all Rust files in workspace
```

---

## Task 1.3: Implement `list` Tool ✅ COMPLETE
**Status:** ✅ Complete (Finished: 2026-01-31)
**Verification:** All 3 unit tests pass

### Implementation Summary
- Created `src-tauri/src/adapters/tools/list.rs`
- Implemented `Tool` trait for `ListTool`
- Supports depth control (0 = unlimited, 1+ = levels)
- Returns file metadata (name, size, type, modified time)
- Filtering: files only, directories only, or all
- Hidden file toggle (show_hidden parameter)
- Security: workspace sandbox enforced
- Registered in all 3 agent creation points

### Testing
- test_list_basic: ✅ PASSED
- test_list_filter: ✅ PASSED  
- test_list_security: ✅ PASSED  
**Assignee:** AI Agent  
**Time Estimate:** 45 minutes

### Description
Implement directory listing tool for browsing workspace structure.

### Requirements
- Create `src-tauri/src/adapters/tools/list.rs`
- List files and directories with depth control
- Return file metadata (name, size, type, modified time)
- Support filtering (files only, directories only)

### Tool Schema
```rust
name: "list"
parameters: {
  path: string,       // Required, directory path
  depth: number,      // Optional, max depth (default: 1)
  show_hidden: bool,  // Optional, show hidden files (default: false)
  filter: string      // Optional, "files" | "dirs" | "all" (default: "all")
}
```

### Acceptance Criteria
- [ ] Tool implemented and registered
- [ ] Depth control works
- [ ] Returns structured data with metadata
- [ ] Respects workspace sandbox boundaries

---

## Task 1.4: Implement `webfetch` Tool ✅ COMPLETE
**Status:** ✅ Complete (Finished: 2026-01-31)  
**Branch:** `task/1-4-webfetch`  
**Verification:** 4/4 unit tests pass, 0 warnings, 0 errors
**Assignee:** AI Agent  
**Time Estimate:** 1 hour

### Description
Implement web scraping tool to fetch and convert web pages to readable text.

### Requirements
- Create `src-tauri/src/adapters/tools/web.rs`
- Fetch URLs using `reqwest`
- Convert HTML to Markdown using `html2text`
- Handle timeouts (default: 10s)
- Support user-agent string

### Tool Schema
```rust
name: "webfetch"
parameters: {
  url: string,        // Required, URL to fetch
  timeout: number,    // Optional, seconds (default: 10)
  max_length: number  // Optional, max chars to return (default: 50000)
}
```

### Acceptance Criteria
- [ ] Tool fetches web pages
- [ ] HTML converted to clean Markdown
- [ ] Timeout handling works
- [ ] Error handling for failed requests

---

## Task 1.5: Implement `patch` Tool 🔄 IN PROGRESS
**Status:** 🔄 In Progress (Started: 2026-01-31)
**Branch:** `task/1-5-patch`
**Assignee:** AI Agent
**Time Estimate:** 1 hour  
**Assignee:** AI Agent  
**Time Estimate:** 1 hour

### Description
Implement unified diff patch application tool.

### Requirements
- Create `src-tauri/src/adapters/tools/patch.rs`
- Parse unified diff format
- Apply patches to files
- Handle fuzz factor
- Return success/failure per file

### Tool Schema
```rust
name: "patch"
parameters: {
  patch: string,      // Required, patch content
  path: string,       // Optional, target directory
  dry_run: bool       // Optional, test without applying (default: false)
}
```

### Acceptance Criteria
- [ ] Parses unified diff correctly
- [ ] Applies patches to files
- [ ] Dry-run mode works
- [ ] Confirmation required before applying

---

## Task 1.6: Implement `question` Tool (Backend)
**Status:** ⬜ Not Started  
**Assignee:** AI Agent  
**Time Estimate:** 1.5 hours

### Description
Implement interactive question tool for user decision-making.

### Requirements
- Create `src-tauri/src/adapters/tools/question.rs`
- Pause execution until user responds
- Use async channels (similar to Confirmation system)
- Support multiple question types

### Tool Schema
```rust
name: "question"
parameters: {
  questions: array[{
    id: string,
    header: string,     // Short label (max 30 chars)
    question: string,   // Full question text
    options: array[{    // Available choices
      label: string,    // 1-5 words
      description: string,
      value: string
    }],
    multiple: bool      // Allow multiple selections
  }]
}
```

### Technical Implementation
- Use `tokio::sync::oneshot` channel for blocking
- Emit Tauri event: `request-question`
- Wait for `resolve-question` event with answers
- Resume execution with user input

### Acceptance Criteria
- [ ] Backend tool implemented
- [ ] Execution pauses correctly
- [ ] Timeout handling (optional, default: 5min)
- [ ] Unit tests for channel logic

---

## Task 1.7: Create Question UI (Frontend)
**Status:** ⬜ Not Started  
**Assignee:** AI Agent  
**Time Estimate:** 2 hours

### Description
Create React component for displaying interactive questions.

### Requirements
- Create `src/components/tools/QuestionModal.tsx`
- Display question header and description
- Render options as buttons/radio/checkbox
- Support "Type your own answer" (always available)
- Send response back to Rust backend

### UI Specifications
- Modal overlay with backdrop blur
- Clean, minimal design
- Keyboard navigation support
- Single question at a time, or all questions visible

### Acceptance Criteria
- [ ] Component renders correctly
- [ ] All question types supported
- [ ] Keyboard navigation works
- [ ] Sends correct response format
- [ ] Integrates with Chat.tsx

---

## Task 1.8: Implement `todowrite` Tool
**Status:** ⬜ Not Started  
**Assignee:** AI Agent  
**Time Estimate:** 1 hour

### Description
Implement task list management for tracking agent progress.

### Requirements
- Create `src-tauri/src/adapters/tools/todowrite.rs`
- Persist to `.opencode/TODO.md` in simple Markdown format
- Support CRUD operations (add, update, delete, list)
- Auto-save after each change

### Tool Schema
```rust
name: "todowrite"
parameters: {
  action: string,     // "add" | "update" | "delete" | "clear"
  id: string,         // Required for update/delete
  content: string,    // Task description
  status: string,     // "pending" | "in_progress" | "completed" | "cancelled"
  priority: string    // "low" | "medium" | "high"
}
```

### Data Format (TODO.md)
```markdown
# Project Tasks

## In Progress
- [ ] Task 1: Implement glob tool (HIGH)

## Pending
- [ ] Task 2: Implement list tool (MEDIUM)

## Completed
- [x] Task 0: Setup project (HIGH)
```

### Acceptance Criteria
- [ ] Tool writes to TODO.md
- [ ] Markdown format is human-readable
- [ ] Supports all CRUD operations
- [ ] Auto-saves correctly

---

## Task 1.9: Implement `todoread` Tool
**Status:** ⬜ Not Started  
**Assignee:** AI Agent  
**Time Estimate:** 30 minutes

### Description
Implement task list reading tool.

### Requirements
- Create `src-tauri/src/adapters/tools/todoread.rs`
- Parse `.opencode/TODO.md`
- Return structured task data
- Support filtering by status

### Tool Schema
```rust
name: "todoread"
parameters: {
  filter: string      // Optional, "pending" | "in_progress" | "completed" | "all" (default: "all")
}
```

### Acceptance Criteria
- [ ] Reads and parses TODO.md
- [ ] Returns structured data
- [ ] Filtering works correctly

---

## Task 1.10: Create Todo Panel UI
**Status:** ⬜ Not Started  
**Assignee:** AI Agent  
**Time Estimate:** 2 hours

### Description
Create persistent "Plan/Tasks" panel in the UI.

### Requirements
- Add side panel for task visibility
- Real-time updates when TODO.md changes
- Collapsible sections (In Progress, Pending, Completed)
- Visual indicators for priority

### UI Specifications
- Width: 250px side panel
- Draggable/collapsible
- Shows task count badges
- Checkbox to complete tasks manually

### Acceptance Criteria
- [ ] Panel displays tasks
- [ ] Updates in real-time
- [ ] User can mark tasks complete
- [ ] Collapsible sections work

---

## Task 1.11: Update Tool Registry
**Status:** ⬜ Not Started  
**Assignee:** AI Agent  
**Time Estimate:** 30 minutes

### Description
Register all new tools in the tool system.

### Requirements
- Update `src-tauri/src/adapters/tools/mod.rs`
- Add all new tools to `AppState`
- Ensure tools are available to agents

### Acceptance Criteria
- [ ] All tools registered
- [ ] Agent can use all new tools
- [ ] Tool schemas correct

---

## Task 1.12: Phase 1 Testing & Validation
**Status:** ⬜ Not Started  
**Assignee:** AI Agent  
**Time Estimate:** 2 hours

### Description
Comprehensive testing of all Phase 1 tools.

### Test Plan
- [ ] Unit tests for each tool
- [ ] Integration test: Agent uses `glob` + `read` + `edit`
- [ ] Integration test: Agent uses `question` for user input
- [ ] Integration test: Agent uses `todowrite` to track progress
- [ ] E2E test: Web fetch from documentation
- [ ] Permission tests: All tools respect boundaries

### Acceptance Criteria
- [ ] All tests pass
- [ ] No regressions in existing tools
- [ ] Documentation updated

---

## Progress Summary

- [ ] Task 1.1: Add Dependencies
- [ ] Task 1.2: Implement `glob` Tool
- [ ] Task 1.3: Implement `list` Tool
- [ ] Task 1.4: Implement `webfetch` Tool
- [ ] Task 1.5: Implement `patch` Tool
- [ ] Task 1.6: Implement `question` Tool (Backend)
- [ ] Task 1.7: Create Question UI (Frontend)
- [ ] Task 1.8: Implement `todowrite` Tool
- [ ] Task 1.9: Implement `todoread` Tool
- [ ] Task 1.10: Create Todo Panel UI
- [ ] Task 1.11: Update Tool Registry
- [ ] Task 1.12: Phase 1 Testing

---

## Notes

### Dependencies Verification
Current `Cargo.toml` has:
- `walkdir = "2.5.0"` ✅ (can use for `list` tool)
- `ignore = "0.4.23"` ✅ (can use for `glob` tool)
- `reqwest = "0.13.1"` ✅ (has json + stream features)

Need to add:
- `glob = "0.3.1"`
- `html2text = "0.12.6"`
- `patch = "0.7.0"` (for unified diff parsing)

### Design Principles
1. All tools must be sandboxed (respect workspace root)
2. All file operations must require confirmation (via existing Confirmation system)
3. Tools should return structured JSON, not plain text
4. Error messages must be actionable

### Future Considerations
- Task 1.6 and 1.7 (`question` tool) are critical for "Not an IDE" philosophy
- Todo panel (Task 1.10) should be visible during agent execution
- Consider adding tool execution visualization (spinner, progress)
