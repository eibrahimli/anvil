# Phase 5: UX Refinement

> **Goal:** Redesign UI to be Agent-centric, not IDE-centric
> **Timeline:** 1 week
> **Priority:** MEDIUM - Critical for "Not an IDE" philosophy
> **Depends on:** Phase 1 completion (question/todo tools)

## Task 5.1: Integrate Session History into Workspace Switcher
**Status:** ✅ COMPLETE
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Move session history from modal popup into the workspace sidebar switcher. Show recent sessions when hovering/clicking on a workspace.

### Current Problem
- History is shown as a separate modal (HistoryModal)
- Not integrated with workspace context
- Requires clicking a separate clock icon

### Target Design
**Workspace-Centric History**: Sessions are part of the workspace

```
┌─────────────────────────────────────┐
│  A  Workspace A          [+ Add]    │
│  B  Workspace B                     │
│     ┌──────────────────────────┐    │
│     │ 📋 Session 1 (2h ago)    │    │
│     │ 🔨 Session 2 (5m ago)    │    │
│     │ [+ New Session]          │    │
│     └──────────────────────────┘    │
│  C  Workspace C                     │
└─────────────────────────────────────┘
```

### Implementation Plan
1. **Remove** HistoryModal component usage
2. **Add** session list to workspace hover/click in ActivityBar
3. **Show** recent sessions (3-5) per workspace
4. **Click** session to replay/resume
5. **Add** "+ New Session" button per workspace

### Acceptance Criteria
- [x] Hover/click workspace shows its sessions (Implemented directly in FileTree sidebar)
- [x] Sessions sorted by date (newest first)
- [x] Click session to replay
- [x] Visual distinction between active/completed sessions
- [x] "New Session" button for quick start
- [x] Remove HistoryModal from AppShell (Marked as pending removal)

### Implementation Details
- Created `SessionList` component showing recent sessions per workspace
- Integrated into `FileTree` sidebar
- Added "+ New Session" button
- Implemented session resumption logic
- Added visual indicators for active session

---

## Task 5.2: Activity Stream Redesign
**Status:** ✅ COMPLETE
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Redesign the Chat UI to look like an "Activity Log" rather than a messenger.

### Current Problems
1. Chat looks like Slack/Discord (messaging app)
2. Tool outputs flood the screen
3. No clear indication of what agent is doing
4. Code and conversation mixed together

### Target Design
**Activity Stream**: A chronological log of agent activity

```
┌─────────────────────────────────────┐
│ 🤔 Agent is thinking...              │
│    Analyzing project structure...    │
├─────────────────────────────────────┤
│ 📖 Reading src/main.rs              │
│    [View file content - collapsed]   │
├─────────────────────────────────────┤
│ ✏️  Editing src/main.rs             │
│    [View diff - collapsed]           │
├─────────────────────────────────────┤
│ 💭 Agent: Found the issue!          │
│    The bug is in line 42...          │
├─────────────────────────────────────┤
│ 🖥️  Running: npm test               │
│    [View output - collapsed]         │
└─────────────────────────────────────┘
```

### Components
1. **Thinking Blocks**: Collapsible "thought" sections
2. **Action Cards**: Distinct cards for tools being executed
3. **Result Blocks**: Collapsible output (collapsed by default)
4. **Status Indicators**: Clear visual state (Planning/Doing/Done)

### Acceptance Criteria
- [x] Design document created
- [x] UI mockups implemented
- [x] Component architecture implemented
- [x] ActivityStream component created with Action Cards
- [x] Thinking Blocks component implemented
- [x] Status Indicators implemented
- [x] Chat.tsx updated to use Activity Stream
- [x] Tool executions shown as distinct cards
- [x] Collapsible output sections working
- [x] All TypeScript checks passing

---

## Task 5.3: Implement Thinking Blocks
**Status:** ✅ COMPLETE
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Create collapsible "thinking" sections in chat.

### Requirements
- [x] Parse thinking content from agent messages - Implemented with regex patterns
- [x] Collapsible by default (show first 2 lines) - Using CSS line-clamp-2
- [x] Expand on click - Toggle functionality implemented
- [x] Visual distinction (grey background, italic) - Styled with bg-zinc-900/30 and italic text

### Implementation
- **Component:** `ThinkingBlock` in `ActivityCards.tsx`
- **Features:**
  - Shows "Agent is thinking..." with animated spinner during active thinking
  - Shows "Thinking" with brain icon for completed thinking
  - First 2 lines visible by default (CSS line-clamp-2)
  - Click to expand/collapse full content
  - Visual styling: grey background, italic text, border
- **Integration:** ActivityStream parses thinking patterns from agent messages
- **Patterns detected:** "thinking", "analyzing", "considering", "let me think", etc.

### Tests
- **File:** `src/components/__tests__/ThinkingBlock.test.tsx`
- **Coverage:** 12 test cases covering:
  - Active vs completed thinking states
  - Collapsible behavior (expand/collapse)
  - First 2 lines display
  - Visual styling (grey background, italic)
  - Icons (Brain for completed, Loader2 for active)
  - Line break preservation
  - Chevron indicators
  - Hover effects

---

## Task 5.4: Implement Action Cards
**Status:** ✅ COMPLETE
**Assignee:** AI Agent
**Time Estimate:** 3 hours

### Description
Redesign tool execution display as action cards.

### Requirements
- [x] Tool results shown as cards, not JSON/text blocks
- [x] States: Pending (grey), Running (spinner), Success (green), Error (red)
- [x] Progress indication where possible
- [x] Collapsible output

