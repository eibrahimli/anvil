# Phase 2: Configuration & Rules Engine

> **Goal:** Make the agent respect complex user rules and permissions
> **Timeline:** 2 weeks
> **Priority:** HIGH - Foundation for secure agent operation
> **Depends on:** Phase 1 completion

## Task 2.1: Create Config Manager
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Implement configuration system for `anvil.json` parsing and management.

### Requirements
- Create `src-tauri/src/config/` module
- Implement `ConfigManager` struct
- Parse JSON with Serde
- Support global + local config merging

### Config Locations
1. Global: `~/.config/anvil/anvil.json`
2. Local: `.anvil/anvil.json` (workspace)

### Config Schema
```rust
struct Config {
    model: Option<String>,           // Default model
    provider: HashMap<String, ProviderConfig>,
    permission: PermissionConfig,
    instructions: Vec<String>,       // External rule files
    agent: HashMap<String, AgentConfig>,
    lsp: Option<LspConfig>,
    mcp: Option<McpConfig>,
}
```

### Acceptance Criteria
- [ ] Config parsing works
- [ ] Global + local merging correct
- [ ] Default values set
- [ ] Error handling for invalid configs

---

## Task 2.2: Implement Granular Permissions (Backend)
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 3 hours

### Description
Refactor permission system to support granular allow/ask/deny per tool and argument.

### Current State
Basic permissions: `allowed: HashSet<Permission>`

### Target State
```rust
enum Action {
    Allow,
    Ask,
    Deny,
}

struct PermissionRule {
    pattern: String,  // Glob pattern (e.g., "git push *")
    action: Action,
}

struct ToolPermissions {
    default: Action,
    rules: Vec<PermissionRule>,
}
```

### Requirements
- Pattern matching for arguments (glob syntax)
- Last-matching-rule-wins logic
- Support for `*` wildcard (all commands)
- Support for specific patterns

### Example Config
```json
{
  "permission": {
    "bash": {
      "*": "ask",
      "git status *": "allow",
      "git push *": "deny",
      "grep *": "allow"
    },
    "edit": {
      "*": "deny",
      "src/**/*.ts": "ask"
    }
  }
}
```

### Acceptance Criteria
- [ ] Permission evaluation works
- [ ] Pattern matching correct
- [ ] Rules evaluated in order
- [ ] Unit tests for complex scenarios

---

## Task 2.3: Update Confirmation System
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Update confirmation UI to support "Allow Always" with patterns.

### Requirements
- Extend `ConfirmationModal` to show suggested patterns
- Add "Allow Once", "Allow Always", "Deny" buttons
- Store user choices in session (not persisted)
- Support pattern preview

### UI Mockup
```
┌─────────────────────────────────────┐
│  Tool: bash                          │
│  Command: git push origin main       │
│                                      │
│  Suggested pattern: git push *       │
│                                      │
│  [Allow Once] [Allow Always] [Deny] │
└─────────────────────────────────────┘
```

### Acceptance Criteria
- [ ] UI shows suggested patterns
- [ ] "Allow Always" remembers for session
- [ ] Pattern preview editable
- [ ] Clear visual feedback

---

## Task 2.4: Enhance AGENTS.md Parser
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Improve `ContextBuilder` to parse complex `AGENTS.md` with external references.

### Current State
Basic text injection into context

### Target State
- Parse `@file` references: `@rules/typescript.md`
- Lazy loading: only load when needed
- Support YAML frontmatter
- Recursion handling (prevent cycles)

### AGENTS.md Format
```markdown
# Project Rules

## External References
CRITICAL: When you encounter a file reference (e.g., @rules/general.md),
use your Read tool to load it on a need-to-know basis.

## Standards
@rules/typescript.md
@docs/api-standards.md

## Guidelines
Read immediately: @rules/general-guidelines.md
```

### Acceptance Criteria
- [ ] Parses `@file` syntax
- [ ] Lazy loading works
- [ ] Cycle detection
- [ ] Error handling for missing files

---

## Task 2.5: Implement .env File Protection
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1 hour

### Description
Add default permission rule to deny reading .env files.

### Requirements
- Default: `read *.env = deny`
- Default: `read *.env.* = deny`
- Exception: `read *.env.example = allow`

### Acceptance Criteria
- [ ] Default rules implemented
- [ ] Cannot read .env by default
- [ ] Can read .env.example

---

## Task 2.6: External Directory Permissions
**Status:** ✅ Complete
**Assignee:** AI Agent
**Time Estimate:** 1 hour

### Description
Implement permission for accessing paths outside workspace.

### Requirements
- New permission: `external_directory`
- Home expansion: `~/projects/*`
- Validation for all path-taking tools

### Example Config
```json
{
  "permission": {
    "external_directory": {
      "~/projects/personal/**": "allow",
      "~/.config/**": "deny"
    }
  }
}
```

### Acceptance Criteria
- [x] External path detection
- [x] Permission evaluation
- [x] Home directory expansion

---

## Task 2.7: Config Hot Reload
**Status:** ✅ Complete
**Assignee:** AI Agent
**Time Estimate:** 1 hour

### Description
Watch config files for changes and reload.

### Requirements
- Watch `.anvil/anvil.json`
- Debounce changes (500ms)
- Reload without restart
- Notify user of changes

### Acceptance Criteria
- [x] File watching works
- [x] Config reloads
- [x] No restart required

---

## Task 2.8: Phase 2 Testing
**Status:** ✅ Complete
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Test Plan
- [x] Config parsing tests
- [x] Permission evaluation tests (edge cases)
- [x] Pattern matching tests
- [x] AGENTS.md parsing tests
- [x] E2E: Agent respects permissions

### Acceptance Criteria
- [x] All tests pass
- [x] Security audit complete

---

## Progress Summary

- [x] Task 2.1: Create Config Manager
- [x] Task 2.2: Implement Granular Permissions
- [x] Task 2.3: Update Confirmation System
- [x] Task 2.4: Enhance AGENTS.md Parser
- [x] Task 2.5: Implement .env File Protection
- [x] Task 2.6: External Directory Permissions
- [x] Task 2.7: Config Hot Reload
- [x] Task 2.8: Phase 2 Testing

---

## Design Principles

1. **Security First**: Deny by default, explicit allow
2. **Transparency**: User always knows what agent is doing
3. **Flexibility**: Granular control without complexity
4. **Performance**: Lazy loading, efficient pattern matching

## Notes

### Pattern Matching Rules
- `*` matches zero or more characters
- `?` matches exactly one character
- All other characters match literally
- Patterns evaluated in order, last match wins

### Breaking Changes
- Old `allowed: HashSet<Permission>` will be deprecated
- Migration guide needed for existing users
