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
import { useProviderStore } from "./stores/provider";
import { useAgentEvents } from "./hooks/useAgentEvents";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import "./App.css";

function App() {
  const { isTerminalOpen, isEditorOpen, terminalHeight, setTerminalHeight, editorWidth, setEditorWidth } = useUIStore();
  const { setWorkspacePath, setMessages, setSessionId } = useStore();
  const { apiKeys } = useProviderStore();
  const { setPendingRequest } = useConfirmationStore();
  const { setDiffMode: _setDiffMode } = useSettingsStore();
  const terminalDragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const terminalRafRef = useRef<number | null>(null);
  const terminalPendingHeightRef = useRef<number | null>(null);
  const [isResizingTerminal, setIsResizingTerminal] = useState(false);
  const editorDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const editorRafRef = useRef<number | null>(null);
  const editorPendingWidthRef = useRef<number | null>(null);
  const [isResizingEditor, setIsResizingEditor] = useState(false);

  const clampTerminalHeight = useCallback((height: number) => {
    const minHeight = 160;
    const maxHeight = Math.max(220, Math.floor(window.innerHeight * 0.45));
    return Math.min(maxHeight, Math.max(minHeight, height));
  }, []);

  const clampEditorWidth = useCallback((width: number) => {
    const minWidth = 320;
    const maxWidth = Math.max(420, Math.floor(window.innerWidth * 0.55));
    return Math.min(maxWidth, Math.max(minWidth, width));
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (!terminalDragRef.current) return;
    const delta = terminalDragRef.current.startY - event.clientY;
    const nextHeight = clampTerminalHeight(terminalDragRef.current.startHeight + delta);
    terminalPendingHeightRef.current = nextHeight;
    if (terminalRafRef.current === null) {
      terminalRafRef.current = window.requestAnimationFrame(() => {
        if (terminalPendingHeightRef.current !== null) {
          setTerminalHeight(terminalPendingHeightRef.current);
        }
        terminalRafRef.current = null;
      });
    }
  }, [clampTerminalHeight, setTerminalHeight]);

  const handlePointerUp = useCallback(() => {
    terminalDragRef.current = null;
    setIsResizingTerminal(false);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    if (terminalRafRef.current !== null) {
      window.cancelAnimationFrame(terminalRafRef.current);
      terminalRafRef.current = null;
    }
  }, [handlePointerMove]);

  const handleEditorPointerMove = useCallback((event: PointerEvent) => {
    if (!editorDragRef.current) return;
    const delta = editorDragRef.current.startX - event.clientX;
    const nextWidth = clampEditorWidth(editorDragRef.current.startWidth + delta);
    editorPendingWidthRef.current = nextWidth;
    if (editorRafRef.current === null) {
      editorRafRef.current = window.requestAnimationFrame(() => {
        if (editorPendingWidthRef.current !== null) {
          setEditorWidth(editorPendingWidthRef.current);
        }
        editorRafRef.current = null;
      });
    }
  }, [clampEditorWidth, setEditorWidth]);

  const handleEditorPointerUp = useCallback(() => {
    editorDragRef.current = null;
    setIsResizingEditor(false);
    window.removeEventListener("pointermove", handleEditorPointerMove);
    window.removeEventListener("pointerup", handleEditorPointerUp);
    if (editorRafRef.current !== null) {
      window.cancelAnimationFrame(editorRafRef.current);
      editorRafRef.current = null;
    }
  }, [handleEditorPointerMove]);

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    if (!isTerminalOpen) return;
    event.preventDefault();
    terminalDragRef.current = { startY: event.clientY, startHeight: terminalHeight };
    setIsResizingTerminal(true);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [handlePointerMove, handlePointerUp, isTerminalOpen, terminalHeight]);

  const handleEditorPointerDown = useCallback((event: React.PointerEvent) => {
    if (!isEditorOpen) return;
    event.preventDefault();
    editorDragRef.current = { startX: event.clientX, startWidth: editorWidth };
    setIsResizingEditor(true);
    window.addEventListener("pointermove", handleEditorPointerMove);
    window.addEventListener("pointerup", handleEditorPointerUp);
  }, [handleEditorPointerMove, handleEditorPointerUp, editorWidth, isEditorOpen]);

  useEffect(() => {
    const onResize = () => {
      setTerminalHeight(clampTerminalHeight(terminalHeight));
      setEditorWidth(clampEditorWidth(editorWidth));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampEditorWidth, clampTerminalHeight, editorWidth, setEditorWidth, setTerminalHeight, terminalHeight]);

  useEffect(() => () => handlePointerUp(), [handlePointerUp]);
  useEffect(() => () => handleEditorPointerUp(), [handleEditorPointerUp]);
  useEffect(() => () => {
    if (terminalRafRef.current !== null) {
      window.cancelAnimationFrame(terminalRafRef.current);
    }
    if (editorRafRef.current !== null) {
      window.cancelAnimationFrame(editorRafRef.current);
    }
  }, []);

  useAgentEvents(); // Hook to listen for backend events

  useEffect(() => {
    // Restore last session if available
    const restoreSession = async () => {
      const state = useStore.getState();
      const { sessionId, workspacePath } = state;

      const providerForModel = (modelId: string) => {
        if (modelId.startsWith("gemini")) return "gemini";
        if (modelId.startsWith("claude")) return "anthropic";
        if (
          modelId.startsWith("llama") ||
          modelId.startsWith("mistral") ||
          modelId.startsWith("codellama") ||
          modelId.startsWith("deepseek")
        ) {
          return "ollama";
        }
        return "openai";
      };

      if (sessionId && workspacePath) {
        // Try to restore the session
        try {
          // Check if session still exists in backend
          const session = await invoke<any>("load_session", { sessionId });
          if (session) {
            console.log(`Restored session ${sessionId} for workspace ${workspacePath}`);
            if (Array.isArray(session.messages)) {
              setMessages(session.messages);
            }

            const modelId = typeof session.model === "string"
              ? session.model
              : (Array.isArray(session.model) ? session.model[0] : undefined);
            if (modelId) {
              const provider = providerForModel(modelId);
              const apiKey = provider === "ollama" ? "" : (apiKeys[provider] || "");
              if (provider === "ollama" || apiKey) {
                await invoke<string>("replay_session", {
                  sessionId,
                  modelId,
                  apiKey
                });
              }
            }
            return;
          }
        } catch (e) {
          console.log("Previous session not found in database, clearing session ID");
          // Clear the invalid session ID
          setSessionId(null);
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
  }, [apiKeys, setMessages, setSessionId, setWorkspacePath]);

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
          {isTerminalOpen && (
            <div
              className="h-2 cursor-row-resize bg-[var(--bg-base)]/80 hover:bg-[var(--bg-elevated)] transition-colors flex items-center justify-center touch-none"
              onPointerDown={handlePointerDown}
              title="Drag to resize terminal"
            >
              <div className="h-1 w-12 rounded-full bg-zinc-700/60" />
            </div>
          )}
          <div className={clsx(
            "border-t border-[var(--border)] bg-[#09090B] p-0 overflow-hidden shrink-0 transition-transform transition-opacity duration-200",
            isTerminalOpen ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 h-0",
            isResizingTerminal && "transition-none"
          )} style={{ height: isTerminalOpen ? terminalHeight : 0 }}>
            <Terminal />
          </div>
        </div>

        {/* Secondary Focal Point: The Editor (On the right, toggleable) */}
        {isEditorOpen && (
          <div
            className={clsx(
              "relative flex-shrink-0 border-l border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl z-20 flex flex-col transition-all duration-200",
              isResizingEditor && "transition-none"
            )}
            style={{ width: editorWidth }}
          >
            <div
              className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-[var(--bg-elevated)]/60"
              onPointerDown={handleEditorPointerDown}
              title="Drag to resize editor"
            />
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
