import { CodeEditor } from "./components/Editor";
import { TabList } from "./components/TabList";
import { Chat } from "./components/Chat";
import { AppShell } from "./components/layout/AppShell";
import { SidePanel } from "./components/layout/SidePanel";
import { SettingsModal } from "./components/settings/SettingsModal";
import { ConfirmationModal } from "./components/ConfirmationModal";
import { Terminal } from "./components/Terminal";
import { useUIStore } from "./stores/ui";
import { useStore } from "./store";
import { useConfirmationStore } from "./stores/confirmation";
import { useSettingsStore } from "./stores/settings";
import { useAgentEvents } from "./hooks/useAgentEvents";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import "./App.css";

function App() {
  const { isTerminalOpen, isEditorOpen } = useUIStore();
  const { setWorkspacePath } = useStore();
  const { setPendingRequest } = useConfirmationStore();
  const { setDiffMode: _setDiffMode } = useSettingsStore();

  useAgentEvents(); // Hook to listen for backend events

  useEffect(() => {
    // Restore last session if available
    const restoreSession = async () => {
      const state = useStore.getState();
      const { sessionId, workspacePath } = state;

      if (sessionId && workspacePath) {
        // Try to restore the session
        try {
          // Check if session still exists in backend
          const session = await invoke<any>("load_session", { sessionId });
          if (session) {
            console.log(`Restored session ${sessionId} for workspace ${workspacePath}`);
            // Session exists in SQLite but we need to recreate the backend agent
            // The Chat component will handle this when user sends first message
            return;
          }
        } catch (e) {
          console.log("Previous session not found in database, clearing session ID");
          // Clear the invalid session ID
          state.setSessionId(null);
        }
      }

      // If no persisted workspace, default to CWD
      if (!workspacePath) {
        try {
          const cwd = await invoke<string>("get_cwd");
          setWorkspacePath(cwd);
        } catch (e) {
          console.error("Failed to get CWD:", e);
        }
      }
    };

    restoreSession();
  }, [setWorkspacePath]);

  useEffect(() => {
    // Listen for confirmation requests (for tools like write_file, bash)
    const unlistenConfirm = listen<any>("request-confirmation", (event) => {
      setPendingRequest(event.payload);
    });

    return () => {
      unlistenConfirm.then(f => f());
    };
  }, []);

  return (
    <AppShell>
      <SettingsModal />
      <ConfirmationModal />
      <SidePanel />
      {/* Main Content Area: CHAT IS CENTER (Agent-First) */}
      <div className="flex-1 flex overflow-hidden">

        <div className="flex-1 flex flex-col min-w-0 relative bg-transparent">
          {/* The primary focal point: The Chat/Agent Console */}
          <Chat />

          {/* Bottom Terminal Pane */}
          <div className={clsx(
            "h-64 border-t border-[var(--border)] bg-[#09090B] p-0 overflow-hidden shrink-0 transition-all duration-300",
            isTerminalOpen ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 h-0"
          )}>
            <Terminal />
          </div>
        </div>

        {/* Secondary Focal Point: The Editor (On the right, toggleable) */}
        {isEditorOpen && (
          <div className="w-[550px] flex-shrink-0 border-l border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl z-20 flex flex-col">
            <div className="h-10 border-b border-[var(--border)] bg-[var(--bg-base)]/50 flex items-center px-4 justify-between shrink-0">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Observation Window</span>
            </div>
            <TabList />
            <div className="flex-1 overflow-hidden">
              <CodeEditor />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default App;
