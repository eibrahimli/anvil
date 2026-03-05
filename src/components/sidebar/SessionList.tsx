import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useStore } from "../../store";
import { useProviderStore } from "../../stores/provider";
import { useUIStore, AgentMode } from "../../stores/ui";
import { Plus, Clock, MessageSquare, Trash2, AlertTriangle, Pencil, FileText, Code, FileUp, Share2, Copy, StopCircle } from "lucide-react";
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

interface SessionExportPayload {
  session_id: string;
  basename: string;
  markdown: string;
  json: string;
}

interface LocalSessionSharePayload {
  shareId: string;
  url: string;
  expiresAt: number;
  oneTime: boolean;
  format: string;
}

export function SessionList({ showHeader = true }: { showHeader?: boolean }) {
  const { workspacePath, sessionId, setSessionId, setMessages, setWorkspacePath, closeSessionTab, setSessionMetaMap, setSessionConfig } = useStore();
  const { activeProviderId, activeModelId, apiKeys, modelRegistry, openaiAuthMethod, setOpenAIAuthMethod } = useProviderStore();
  const { setSettingsOpen, activeMode } = useUIStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportingSessionId, setExportingSessionId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const providerForModel = (modelId: string) => {
    const registryMatch = modelRegistry.find((model) => model.id === modelId);
    if (registryMatch?.providerId) return registryMatch.providerId;
    if (modelId.startsWith("gemini")) return "gemini";
    if (modelId.startsWith("claude")) return "anthropic";
    if (modelId.startsWith("gpt") || modelId.startsWith("o1") || modelId.startsWith("o3")) return "openai";
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

  const normalizeMode = (value: unknown): AgentMode => {
    const mode = typeof value === "string" ? value.toLowerCase() : "build";
    if (mode === "plan" || mode === "research" || mode === "build") {
      return mode;
    }
    return "build";
  };

  const resolveProviderAuth = async (providerId: string) => {
    const apiKey = apiKeys[providerId] || "";
    if (providerId === "openai" && (openaiAuthMethod === "oauth" || !apiKey)) {
      try {
        const oauthToken = await invoke<string>("oauth_get_access_token", { providerId: "chatgpt" });
        if (oauthToken) {
          if (openaiAuthMethod !== "oauth") {
            setOpenAIAuthMethod("oauth");
          }
          return oauthToken;
        }
      } catch (error) {
        if (openaiAuthMethod === "oauth") {
          throw error;
        }
      }
    }
    return apiKey;
  };
  const [exportDialog, setExportDialog] = useState<{ open: boolean; sessionId: string | null; format: "markdown" | "json" | null }>({
    open: false,
    sessionId: null,
    format: null
  });
  const [redactWorkspacePath, setRedactWorkspacePath] = useState(true);
  const [redactAttachments, setRedactAttachments] = useState(true);
  const [redactToolArguments, setRedactToolArguments] = useState(false);
  const [shareDialog, setShareDialog] = useState<{ open: boolean; sessionId: string | null }>({ open: false, sessionId: null });
  const [shareAllowLan, setShareAllowLan] = useState(false);
  const [shareRedactWorkspacePath, setShareRedactWorkspacePath] = useState(true);
  const [shareRedactAttachments, setShareRedactAttachments] = useState(true);
  const [shareRedactToolArguments, setShareRedactToolArguments] = useState(true);
  const [sharingSessionId, setSharingSessionId] = useState<string | null>(null);
  const [activeShare, setActiveShare] = useState<LocalSessionSharePayload | null>(null);
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
        const metaMap = workspaceSessions.reduce((acc, session) => {
          acc[session.id] = {
            name: session.name,
            model: session.model,
            mode: session.mode,
            lastActiveAt: session.last_active_at || session.created_at
          };
          return acc;
        }, {} as Record<string, { name?: string | null; model?: string; mode?: string; lastActiveAt?: string }>);
        setSessionMetaMap(metaMap);
      } else {
        console.error("list_sessions returned non-array:", allSessions);
        setSessions([]);
        setSessionMetaMap({});
      }
    } catch (e) {
      console.error("Failed to list sessions:", e);
      setSessions([]);
      setSessionMetaMap({});
    }
  };

  useEffect(() => {
    if (workspacePath) {
      loadSessions();
      const interval = setInterval(loadSessions, 5000);
      return () => clearInterval(interval);
    }
  }, [workspacePath, sessionId]);

  useEffect(() => {
    return () => {
      if (activeShare?.shareId) {
        invoke("stop_local_session_share", { shareId: activeShare.shareId }).catch(() => undefined);
      }
    };
  }, [activeShare?.shareId]);

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
    let key = "";
    if (!activeModelId) {
      setSettingsOpen(true);
      return;
    }
    try {
      key = await resolveProviderAuth(activeProviderId);
    } catch (error) {
      console.error("Failed to resolve provider auth:", error);
    }
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
      setSessionConfig(sid, {
        mode: activeMode,
        modelId: activeModelId,
        providerId: activeProviderId
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

      const modelId = typeof sessionData.model === "string"
        ? sessionData.model
        : (Array.isArray(sessionData.model) ? sessionData.model[0] : undefined);
      if (modelId) {
        setSessionConfig(sid, {
          mode: normalizeMode(sessionData.mode),
          modelId,
          providerId: providerForModel(modelId)
        });
      }
      setSessionId(sid);
      setMessages(sessionData.messages || []);
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
      await invoke("stop_stream", { sessionId: sid });
      await invoke("delete_session", { sessionId: sid });
      
      // If deleting the current active session, clear it
      closeSessionTab(sid);
      
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

  const openExportDialog = (sid: string, format: "markdown" | "json", event: React.MouseEvent) => {
    event.stopPropagation();
    setRedactWorkspacePath(true);
    setRedactAttachments(true);
    setRedactToolArguments(false);
    setExportDialog({ open: true, sessionId: sid, format });
  };

  const handleExportCancel = () => {
    setExportDialog({ open: false, sessionId: null, format: null });
  };

  const handleExportConfirm = async () => {
    if (!exportDialog.sessionId || !exportDialog.format) return;
    try {
      const sid = exportDialog.sessionId;
      const format = exportDialog.format;
      setExportingSessionId(sid);
      const payload = await invoke<SessionExportPayload>("export_session", {
        sessionId: sid,
        redactions: {
          workspacePath: redactWorkspacePath,
          attachments: redactAttachments,
          toolArguments: redactToolArguments
        }
      });
      const extension = format === "markdown" ? "md" : "json";
      const defaultName = payload.basename ? `${payload.basename}.${extension}` : `session-${sid.slice(0, 8)}.${extension}`;
      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: format === "markdown" ? "Markdown" : "JSON", extensions: [extension] }]
      });
      if (!filePath) return;
      const content = format === "markdown" ? payload.markdown : payload.json;
      const finalPath = filePath.endsWith(`.${extension}`) ? filePath : `${filePath}.${extension}`;
      await invoke("write_export_file", { outputPath: finalPath, content });
    } catch (e) {
      console.error("Failed to export session:", e);
    } finally {
      setExportingSessionId(null);
      setExportDialog({ open: false, sessionId: null, format: null });
    }
  };

  const handleImportSession = async () => {
    if (!workspacePath) return;
    try {
      setImporting(true);
      const selected = await open({
        multiple: false,
        filters: [{ name: "Session Export", extensions: ["json"] }]
      });
      if (!selected || typeof selected !== "string") return;
      const content = await invoke<string>("read_file", { path: selected });
      await invoke<string>("import_session", { content, workspacePath });
      loadSessions();
    } catch (e) {
      console.error("Failed to import session:", e);
    } finally {
      setImporting(false);
    }
  };

  const openShareDialog = (sid: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setShareAllowLan(false);
    setShareRedactWorkspacePath(true);
    setShareRedactAttachments(true);
    setShareRedactToolArguments(true);
    setShareDialog({ open: true, sessionId: sid });
  };

  const handleShareCancel = () => {
    setShareDialog({ open: false, sessionId: null });
  };

  const handleStopShare = async () => {
    if (!activeShare) return;
    try {
      await invoke("stop_local_session_share", { shareId: activeShare.shareId });
    } catch (error) {
      console.error("Failed to stop local share:", error);
    } finally {
      setActiveShare(null);
    }
  };

  const handleShareConfirm = async () => {
    if (!shareDialog.sessionId) return;
    try {
      setSharingSessionId(shareDialog.sessionId);
      const payload = await invoke<LocalSessionSharePayload>("start_local_session_share", {
        sessionId: shareDialog.sessionId,
        format: "json",
        allowLan: shareAllowLan,
        ttlSeconds: 900,
        redactions: {
          workspacePath: shareRedactWorkspacePath,
          attachments: shareRedactAttachments,
          toolArguments: shareRedactToolArguments
        }
      });
      setActiveShare(payload);
      try {
        await navigator.clipboard.writeText(payload.url);
      } catch (error) {
        console.warn("Clipboard not available for share URL", error);
      }
    } catch (error) {
      console.error("Failed to start local share:", error);
    } finally {
      setSharingSessionId(null);
      setShareDialog({ open: false, sessionId: null });
    }
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
          <div className="flex items-center gap-1">
            <button 
              onClick={handleImportSession}
              disabled={loading || importing}
              className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors disabled:opacity-40"
              title="Import Session"
            >
              <FileUp size={14} />
            </button>
            <button 
              onClick={handleNewSession}
              disabled={loading}
              className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
              title="New Session"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      )}
      {!showHeader && (
        <div className="px-3 py-2 flex items-center justify-end gap-1">
          <button 
            onClick={handleImportSession}
            disabled={loading || importing}
            className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors disabled:opacity-40"
            title="Import Session"
          >
            <FileUp size={14} />
          </button>
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

      {activeShare && (
        <div className="mx-2 mb-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
              Local Share Active
            </span>
            <span className="text-[10px] text-zinc-400">
              Expires {formatDistanceToNow(new Date(activeShare.expiresAt), { addSuffix: true })}
            </span>
          </div>
          <div className="text-[11px] text-zinc-300 font-mono truncate">
            {activeShare.url}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(activeShare.url);
                } catch (error) {
                  console.error("Failed to copy share URL", error);
                }
              }}
              className="px-2 py-1 rounded-md border border-[var(--border)] text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:text-white hover:bg-zinc-800/60 transition-colors"
            >
              <span className="inline-flex items-center gap-1"><Copy size={11} /> Copy</span>
            </button>
            <button
              onClick={handleStopShare}
              className="px-2 py-1 rounded-md border border-red-500/40 text-[10px] font-bold uppercase tracking-wider text-red-300 hover:text-red-200 hover:bg-red-500/10 transition-colors"
            >
              <span className="inline-flex items-center gap-1"><StopCircle size={11} /> Stop</span>
            </button>
          </div>
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
                        onClick={(e) => openExportDialog(session.id, "markdown", e)}
                        disabled={exportingSessionId === session.id}
                        className="p-1 hover:bg-gray-800 rounded text-gray-500 hover:text-gray-200 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40"
                        title="Export session (Markdown)"
                      >
                        <FileText size={10} />
                      </button>
                      <button
                        onClick={(e) => openExportDialog(session.id, "json", e)}
                        disabled={exportingSessionId === session.id}
                        className="p-1 hover:bg-gray-800 rounded text-gray-500 hover:text-gray-200 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40"
                        title="Export session (JSON)"
                      >
                        <Code size={10} />
                      </button>
                      <button
                        onClick={(e) => openShareDialog(session.id, e)}
                        disabled={sharingSessionId === session.id}
                        className="p-1 hover:bg-gray-800 rounded text-gray-500 hover:text-gray-200 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40"
                        title="Share session (local network)"
                      >
                        <Share2 size={10} />
                      </button>
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
      <ConfirmDialog
        open={shareDialog.open}
        title="Share Session (Local Network)"
        subtitle={shareDialog.sessionId ? `Session ${shareDialog.sessionId.slice(0, 8)}` : undefined}
        confirmLabel={sharingSessionId ? "Starting..." : "Start Share"}
        cancelLabel="Cancel"
        confirmTone="primary"
        onCancel={handleShareCancel}
        onConfirm={handleShareConfirm}
        body={(
          <div className="space-y-3 text-xs text-zinc-400">
            <p className="text-[11px] text-zinc-500">
              Creates a one-time local share link (JSON export) that expires automatically.
            </p>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--accent)]"
                checked={shareAllowLan}
                onChange={(e) => setShareAllowLan(e.target.checked)}
              />
              <span className="text-zinc-300">
                Allow LAN access (bind `0.0.0.0`)
                <span className="block text-[10px] text-zinc-500">Turn this on only if another device must download it.</span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--accent)]"
                checked={shareRedactWorkspacePath}
                onChange={(e) => setShareRedactWorkspacePath(e.target.checked)}
              />
              <span className="text-zinc-300">
                Redact workspace path
                <span className="block text-[10px] text-zinc-500">Replaces workspace path with &lt;redacted&gt;.</span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--accent)]"
                checked={shareRedactAttachments}
                onChange={(e) => setShareRedactAttachments(e.target.checked)}
              />
              <span className="text-zinc-300">
                Strip attachment data
                <span className="block text-[10px] text-zinc-500">Keeps filenames and mime types only.</span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--accent)]"
                checked={shareRedactToolArguments}
                onChange={(e) => setShareRedactToolArguments(e.target.checked)}
              />
              <span className="text-zinc-300">
                Redact tool call arguments
                <span className="block text-[10px] text-zinc-500">Replaces arguments with &lt;redacted&gt;.</span>
              </span>
            </label>
          </div>
        )}
      />
      <ConfirmDialog
        open={exportDialog.open}
        title={exportDialog.format === "json" ? "Export Session (JSON)" : "Export Session (Markdown)"}
        subtitle={exportDialog.sessionId ? `Session ${exportDialog.sessionId.slice(0, 8)}` : undefined}
        confirmLabel="Export"
        cancelLabel="Cancel"
        confirmTone="primary"
        onCancel={handleExportCancel}
        onConfirm={handleExportConfirm}
        body={(
          <div className="space-y-3 text-xs text-zinc-400">
            <p className="text-[11px] text-zinc-500">Choose what to redact before exporting.</p>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--accent)]"
                checked={redactWorkspacePath}
                onChange={(e) => setRedactWorkspacePath(e.target.checked)}
              />
              <span className="text-zinc-300">
                Redact workspace path
                <span className="block text-[10px] text-zinc-500">Replaces workspace path with &lt;redacted&gt;.</span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--accent)]"
                checked={redactAttachments}
                onChange={(e) => setRedactAttachments(e.target.checked)}
              />
              <span className="text-zinc-300">
                Strip attachment data
                <span className="block text-[10px] text-zinc-500">Keeps filenames and mime types only.</span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--accent)]"
                checked={redactToolArguments}
                onChange={(e) => setRedactToolArguments(e.target.checked)}
              />
              <span className="text-zinc-300">
                Redact tool call arguments
                <span className="block text-[10px] text-zinc-500">Replaces arguments with &lt;redacted&gt;.</span>
              </span>
            </label>
          </div>
        )}
      />
    </div>
  );
}
