# Phase 6: LSP & Release

> **Goal:** Code intelligence and distribution
> **Timeline:** 2+ weeks
> **Priority:** LOW - Long-term features
> **Depends on:** Phase 4 completion (stability needed)

## Task 6.1: Research LSP Implementation
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 3 hours

### Description
Research LSP client implementation in Rust.

### Research Areas
1. LSP specification 3.17
2. Existing Rust LSP clients
3. Tower-LSP library
4. Process management for LSP servers
5. Capabilities negotiation

### Questions to Answer
- Can we use `tower-lsp` or need custom implementation?
- How to manage LSP server lifecycle?
- Which LSP servers to bundle vs auto-detect?
- Performance impact on large codebases?

### Deliverables
- [ ] Research notes
- [ ] Implementation strategy
- [ ] Library recommendations

---

## Task 6.2: Implement LSP Client Core
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 6 hours

### Description
Create LSP client in Rust.

### Module Structure
```
src-tauri/src/lsp/
├── mod.rs           # Public API
├── client.rs        # LSP client
├── server.rs        # Server management
├── protocol.rs      # LSP types
└── tools.rs         # LSP tool implementations
```

### Requirements
- JSON-RPC over stdio
- Initialize handshake
- Text document sync
- Diagnostics collection

### Core Types
```rust
struct LspClient {
    process: Child,
    capabilities: ServerCapabilities,
    root_uri: Url,
}
```

### Acceptance Criteria
- [ ] Client connects to LSP server
- [ ] Initialization works
- [ ] Can send/receive messages
- [ ] Server lifecycle managed

---

## Task 6.3: Implement LSP Server Management
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 4 hours

### Description
Auto-detect and manage LSP servers.

### Requirements
- Detect language from file extension
- Start appropriate LSP server
- Handle multiple concurrent servers
- Restart on crash

### Supported Languages (from anvil docs)
- TypeScript (typescript-language-server)
- Rust (rust-analyzer)
- Python (pyright)
- Go (gopls)
- C/C++ (clangd)
- etc. (see full list in docs)

### Auto-Installation
- Download pre-built binaries
- Or use system-installed servers
- Config: `ANVIL_DISABLE_LSP_DOWNLOAD`

### Acceptance Criteria
- [ ] Auto-detection works
- [ ] Servers start/stop correctly
- [ ] Multiple servers supported
- [ ] Graceful restarts

---

## Task 6.4: Implement LSP Tools
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 4 hours

### Description
Create `lsp` tool for agent to use LSP features.

### Tool Schema
```rust
name: "lsp"
parameters: {
  operation: string,  // Required: "goToDefinition" | "findReferences" | "hover" | "documentSymbol" | "workspaceSymbol" | "goToImplementation" | "prepareCallHierarchy" | "incomingCalls" | "outgoingCalls"
  path: string,       // Required: file path
  line: number,       // Required: line number (0-indexed)
  character: number   // Required: column (0-indexed)
}
```

### Operations
1. **goToDefinition**: Jump to symbol definition
2. **findReferences**: Find all references
3. **hover**: Type/documentation info
4. **documentSymbol**: List symbols in file
5. **workspaceSymbol**: Search symbols across project
6. **goToImplementation**: Find implementations
7. **prepareCallHierarchy**: Get call hierarchy
8. **incomingCalls**: Who calls this function
9. **outgoingCalls**: What this function calls

### Acceptance Criteria
- [ ] All operations implemented
- [ ] Results formatted for agent
- [ ] Error handling
- [ ] Timeout handling

---

## Task 6.5: LSP Configuration System
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Add LSP config to anvil.json.

### Config Schema
```rust
struct LspConfig {
    enabled: bool,
    servers: HashMap<String, LspServerConfig>,
}

struct LspServerConfig {
    disabled: bool,
    command: Vec<String>,      // Override command
    extensions: Vec<String>,   // File extensions
    env: HashMap<String, String>,
    initialization: serde_json::Value,
}
```

### Example Config
```json
{
  "lsp": {
    "typescript": {
      "disabled": false,
      "command": ["typescript-language-server", "--stdio"]
    },
    "rust": {
      "disabled": true
    }
  }
}
```

### Acceptance Criteria
- [ ] Config parsing works
- [ ] Servers configurable
- [ ] Enable/disable works

---

## Task 6.6: LSP UI Integration
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 3 hours

### Description
Show LSP status and results in UI.

### Components
1. **LSP Status Bar**: Show active servers
2. **Diagnostics Panel**: Error/warning list
3. **Symbol Search**: Quick navigation
4. **Hover Info**: Type info on hover (optional)