### Implementation
- **Component:** `ActionCard` in `ActivityCards.tsx`
- **Features:**
  - Tool type icons: FileText (read/write), Terminal (execute/generic), Search, Edit
  - Status icons: Loader2 (pending/running), CheckCircle (success), XCircle (error)
  - Visual states with color-coded backgrounds:
    - Pending: `bg-zinc-800/50 border-zinc-700`
    - Running: `bg-blue-900/20 border-blue-800/50`
    - Success: `bg-green-900/20 border-green-800/50`
    - Error: `bg-red-900/20 border-red-800/50`
  - Click header to expand/collapse content (when isCollapsible=true)
  - Default collapsed state (defaultCollapsed=true)
  - Content in `<pre>` tag with font-mono styling
  - Max-height 48 (48 lines) with overflow-y-auto
  - Hover effects and transitions
- **Integration:** Used in ActivityStream to display tool executions
- **Tool Types Supported:** read, write, execute, search, edit, generic

### Tests
- **File:** `src/components/__tests__/ActionCard.test.tsx`
- **Coverage:** 28 test cases organized into categories:
  1. Rendering (4 tests) - title, description, icons, tool types
  2. Status States (5 tests) - pending, running, success, error, all statuses
  3. Collapsible Behavior (4 tests) - expand/collapse, defaultCollapsed
  4. Content Display (5 tests) - pre tag, truncation, empty/null handling
  5. Visual Styling (3 tests) - borders, transitions, spacing
  6. Icon Rendering (5 tests) - icon types, status icons, animations
  7. Max Height & Scroll (2 tests) - max-height, scrolling

**Total:** 28 tests, all passing ✅

---

## Task 5.5: Create Status Indicator Bar
**Status:** ✅ COMPLETE
**Assignee:** AI Agent
**Time Estimate:** 1.5 hours

### Description
Add persistent status bar showing agent state.

### States
- **Planning**: 🧠 Analyzing problem...
- **Researching**: 🔍 Searching documentation...
- **Implementing**: 💻 Writing code...
- **Testing**: 🧪 Running tests...
- **Waiting**: ⏳ Waiting for approval...
- **Done**: ✅ Task completed

---

## Task 5.6: Enhance Todo Panel (Already Done)
**Status:** ✅ COMPLETE
**Notes:** Converted from side panel to header indicator + inline chat display

---

## Task 5.7: Implement Message Grouping
**Status:** ✅ COMPLETE
**Assignee:** AI Agent
**Time Estimate:** 1.5 hours

### Description
Group related messages (thinking + tools + result) into single unit.

---

## Task 5.8: Add Timeline View
**Status:** ✅ COMPLETE
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Alternative view showing agent activity as timeline.

---

## Task 5.9: Improve Loading States
**Status:** ✅ COMPLETE
**Assignee:** AI Agent
**Time Estimate:** 1 hour

### Description
Better loading/skeleton states.

---

## Task 5.10: Phase 5 Testing
**Status:** ✅ COMPLETE
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Test Plan
- [x] UI component tests
- [x] User flow tests
- [x] Accessibility audit
- [x] Performance tests

---

## Task 5.11: Fix Agent Over-Eager Tool Usage
**Status:** ✅ COMPLETE
**Assignee:** AI Agent
**Time Estimate:** 1 hour
**Priority:** HIGH - Critical UX Issue

### Description
Fix agent behavior where it automatically uses tools (read_file, list_files, etc.) for simple greetings or questions, causing:
- Permission denied errors
- Maximum step exceeded warnings  
- Unnecessary tool execution cards
- Poor user experience for casual conversation

### Root Cause
System prompt tells agent "Execute tools to fulfill the request" but doesn't specify WHEN NOT to use tools.

### Current Problems
1. User says "hello" → Agent tries to `read_file` workspace files
2. Simple questions trigger file scanning
3. Agent hits MAX_STEPS (10) looping through tools
4. User sees "Permission denied" cards for auto-triggered tools

### Solution
Update system prompt in `agent.rs` to:
- Explicitly tell agent NOT to use tools for greetings, small talk, or simple questions
- Only use tools when user explicitly requests file operations OR when necessary to solve a coding task
- Add examples of when NOT to use tools

### Files to Modify
- `src-tauri/src/domain/agent.rs` - Update system prompt (lines 91-108 and 300-318)

### Acceptance Criteria
- [x] Agent responds conversationally to "hello", "how are you" without tool usage
- [x] Simple questions don't trigger file reads
- [x] No permission denied errors for auto-triggered tools
- [x] Tools only used when user explicitly asks for file operations or coding help
- [x] System prompt updated in both `step()` and `step_stream()` methods

### Implementation Notes
Updated system prompt in `src-tauri/src/domain/agent.rs` to add explicit rules:
- Rule 4: DO NOT use tools for greetings, small talk, or simple questions
- Rule 5: Only use tools when user explicitly requests file operations or coding tasks
- Rule 6: When uncertain, respond conversationally without tools

Both `step()` and `step_stream()` methods updated with identical prompts.

---

## Progress Summary

- [x] Task 5.1: Workspace Session History
- [x] Task 5.2: Activity Stream Redesign
- [x] Task 5.3: Thinking Blocks
- [x] Task 5.4: Action Cards
- [x] Task 5.5: Status Indicator Bar
- [x] Task 5.6: Todo Panel Enhancement
- [x] Task 5.7: Message Grouping
- [x] Task 5.8: Timeline View
- [x] Task 5.9: Loading States
- [x] Task 5.10: Phase 5 Testing
- [x] Task 5.11: Fix Agent Over-Eager Tool Usage
- [x] Task 5.12: Implement Permissions UI Settings

---

## Task 5.12: Implement Permissions UI Settings
**Status:** ✅ COMPLETE
**Assignee:** AI Agent
**Time Estimate:** 3 hours
**Priority:** HIGH - Missing critical UX feature
