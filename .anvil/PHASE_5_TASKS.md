# Phase 5: UX Refinement

> **Goal:** Redesign UI to be Agent-centric, not IDE-centric
> **Timeline:** 1 week
> **Priority:** MEDIUM - Critical for "Not an IDE" philosophy
> **Depends on:** Phase 1 completion (question/todo tools)

## Task 5.1: Integrate Session History into Workspace Switcher
**Status:** 🔄 IN PROGRESS
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
- [ ] Hover/click workspace shows its sessions
- [ ] Sessions sorted by date (newest first)
- [ ] Click session to replay
- [ ] Visual distinction between active/completed sessions
- [ ] "New Session" button for quick start
- [ ] Remove HistoryModal from AppShell

---

## Task 5.2: Activity Stream Redesign (Concept)
**Status:** ⬜ Not Started
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
- [ ] Design document created
- [ ] UI mockups approved
- [ ] Component architecture planned

---

## Task 5.3: Implement Thinking Blocks
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Create collapsible "thinking" sections in chat.

### Requirements
- Parse thinking content from agent messages
- Collapsible by default (show first 2 lines)
- Expand on click
- Visual distinction (grey background, italic)

---

## Task 5.4: Implement Action Cards
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 3 hours

### Description
Redesign tool execution display as action cards.

### Requirements
- Tool results shown as cards, not JSON/text blocks
- States: Pending (grey), Running (spinner), Success (green), Error (red)
- Progress indication where possible
- Collapsible output

---

## Task 5.5: Create Status Indicator Bar
**Status:** ⬜ Not Started
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
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1.5 hours

### Description
Group related messages (thinking + tools + result) into single unit.

---

## Task 5.8: Add Timeline View
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Alternative view showing agent activity as timeline.

---

## Task 5.9: Improve Loading States
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1 hour

### Description
Better loading/skeleton states.

---

## Task 5.10: Phase 5 Testing
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Test Plan
- [ ] UI component tests
- [ ] User flow tests
- [ ] Accessibility audit
- [ ] Performance tests

---

## Progress Summary

- [x] Task 5.1: Workspace Session History (Added to plan - ready to implement)
- [ ] Task 5.2: Activity Stream Concept
- [ ] Task 5.3: Thinking Blocks
- [ ] Task 5.4: Action Cards
- [ ] Task 5.5: Status Indicator Bar
- [x] Task 5.6: Todo Panel Enhancement
- [ ] Task 5.7: Message Grouping
- [ ] Task 5.8: Timeline View
- [ ] Task 5.9: Loading States
- [ ] Task 5.10: Phase 5 Testing
