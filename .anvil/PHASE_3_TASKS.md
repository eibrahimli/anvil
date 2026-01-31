# Phase 3: Skill System

> **Goal:** Reusable agent capabilities via SKILL.md files
> **Timeline:** 1 week
> **Priority:** MEDIUM - Enhances agent capabilities
> **Depends on:** Phase 2 completion

## Task 3.1: Create Skill Discovery System
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1.5 hours

### Description
Implement skill discovery and loading from skill directories.

### Skill Locations
1. Project: `.anvil/skills/<name>/SKILL.md`
2. Global: `~/.config/anvil/skills/<name>/SKILL.md`
3. Claude-compatible: `.claude/skills/<name>/SKILL.md`
4. Claude-compatible global: `~/.claude/skills/<name>/SKILL.md`

### Discovery Process
1. Walk up from current directory to git root
2. Collect all `skills/*/SKILL.md` files
3. Merge with global skills
4. Validate no duplicates (first found wins)

### Skill Structure
```
skills/
├── git-release/
│   └── SKILL.md
├── code-review/
│   └── SKILL.md
└── typescript-patterns/
    └── SKILL.md
```

### Acceptance Criteria
- [ ] Discovery works for all locations
- [ ] No duplicate skills
- [ ] Correct precedence (local > global)

---

## Task 3.2: Implement Skill Loader
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1 hour

### Description
Parse SKILL.md files with YAML frontmatter.

### SKILL.md Format
```markdown
---
name: git-release
description: Create consistent releases and changelogs
license: MIT
compatibility: opencode
metadata:
  audience: maintainers
  workflow: github
---

## What I do
- Draft release notes from merged PRs
- Propose version bump
- Provide copy-pasteable commands

## When to use me
Use when preparing a tagged release.
```

### Frontmatter Fields
- `name` (required): Skill identifier
- `description` (required): What the skill does
- `license` (optional): License info
- `compatibility` (optional): anvil | claude | all
- `metadata` (optional): Key-value pairs

### Name Validation
- 1-64 characters
- Lowercase alphanumeric with hyphens
- No leading/trailing/consecutive hyphens
- Regex: `^[a-z0-9]+(-[a-z0-9]+)*$`
- Must match directory name

### Acceptance Criteria
- [ ] Parses frontmatter
- [ ] Validates names
- [ ] Returns structured skill data
- [ ] Error handling for invalid files

---

## Task 3.3: Implement `skill` Tool
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1 hour

### Description
Create tool to load skill content into agent context.

### Tool Schema
```rust
name: "skill"
parameters: {
  name: string  // Required, skill name to load
}
```

### Behavior
1. Look up skill by name in registry
2. Read SKILL.md content
3. Inject into conversation context
4. Return success/failure

### Tool Description (for LLM)
```
Load a skill (SKILL.md file) and return its content.
Available skills:
- git-release: Create consistent releases and changelogs
- code-review: Review code for quality and best practices

To load: skill({ name: "git-release" })
```

### Acceptance Criteria
- [ ] Tool loads skills
- [ ] Content injected into context
- [ ] Permission check (respects skill permissions)

---

## Task 3.4: Implement Skill Permissions
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1 hour

### Description
Add permission system for skills.

### Config Example
```json
{
  "permission": {
    "skill": {
      "*": "allow",
      "internal-*": "deny",
      "experimental-*": "ask"
    }
  }
}
```

### Permission Values
- `allow`: Load skill immediately
- `deny`: Skill hidden from agent, access rejected
- `ask`: User prompted before loading

### Agent-Specific Override
```json
{
  "agent": {
    "plan": {
      "permission": {
        "skill": {
          "internal-*": "allow"
        }
      }
    }
  }
}
```

### Acceptance Criteria
- [ ] Permission evaluation works
- [ ] Wildcard patterns work
- [ ] Agent overrides work

---

## Task 3.5: Create Skill UI Components
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1.5 hours

### Description
UI for skill discovery and management.

### Components
1. **Skill Registry Panel**: List all available skills
2. **Skill Card**: Display skill info (name, description, metadata)
3. **Skill Autocomplete**: When typing `@` in chat, show skill suggestions

### UI Specifications
- Side panel showing available skills
- Categories/Tags from metadata
- Search/filter skills
- Quick load button

### Acceptance Criteria
- [ ] Panel displays skills
- [ ] Autocomplete works
- [ ] Skill info displayed
- [ ] Load button triggers tool

---

## Task 3.6: Create Sample Skills
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1 hour

### Description
Create example skills for demonstration.

### Sample Skills
1. **git-workflow**: Git branching, committing, PR workflow
2. **typescript-patterns**: Common TypeScript patterns
3. **rust-patterns**: Common Rust patterns
4. **code-review**: Code review checklist
5. **documentation**: Writing good docs

### Acceptance Criteria
- [ ] 3-5 sample skills created
- [ ] All follow format specification
- [ ] Valid frontmatter
- [ ] Useful content

---

## Task 3.7: Skill Tool Integration
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1 hour

### Description
Integrate skill tool with agent system.

### Requirements
- Make skill tool available to all agents by default
- Update agent system prompt to mention skills
- Tool description includes available skills list

### Acceptance Criteria
- [ ] Tool available to agents
- [ ] System prompt mentions skills
- [ ] Agents can discover and use skills

---

## Task 3.8: Phase 3 Testing
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 1 hour

### Test Plan
- [ ] Skill discovery tests
- [ ] Skill loading tests
- [ ] Permission tests
- [ ] E2E: Agent uses skill to complete task

### Acceptance Criteria
- [ ] All tests pass
- [ ] Skills work end-to-end

---

## Progress Summary

- [ ] Task 3.1: Create Skill Discovery System
- [ ] Task 3.2: Implement Skill Loader
- [ ] Task 3.3: Implement `skill` Tool
- [ ] Task 3.4: Implement Skill Permissions
- [ ] Task 3.5: Create Skill UI Components
- [ ] Task 3.6: Create Sample Skills
- [ ] Task 3.7: Skill Tool Integration
- [ ] Task 3.8: Phase 3 Testing

---

## Design Principles

1. **Modularity**: Skills are self-contained
2. **Discoverability**: Easy to find and use
3. **Versioning**: Skills can be updated independently
4. **Community**: Easy to share skills

## Notes

### Skill vs Agent
- **Agent**: Persistent personality with tools
- **Skill**: One-time context injection for specific task
- Relationship: Agents can use skills, but skills are not agents

### Future Enhancements
- Skill versioning
- Remote skill loading (URLs)
- Skill marketplace
- Skill dependencies (skill A requires skill B)
