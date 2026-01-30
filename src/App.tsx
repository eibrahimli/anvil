import { CodeEditor } from "./components/Editor";
import { Chat } from "./components/Chat";
import { AppShell } from "./components/layout/AppShell";
import { SettingsModal } from "./components/settings/SettingsModal";
import { ConfirmationModal } from "./components/ConfirmationModal";
import { Terminal } from "./components/Terminal";
import { useUIStore } from "./stores/ui";
import { useStore } from "./store";
import { useConfirmationStore } from "./stores/confirmation";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import "./App.css";

function App() {
  const { isTerminalOpen, isEditorOpen } = useUIStore();
  const { workspacePath, setWorkspacePath } = useStore();
  const { setPendingRequest } = useConfirmationStore();

  useEffect(() => {
    // Default to CWD if no workspace is selected
    if (!workspacePath) {
      invoke<string>("get_cwd")
        .then(setWorkspacePath)
        .catch(console.error);
    }
  }, []);

  useEffect(() => {
    const unlisten = listen<any>("request-confirmation", (event) => {
        setPendingRequest(event.payload);
    });
    return () => {
        unlisten.then(f => f());
    };
  }, []);

  return (
    <AppShell>
       <SettingsModal />
       <ConfirmationModal />
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
            <div className="w-[550px] flex-shrink-0 border-l border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl z-20">
              <div className="h-10 border-b border-[var(--border)] bg-[var(--bg-base)]/50 flex items-center px-4 justify-between">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Observation Window</span>
              </div>
              <CodeEditor />
            </div>
          )}
       </div>
    </AppShell>
  );
}

export default App;
