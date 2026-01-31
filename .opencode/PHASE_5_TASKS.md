# Phase 5: UX Refinement

> **Goal:** Redesign UI to be Agent-centric, not IDE-centric
> **Timeline:** 1 week
> **Priority:** MEDIUM - Critical for "Not an IDE" philosophy
> **Depends on:** Phase 1 completion (question/todo tools)

## Task 5.1: Activity Stream Redesign (Concept)
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

## Task 5.2: Implement Thinking Blocks
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

### Implementation
```typescript
interface ThinkingBlock {
  id: string;
  content: string;
  isExpanded: boolean;
}
```

### Acceptance Criteria
- [ ] Blocks render correctly
- [ ] Collapse/expand works
- [ ] Visual styling distinct
- [ ] Doesn't overwhelm chat

---

## Task 5.3: Implement Action Cards
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 3 hours

### Description
Redesign tool execution display as action cards.

### Current State
Tool results shown as JSON/text blocks

### Target State
```
┌──────────────────────────────────────────┐
│ 🖥️  bash                                  │
│ Running: npm install                      │
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░ 45%                  │
│ [View Output] [Stop]                      │
└──────────────────────────────────────────┘
```

### States
1. **Pending**: Grey, waiting for permission
2. **Running**: Spinner, progress bar, live output
3. **Success**: Green checkmark, collapsed output
4. **Error**: Red X, expanded error details

### Acceptance Criteria
- [ ] Cards for each tool type
- [ ] State visualization correct
- [ ] Progress indication (when possible)
- [ ] Collapsible output

---

## Task 5.4: Create Status Indicator Bar
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1.5 hours

### Description
Add persistent status bar showing agent state.

### Location
Bottom of chat or top header

### States
- **Planning**: 🧠 Analyzing problem...
- **Researching**: 🔍 Searching documentation...
- **Implementing**: 💻 Writing code...
- **Testing**: 🧪 Running tests...
- **Waiting**: ⏳ Waiting for approval...
- **Done**: ✅ Task completed

### Visual Design
- Color-coded badges
- Animated transitions
- Click to see detailed status

### Acceptance Criteria
- [ ] Status bar renders
- [ ] States update correctly
- [ ] Visual design approved

---

## Task 5.5: Enhance Todo Panel
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Create persistent todo/plan panel (depends on Task 1.10).

### Location
Right side panel (opposite file tree)

### Features
- Always visible during agent execution
- Shows current task at top
- Collapsible sections (In Progress, Pending, Completed)
- Visual indicators for priority
- User can mark tasks complete
- Updates in real-time from TODO.md

### Visual Design
```
┌──────────────┐
│ 📋 Plan       │
├──────────────┤
│ ▶ In Progress│
│ • Task 1     │
├──────────────┤
│ ○ Pending    │
│ • Task 2     │
│ • Task 3     │
├──────────────┤
│ ✓ Completed  │
│ • Task 0     │
└──────────────┘
```

### Acceptance Criteria
- [ ] Panel always visible
- [ ] Updates in real-time
- [ ] Sections collapsible
- [ ] User interactions work

---

## Task 5.6: Redesign Tool Result Cards
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Improve tool result visualization.

### Requirements
- **File Read**: Syntax highlighted code preview
- **Bash**: Terminal-like output with scroll
- **Search**: Results with file:line links
- **Edit**: Side-by-side diff view
- **Write**: File creation confirmation

### All Cards Should
- Be collapsed by default (show summary)
- Expand on click
- Have copy button
- Have open in editor link (for files)

### Acceptance Criteria
- [ ] All tool types have custom cards
- [ ] Collapsed by default
- [ ] Syntax highlighting
- [ ] Interactive elements work

---

## Task 5.7: Implement Message Grouping
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1.5 hours

### Description
Group related messages (thinking + tools + result) into single unit.

### Problem
Currently each message is separate, hard to follow flow.

### Solution
Group messages by "intent" or "step":
```
Step 1: Analyze
  ├─ 🧠 Thinking: "I need to understand the structure..."
  ├─ 📖 Read: package.json
  ├─ 📖 Read: README.md
  └─ 💬 Result: "This is a React app..."

Step 2: Implement
  ├─ 🧠 Thinking: "I'll add a new component..."
  ├─ ✏️  Edit: src/App.tsx
  └─ 💬 Result: "Added the component..."
```

### Acceptance Criteria
- [ ] Messages grouped logically
- [ ] Groups collapsible
- [ ] Clear visual hierarchy

---

## Task 5.8: Add Timeline View
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Alternative view showing agent activity as timeline.

### Toggle
Chat View <-> Timeline View

### Timeline Elements
- Time markers
- Tool executions as events
- Gaps between activities
- Duration indicators

### Use Case
Debugging agent behavior, understanding time spent

### Acceptance Criteria
- [ ] Timeline view works
- [ ] Toggle between views
- [ ] Shows useful timing info

---

## Task 5.9: Improve Loading States
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1 hour

### Description
Better loading/skeleton states.

### Requirements
- Skeleton for chat messages
- Typing indicator for agent
- Progress bars for long operations
- Placeholder content

### Acceptance Criteria
- [ ] Skeletons implemented
- [ ] Typing indicator shows
- [ ] Progress bars for uploads/operations

---

## Task 5.10: Phase 5 Testing
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Test Plan
- [ ] UI component tests
- [ ] User flow tests
- [ ] Accessibility audit
- [ ] Performance tests (rendering 100+ messages)
- [ ] User feedback session

### Acceptance Criteria
- [ ] All tests pass
- [ ] Performance acceptable
- [ ] Users can follow agent actions

---

## Progress Summary

- [ ] Task 5.1: Activity Stream Redesign (Concept)
- [ ] Task 5.2: Implement Thinking Blocks
- [ ] Task 5.3: Implement Action Cards
- [ ] Task 5.4: Create Status Indicator Bar
- [ ] Task 5.5: Enhance Todo Panel
- [ ] Task 5.6: Redesign Tool Result Cards
- [ ] Task 5.7: Implement Message Grouping
- [ ] Task 5.8: Add Timeline View
- [ ] Task 5.9: Improve Loading States
- [ ] Task 5.10: Phase 5 Testing

---

## Design Principles

1. **Clarity**: Always know what agent is doing
2. **Brevity**: Don't overwhelm with output
3. **Actionable**: Easy to see and interact with results
4. **History**: Can scroll back and understand what happened

## Key UX Tenets

- Agent is the primary actor, user is the director
- Show process, not just results
- Progressive disclosure (start collapsed, expand on demand)
- Clear state transitions (Planning -> Doing -> Done)
- Never hide that an AI is doing the work
