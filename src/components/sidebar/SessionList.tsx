import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../../store";
import { useProviderStore } from "../../stores/provider";
import { useUIStore } from "../../stores/ui";
import { Plus, Clock, MessageSquare, Trash2, AlertTriangle, Pencil } from "lucide-react";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { TextInputDialog } from "../common/TextInputDialog";

interface Session {
  id: string;
  workspace_path: string;
  model: string;
  mode: string;
  created_at: string;
  last_active_at?: string;
  name?: string | null;
  message_count: number;
}

export function SessionList({ showHeader = true }: { showHeader?: boolean }) {
  const { workspacePath, sessionId, setSessionId, setMessages, setWorkspacePath } = useStore();
  const { activeProviderId, activeModelId, apiKeys } = useProviderStore();
  const { setSettingsOpen } = useUIStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; sessionId: string | null }>({ show: false, sessionId: null });
  const [renamePrompt, setRenamePrompt] = useState<{ show: boolean; sessionId: string | null; name: string | null }>({ show: false, sessionId: null, name: null });

  const loadSessions = async () => {
    if (!workspacePath) return;
    try {
      const allSessions = await invoke<Session[]>("list_sessions");
      if (Array.isArray(allSessions)) {
        // Filter sessions for current workspace
        // Normalize paths for comparison (remove trailing slash)
        const currentPath = workspacePath.replace(/\/$/, "");
        
        const workspaceSessions = allSessions
          .filter(s => s.workspace_path.replace(/\/$/, "") === currentPath)
          .sort((a, b) => {
            const timeA = new Date(a.last_active_at || a.created_at).getTime() || 0;
            const timeB = new Date(b.last_active_at || b.created_at).getTime() || 0;
            return timeB - timeA;
          })
          .slice(0, 5); // Show top 5 recent
        setSessions(workspaceSessions);
      } else {
        console.error("list_sessions returned non-array:", allSessions);
        setSessions([]);
      }
    } catch (e) {
      console.error("Failed to list sessions:", e);
      setSessions([]);
    }
  };

  useEffect(() => {
    if (workspacePath) {
      loadSessions();
      const interval = setInterval(loadSessions, 5000);
      return () => clearInterval(interval);
    }
  }, [workspacePath, sessionId]);

  const handleNewSession = async () => {
    let nextWorkspace = workspacePath;
    if (!nextWorkspace) {
      try {
        nextWorkspace = await invoke<string>("get_cwd");
        setWorkspacePath(nextWorkspace);
      } catch (e) {
        console.error("No workspace selected:", e);
        return;
      }
    }
    
    // Check API key
    const key = apiKeys[activeProviderId];
    if (!key && activeProviderId !== 'ollama') {
      setSettingsOpen(true);
      return;
    }

    try {
      setLoading(true);
      const sid = await invoke<string>("create_session", {
        workspacePath: nextWorkspace,
        apiKey: key || '',
        provider: activeProviderId,
        modelId: activeModelId
      });
      setSessionId(sid);
      setMessages([]); // Clear frontend messages
      loadSessions();
    } catch (e) {
      console.error("Failed to create session:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleResumeSession = async (sid: string) => {
    try {
      setLoading(true);
      // Re-initialize agent on backend
      await invoke<string>("replay_session", { sessionId: sid });
      
      // Load session data (including messages)
      const sessionData = await invoke<any>("load_session", { sessionId: sid });
      
      setMessages(sessionData.messages || []);
      setSessionId(sid);
    } catch (e) {
      console.error("Failed to resume session:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (sid: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the resume session
    setDeleteConfirm({ show: true, sessionId: sid });
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm.sessionId) return;
    
    const sid = deleteConfirm.sessionId;
    setDeleteConfirm({ show: false, sessionId: null });

    try {
      await invoke("delete_session", { sessionId: sid });
      
      // If deleting the current active session, clear it
      if (sessionId === sid) {
        setSessionId(null);
        setMessages([]);
      }
      
      // Refresh the list
      loadSessions();
    } catch (e) {
      console.error("Failed to delete session:", e);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirm({ show: false, sessionId: null });
  };

  const handleRenameClick = (sid: string, name: string | null, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamePrompt({ show: true, sessionId: sid, name: name || "" });
  };

  const handleRenameConfirm = async (value: string) => {
    if (!renamePrompt.sessionId) return;
    try {
      const trimmed = value.trim();
      await invoke("rename_session", { sessionId: renamePrompt.sessionId, name: trimmed.length ? trimmed : null });
      setRenamePrompt({ show: false, sessionId: null, name: null });
      loadSessions();
    } catch (e) {
      console.error("Failed to rename session:", e);
    }
  };

  const handleRenameCancel = () => {
    setRenamePrompt({ show: false, sessionId: null, name: null });
  };

  if (!workspacePath) return null;

  return (
    <div className="mb-4">
      {showHeader && (
        <div className="px-3 py-2 flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
            <Clock size={12} />
            Recent Sessions
          </h3>
          <button 
            onClick={handleNewSession}
            disabled={loading}
            className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
            title="New Session"
          >
            <Plus size={14} />
          </button>
        </div>
      )}

      <div className="space-y-0.5 px-2">
        {sessions.length === 0 ? (
          <div className="text-xs text-gray-600 px-2 py-1 italic">No sessions yet</div>
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => handleResumeSession(session.id)}
              className={clsx(
                "w-full text-left px-2 py-1.5 rounded text-xs flex flex-col gap-0.5 transition-colors group",
                sessionId === session.id 
                  ? "bg-blue-900/30 text-blue-200 border border-blue-800/50" 
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              )}
            >
              <div className="flex items-center justify-between w-full">
                    <span className="font-medium truncate flex-1">
                      {session.name?.trim() ? session.name : (() => {
                        try {
                          const timeValue = session.last_active_at || session.created_at;
                          return formatDistanceToNow(new Date(timeValue), { addSuffix: true });
                        } catch (e) {
                          return "Unknown time";
                        }
                      })()}
                    </span>
                    <div className="flex items-center gap-1">
                      {sessionId === session.id && (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                      )}
                      <button
                        onClick={(e) => handleRenameClick(session.id, session.name ?? null, e)}
                        className="p-1 hover:bg-gray-800 rounded text-gray-500 hover:text-gray-200 transition-colors opacity-0 group-hover:opacity-100"
                        title="Rename session"
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteClick(session.id, e)}
                        className="p-1 hover:bg-red-900/30 rounded text-gray-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete session"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-60 text-[10px]">
                    <span className="truncate max-w-[120px]">
                      {(() => {
                        try {
                          const timeValue = session.last_active_at || session.created_at;
                          return formatDistanceToNow(new Date(timeValue), { addSuffix: true });
                        } catch (e) {
                          return "Unknown time";
                        }
                      })()}
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-0.5">
                      <MessageSquare size={8} />
                      {session.message_count}
                    </span>
                    <span>•</span>
                    <span className="truncate max-w-[80px]">{session.model}</span>
                  </div>
            </button>
          ))
        )}
      </div>

      <ConfirmDialog
        open={deleteConfirm.show}
        title="Delete Session"
        subtitle="This action cannot be undone"
        description="Are you sure you want to delete this session? All messages and context will be permanently removed."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmTone="danger"
        icon={<AlertTriangle size={20} />}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />
      <TextInputDialog
        open={renamePrompt.show}
        title="Rename Session"
        subtitle="Set a custom session name"
        initialValue={renamePrompt.name || ""}
        placeholder="Session name"
        confirmLabel="Save"
        cancelLabel="Cancel"
        allowEmpty={true}
        onCancel={handleRenameCancel}
        onConfirm={handleRenameConfirm}
      />
    </div>
  );
}