### Acceptance Criteria
- [ ] Status bar shows servers
- [ ] Diagnostics displayed
- [ ] Symbol search works

---

## Task 6.7: Linux Packaging
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 3 hours

### Description
Create Linux distribution packages.

### Targets
- [ ] AppImage (universal)
- [ ] .deb (Ubuntu/Debian)
- [ ] .rpm (Fedora/RHEL)
- [ ] Flatpak (optional)

### Tauri Built-in Support
Tauri has `tauri build` with `--target` flag

### Custom Steps
- Desktop file
- Icon
- Post-install scripts

### Acceptance Criteria
- [ ] All packages build successfully
- [ ] Install and run on clean systems
- [ ] Auto-updater configured (optional)

---

## Task 6.8: macOS Packaging
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Create macOS distribution.

### Targets
- [ ] .dmg (disk image)
- [ ] .app bundle
- [ ] Apple Silicon + Intel (universal binary)

### Requirements
- Code signing (optional for open source)
- Notarization (optional)
- Info.plist

### Tauri Support
`tauri build --target universal-apple-darwin`

### Acceptance Criteria
- [ ] DMG created
- [ ] App launches on macOS
- [ ] Both architectures supported

---

## Task 6.9: Windows Packaging
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 2 hours

### Description
Create Windows distribution.

### Targets
- [ ] .msi installer
- [ ] .exe installer (optional)
- [ ] Portable .exe (optional)

### Requirements
- Code signing certificate (optional)
- Windows installer UI
- Registry entries

### Tauri Support
`tauri build --target x86_64-pc-windows-msvc`

### Acceptance Criteria
- [ ] MSI installer works
- [ ] Installs correctly
- [ ] Uninstall works

---

## Task 6.10: Release Automation
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 3 hours

### Description
Set up CI/CD for automated releases.

### Platform
- GitHub Actions

### Workflow
1. Build for all platforms
2. Create release notes
3. Upload artifacts
4. Update website/downloads

### Triggers
- Tag push (v1.0.0)
- Manual trigger
- Nightly builds (optional)

### Acceptance Criteria
- [ ] GitHub Actions workflow
- [ ] All platforms built
- [ ] Release created automatically
- [ ] Artifacts uploaded

---

## Task 6.11: Documentation
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 4 hours

### Description
Complete user and developer documentation.

### User Documentation
- [ ] Installation guide
- [ ] Quick start
- [ ] Tool reference
- [ ] Configuration guide
- [ ] Troubleshooting

### Developer Documentation
- [ ] Architecture overview
- [ ] Contributing guide
- [ ] Plugin development
- [ ] API reference

### Acceptance Criteria
- [ ] All docs written
- [ ] Reviewed for accuracy
- [ ] Published to website

---

## Task 6.12: Phase 6 Testing
**Status:** ⬜ Not Started
**Assignee:** AI Agent
**Time Estimate:** 4 hours

### Test Plan
- [ ] LSP integration tests
- [ ] Package installation tests (all platforms)
- [ ] Upgrade tests
- [ ] Performance benchmarks
- [ ] Security audit
- [ ] User acceptance testing

### Acceptance Criteria
- [ ] All tests pass
- [ ] Packages install on clean systems
- [ ] Performance acceptable
- [ ] Ready for v1.0 release

---

## Progress Summary

- [ ] Task 6.1: Research LSP Implementation
- [ ] Task 6.2: Implement LSP Client Core
- [ ] Task 6.3: Implement LSP Server Management
- [ ] Task 6.4: Implement LSP Tools
- [ ] Task 6.5: LSP Configuration System
- [ ] Task 6.6: LSP UI Integration
- [ ] Task 6.7: Linux Packaging
- [ ] Task 6.8: macOS Packaging
- [ ] Task 6.9: Windows Packaging
- [ ] Task 6.10: Release Automation
- [ ] Task 6.11: Documentation
- [ ] Task 6.12: Phase 6 Testing

---

## Release Checklist

Before v1.0 release:
- [ ] All phases complete
- [ ] All tests passing
- [ ] Documentation complete
- [ ] Packages tested on clean systems
- [ ] Security audit passed
- [ ] Performance benchmarks met
- [ ] User feedback addressed
- [ ] License file included
- [ ] Changelog written
- [ ] GitHub release created

## Notes

### LSP Complexity
LSP is a complex protocol. Consider making it:
- Optional feature (compile flag)
- Experimental at first
- Well-documented limitations

### Packaging Priority
1. Linux (AppImage) - primary development platform
2. macOS - large developer user base
3. Windows - last but essential

### Version Scheme
Follow semantic versioning:
- v0.x.x - Beta/development
- v1.0.0 - First stable release
- v1.x.x - Feature additions
