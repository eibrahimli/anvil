# AGENTS.md

This file contains instructions for AI agents (and human developers) working on the Anvil repository.

## Project Overview
Anvil is a Tauri-based application using React, TypeScript, and Vite. It serves as an AI coding agent environment with a chat interface, terminal integration, and code editor.

## Build and Run Commands

### Development
- **Start Frontend Only:** `npm run dev`
  - Runs the React/Vite dev server. Useful for UI work not requiring backend Rust APIs.
- **Start Full App:** `npm run tauri dev`
  - Runs the Tauri application (Rust backend + Frontend). Required for features using `invoke` or `listen`.

### Production
- **Build Frontend:** `npm run build`
  - Runs `tsc` (type check) and `vite build`.
- **Build Application:** `npm run tauri build`
  - Builds the distributable Tauri application.

### Testing & Linting
- **Type Check:** `npx tauri build` (implicitly runs `tsc`) or just `npx tsc --noEmit`.
- **Linting:** No explicit linter (ESLint) is currently configured in `package.json`. Follow existing code patterns.
- **Testing:** No test framework (Jest/Vitest) is currently configured.
  - *Instruction:* If asked to add tests, propose installing **Vitest** as it integrates well with Vite.

## Code Style & Conventions

### Formatting
- **Indentation:** The codebase currently has mixed indentation (2 spaces in `App.tsx`, 4 spaces in `Chat.tsx` and `Terminal.tsx`).
  - **Rule:** Detect the indentation of the file you are editing and match it. For new files, prefer **4 spaces**.
- **Quotes:** Double quotes `"` are preferred for JSX attributes and imports.
- **Semicolons:** Always use semicolons at the end of statements.

### Naming
- **Components:** PascalCase (e.g., `Chat.tsx`, `SettingsModal.tsx`).
- **Hooks:** camelCase, prefixed with `use` (e.g., `useUIStore`).
- **Functions/Variables:** camelCase.
- **Types/Interfaces:** PascalCase.

### TypeScript
- **Strict Mode:** Enabled. Avoid `any`. Define interfaces/types for props and state.
- **Stores:** Types for Zustand stores should be defined in the store file (e.g., `interface UIState`).

### Imports
- **Order:**
  1. React / External libraries (`react`, `@tauri-apps/api`).
  2. Internal Stores (`../stores/ui`).
  3. Components (`./components/...`).
  4. Icons / Utils (`lucide-react`, `clsx`).
  5. Styles (`./App.css`).

### State Management
- **Library:** [Zustand](https://github.com/pmndrs/zustand).
- **Location:** `src/stores/`.
- **Pattern:** Create separate stores for distinct domains (e.g., `ui.ts` for UI state, `provider.ts` for API configuration).

### Styling
- **Framework:** Tailwind CSS.
- **Utilities:** Use `clsx` and `tailwind-merge` for conditional classes.
- **Theming:** Use CSS variables defined in `index.css` or `App.css` (e.g., `var(--bg-base)`, `var(--accent)`). Do not hardcode hex colors if a theme variable exists.

### Tauri Integration
- **Commands:** Use `invoke<T>("command_name", { args })` from `@tauri-apps/api/core`.
- **Events:** Use `listen<T>("event_name", callback)` from `@tauri-apps/api/event`.
- **Error Handling:** Wrap `invoke` calls in `try/catch` blocks or use `.catch(console.error)`.

## Architecture Note
- **Agent-First UI:** The `Chat` component is the central focal point.
- **Backend:** Located in `src-tauri`. Rust code handles system operations (terminal spawning, file I/O).
- **Frontend:** Located in `src`. React + TypeScript.

## Rules for Agents
1. **Analyze First:** Always read `AGENTS.md` and related files before making changes.
   - **CRITICAL:** Check `.opencode/` folder for `rules.md` (Architecture/Philosophy) and `PLAN.md` (Roadmap). These contain the source of truth for project direction.
2. **Match Style:** Adhere strictly to the project's formatting and naming conventions.
3. **Safety:** Do not modify `src-tauri` (Rust) unless explicitly instructed and you have the capability to verify Rust builds. Focus on `src` (TypeScript/React).
4. **No Placeholders:** Write complete, working code. If a complex logic is needed, implement it fully or ask for clarification.

## Core Philosophy (from .opencode/rules.md)
- **Agent-First:** Anvil is an agent runtime with a UI, not an IDE with a chat plugin.
- **Local-First:** All logic, storage, and execution happen locally.
- **Security-First:** No silent execution.
- **Hexagonal Architecture:** Maintain explicit boundaries between Core Domain, Adapters, and UI.
