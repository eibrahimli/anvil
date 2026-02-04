## Task 5.12: Implement Permissions UI Settings
**Status:** 🔄 In Progress
**Assignee:** AI Agent
**Time Estimate:** 3 hours
**Priority:** HIGH - Missing critical UX feature

### Description
Add a Permissions tab to Settings Modal that provides visual UI for managing tool permissions instead of requiring manual JSON file editing.

### Current Problem
- Permissions are controlled via `.anvil/anvil.json` config file
- Users must manually edit JSON to change Allow/Ask/Deny settings
- No UI exists to manage permissions visually
- No feedback in UI about current permission state

### Target Design
```
┌─────────────────────────────────────────┐
│  Permissions                         │
│  ┌──────────────────────────────┐    │
│  │ Tool Permissions             │    │
│  │  [📄 Read] Allow        │    │
│  │  [✏️  Write] Ask       │    │
│  │  [🖥️  Bash] Allow       │    │
│  │  [🔧  Edit] Allow       │    │
│  └──────────────────────────────┘    │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ Permission Rules             │    │
│  │  Pattern: *.json       │    │
│  │  Action:  [Ask]      │    │
│  │  [+ Add Rule]             │    │
│  └──────────────────────────────┘    │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ Global Defaults            │    │
│  │  New Tools:  [Ask]     │    │
│  └──────────────────────────────┘    │
│                                      │
│  [Save to .anvil/anvil.json]        │
└─────────────────────────────────────────┘
```

### Implementation Plan

#### 1. Backend - Add Permission Management Commands
- **File:** `src-tauri/src/commands.rs`
- Add `save_permission_config` command to save permissions to `.anvil/anvil.json`
- Add `load_permission_config` command to load current permissions
- Commands should merge with existing config (Provider, Model, etc.)

#### 2. Frontend - Add Permissions Tab
- **File:** `src/components/settings/PermissionsTab.tsx` (new)
- **Features:**
  - Per-tool permission dropdowns (Allow/Ask/Deny)
  - Permission rules list (pattern + action)
  - Add/Edit/Delete rule functionality
  - Global default setting for new tools
  - Save button that writes to `.anvil/anvil.json`

#### 3. Update SettingsModal
- **File:** `src/components/settings/SettingsModal.tsx`
- Add "Permissions" tab button (Shield icon)
- Import and render PermissionsTab component
- Handle save errors gracefully

#### 4. Update Config Manager
- **File:** `src-tauri/src/config/manager.rs`
- Ensure permissions are properly merged when loading configs
- Validate permission config structure

### Acceptance Criteria
- [ ] Permissions tab added to SettingsModal
- [ ] Can change per-tool permissions (read, write, edit, bash)
- [ ] Can add/remove permission rules with patterns
- [ ] Global default setting for new tools works
- [ ] Save button writes to `.anvil/anvil.json`
- [ ] Changes apply immediately (restart session or reload config)
- [ ] TypeScript compilation passes
- [ ] All tests pass

### Files to Create
- `src/components/settings/PermissionsTab.tsx` - New permissions UI component
- `src/components/__tests__/PermissionsTab.test.tsx` - Tests for permissions UI

### Files to Modify
- `src/components/settings/SettingsModal.tsx` - Add Permissions tab
- `src-tauri/src/commands.rs` - Add permission config commands
- `src-tauri/src/config/manager.rs` - Ensure permission merging works
- `.anvil/PHASE_5_TASKS.md` - Add this task

### Integration Notes
- The `.anvil/anvil.json` file structure:
  ```json
  {
    "permission": {
      "bash": { "default": "allow" },
      "read": { "default": "allow" },
      "write": { "default": "allow" },
      "edit": { "default": "allow" }
    }
  }
  ```
- SettingsModal uses `SettingsTab` type - add 'permissions' to the union
- Use Shield icon from lucide-react for Permissions tab button
