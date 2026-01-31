# Naming Updates: opencode → Anvil

**Date:** 2026-01-31  
**Status:** COMPLETE ✅

## Summary

All project references have been updated from "opencode" to "Anvil" to match the actual project name.

## Changes Made

### 1. Folder Structure
- ✅ **Renamed:** `.opencode/` → `.anvil/`

### 2. Configuration Files
- ✅ **PHASE_1_SUMMARY.md:** `opencode.json` → `anvil.json`
- ✅ **PHASE_1_TASKS.md:** `.opencode/TODO.md` → `.anvil/TODO.md`
- ✅ **PHASE_2_TASKS.md:** 
  - `opencode.json` → `anvil.json`
  - `~/.config/opencode/` → `~/.config/anvil/`
  - `.opencode/opencode.json` → `.anvil/anvil.json`
- ✅ **PHASE_4_TASKS.md:**
  - `~/.local/share/opencode/` → `~/.local/share/anvil/`
  - `opencode.json` → `anvil.json`
- ✅ **PHASE_6_TASKS.md:**
  - `opencode docs` → `anvil docs`
  - `OPENCODE_DISABLE_LSP_DOWNLOAD` → `ANVIL_DISABLE_LSP_DOWNLOAD`
  - `opencode.json` → `anvil.json`

### 3. Skill System (PHASE_3_TASKS.md)
- ✅ `.opencode/skills/` → `.anvil/skills/`
- ✅ `~/.config/opencode/skills/` → `~/.config/anvil/skills/`
- ✅ `compatibility: anvil` (for Anvil-specific skills)
- ⚠️ **Kept as "opencode":** `compatibility: opencode` - This refers to compatibility with the external opencode tool format standard, not our project name

### 4. Documentation (AGENTS.md)
- ✅ `.opencode/` folder references → `.anvil/`
- ✅ `.opencode/rules.md` → `.anvil/rules.md`

## Standard Naming Convention

### Project Folders
```
~/workspace/my-project/
├── .anvil/                    # Anvil configuration folder
│   ├── anvil.json            # Main config file
│   ├── TODO.md               # Task list
│   ├── skills/               # Skill definitions
│   └── rules.md              # Project rules
├── src/
└── ...
```

### Global Config
```
~/.config/anvil/
├── anvil.json                # Global settings
└── skills/                   # Global skills
```

### Data Storage
```
~/.local/share/anvil/
├── mcp-auth.json            # MCP authentication
└── ...
```

## Intentional Exceptions

The following references to "opencode" are **intentionally kept**:

1. **PHASE_3_TASKS.md line 60:** `compatibility: opencode` - Refers to compatibility with the external opencode tool format specification (not our project name)

This allows skills to declare compatibility with multiple platforms:
- `compatibility: anvil` - Works with Anvil
- `compatibility: opencode` - Works with opencode.ai
- `compatibility: claude` - Works with Claude Code
- `compatibility: all` - Universal compatibility

## Verification

All files checked:
- ✅ No remaining incorrect references to opencode
- ✅ All configuration paths updated
- ✅ All documentation updated
- ✅ Folder renamed successfully

---

**All naming is now consistent with the Anvil project!** 🎉
