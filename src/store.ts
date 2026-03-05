import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Message, FileNode, Attachment } from './types';
import type { AgentMode } from './stores/ui';

interface SessionConfig {
    mode: AgentMode;
    modelId: string;
    providerId: string;
}

type DraftAttachment = Attachment & { previewUrl: string };

interface SessionDraft {
    input: string;
    attachments: DraftAttachment[];
    cursorPosition: number;
}

const revokeDraftAttachments = (draft?: SessionDraft) => {
    if (!draft) return;
    draft.attachments.forEach((attachment) => {
        if (attachment.previewUrl) {
            URL.revokeObjectURL(attachment.previewUrl);
        }
    });
};

interface AppState {
    sessionId: string | null;
    openSessions: string[];
    sessionCache: Record<string, Message[]>;
    sessionMeta: Record<string, { name?: string | null; model?: string; mode?: string; lastActiveAt?: string }>;
    sessionStatus: Record<string, "idle" | "running" | "waiting" | "error">;
    sessionConfig: Record<string, SessionConfig>;
    sessionDrafts: Record<string, SessionDraft>;
    workspacePath: string;
    apiKey: string;
    provider: string;
    files: FileNode[];
    activeFile: string | null;
    activeFileContent: string;
    openFiles: string[];
    openFileContentMap: Record<string, string>;
    messages: Message[];
    
    setSessionId: (id: string | null) => void;
    closeSessionTab: (id: string) => void;
    setSessionMetaMap: (meta: Record<string, { name?: string | null; model?: string; mode?: string; lastActiveAt?: string }>) => void;
    setSessionStatus: (id: string, status: "idle" | "running" | "waiting" | "error") => void;
    setSessionConfig: (id: string, config: SessionConfig) => void;
    setSessionDraft: (id: string, draft: SessionDraft) => void;
    clearSessionDraft: (id: string) => void;
    addMessageToSession: (sessionId: string, msg: Message) => void;
    appendToolCallToSession: (sessionId: string, call: { id: string; name: string; arguments: string }) => void;
    appendTokenToSession: (sessionId: string, token: string) => void;
    updateLastMessageContentForSession: (sessionId: string, content: string) => void;
    setWorkspacePath: (path: string) => void;
    setApiKey: (key: string) => void;
    setProvider: (provider: string) => void;
    addMessage: (msg: Message) => void;
    appendToolCallToLastAssistant: (call: { id: string; name: string; arguments: string }) => void;
    appendTokenToLastMessage: (token: string) => void;
    updateLastMessageContent: (content: string) => void;
    setActiveFile: (path: string | null) => void;
    setActiveFileContent: (content: string) => void;
    openFileWithContent: (path: string, content: string) => void;
    setFiles: (files: FileNode[]) => void;
    openFile: (path: string) => void;
    closeFile: (path: string) => void;
    clearMessages: () => void;
    setMessages: (messages: Message[]) => void;
}

export const useStore = create<AppState>()(
    persist(
        (set) => ({
            sessionId: null,
            openSessions: [],
            sessionCache: {},
            sessionMeta: {},
            sessionStatus: {},
            sessionConfig: {},
            sessionDrafts: {},
            workspacePath: "",
            apiKey: "",
            provider: "openai",
            files: [],
            activeFile: null,
            activeFileContent: "// Select a file to view",
            openFiles: [],
            openFileContentMap: {},
            messages: [],

            setSessionId: (id) => set((state) => {
                const normalized = id && id.length > 0 ? id : null;
                if (!normalized) {
                    return { sessionId: null, messages: [] };
                }
                const openSessions = state.openSessions.includes(normalized)
                    ? state.openSessions
                    : [...state.openSessions, normalized];
                const messages = state.sessionCache[normalized] ?? [];
                return { sessionId: normalized, openSessions, messages };
            }),
            closeSessionTab: (id) => set((state) => {
                const openSessions = state.openSessions.filter((sid) => sid !== id);
                const sessionCache = { ...state.sessionCache };
                const sessionMeta = { ...state.sessionMeta };
                const sessionStatus = { ...state.sessionStatus };
                const sessionConfig = { ...state.sessionConfig };
                const sessionDrafts = { ...state.sessionDrafts };
                delete sessionCache[id];
                delete sessionMeta[id];
                delete sessionStatus[id];
                delete sessionConfig[id];
                revokeDraftAttachments(sessionDrafts[id]);
                delete sessionDrafts[id];
                let sessionId = state.sessionId;
                let messages = state.messages;
                if (state.sessionId === id) {
                    const nextId = openSessions[openSessions.length - 1] ?? null;
                    sessionId = nextId;
                    messages = nextId ? (sessionCache[nextId] ?? []) : [];
                }
                return { openSessions, sessionCache, sessionMeta, sessionStatus, sessionConfig, sessionDrafts, sessionId, messages };
            }),
            setSessionMetaMap: (meta) => set({ sessionMeta: meta }),
            setSessionStatus: (id, status) => set((state) => ({
                sessionStatus: {
                    ...state.sessionStatus,
                    [id]: status
                }
            })),
            setSessionConfig: (id, config) => set((state) => ({
                sessionConfig: {
                    ...state.sessionConfig,
                    [id]: config
                }
            })),
            setSessionDraft: (id, draft) => set((state) => ({
                sessionDrafts: {
                    ...state.sessionDrafts,
                    [id]: draft
                }
            })),
            clearSessionDraft: (id) => set((state) => {
                const sessionDrafts = { ...state.sessionDrafts };
                revokeDraftAttachments(sessionDrafts[id]);
                delete sessionDrafts[id];
                return { sessionDrafts };
            }),
            addMessageToSession: (targetSessionId, msg) => set((state) => {
                const existing = state.sessionCache[targetSessionId] ?? [];
                const messages = [...existing, msg];
                const sessionCache = {
                    ...state.sessionCache,
                    [targetSessionId]: messages
                };
                const openSessions = state.openSessions.includes(targetSessionId)
                    ? state.openSessions
                    : [...state.openSessions, targetSessionId];
                if (state.sessionId === targetSessionId) {
                    return { sessionCache, messages, openSessions };
                }
                return { sessionCache, openSessions };
            }),
            appendToolCallToSession: (targetSessionId, call) => set((state) => {
                const msgs = [...(state.sessionCache[targetSessionId] ?? [])];
                let targetIndex = -1;
                for (let i = msgs.length - 1; i >= 0; i -= 1) {
                    if (msgs[i].role === "Assistant") {
                        targetIndex = i;
                        break;
                    }
                }
                if (targetIndex === -1) {
                    msgs.push({ role: "Assistant", content: "", tool_calls: [call] });
                } else {
                    const target = { ...msgs[targetIndex] };
                    const existingCalls = Array.isArray(target.tool_calls) ? [...target.tool_calls] : [];
                    const hasCall = existingCalls.some((existing) => existing.id === call.id);
                    if (!hasCall) {
                        existingCalls.push(call);
                        target.tool_calls = existingCalls;
                        msgs[targetIndex] = target;
                    }
                }
                const sessionCache = {
                    ...state.sessionCache,
                    [targetSessionId]: msgs
                };
                const openSessions = state.openSessions.includes(targetSessionId)
                    ? state.openSessions
                    : [...state.openSessions, targetSessionId];
                if (state.sessionId === targetSessionId) {
                    return { sessionCache, messages: msgs, openSessions };
                }
                return { sessionCache, openSessions };
            }),
            appendTokenToSession: (targetSessionId, token) => set((state) => {
                const msgs = [...(state.sessionCache[targetSessionId] ?? [])];
                if (msgs.length > 0) {
                    const lastIdx = msgs.length - 1;
                    const last = { ...msgs[lastIdx] };
                    last.content = (last.content || "") + token;
                    msgs[lastIdx] = last;
                }
                const sessionCache = {
                    ...state.sessionCache,
                    [targetSessionId]: msgs
                };
                const openSessions = state.openSessions.includes(targetSessionId)
                    ? state.openSessions
                    : [...state.openSessions, targetSessionId];
                if (state.sessionId === targetSessionId) {
                    return { sessionCache, messages: msgs, openSessions };
                }
                return { sessionCache, openSessions };
            }),
            updateLastMessageContentForSession: (targetSessionId, content) => set((state) => {
                const msgs = [...(state.sessionCache[targetSessionId] ?? [])];
                if (msgs.length > 0) {
                    const lastIdx = msgs.length - 1;
                    const last = { ...msgs[lastIdx] };
                    last.content = content;
                    msgs[lastIdx] = last;
                }
                const sessionCache = {
                    ...state.sessionCache,
                    [targetSessionId]: msgs
                };
                const openSessions = state.openSessions.includes(targetSessionId)
                    ? state.openSessions
                    : [...state.openSessions, targetSessionId];
                if (state.sessionId === targetSessionId) {
                    return { sessionCache, messages: msgs, openSessions };
                }
                return { sessionCache, openSessions };
            }),
            setWorkspacePath: (path) => set((state) => {
                if (state.workspacePath === path) {
                    return { workspacePath: path };
                }
                Object.values(state.sessionDrafts).forEach(revokeDraftAttachments);
                return {
                    workspacePath: path,
                    sessionId: null,
                    openSessions: [],
                    sessionCache: {},
                    sessionMeta: {},
                    sessionStatus: {},
                    sessionConfig: {},
                    sessionDrafts: {},
                    messages: [],
                    files: [],
                    activeFile: null,
                    activeFileContent: "// Select a file to view",
                    openFiles: [],
                    openFileContentMap: {}
                };
            }),
            setApiKey: (key) => set({ apiKey: key }),
            setProvider: (provider) => set({ provider }),
            addMessage: (msg) => set((state) => {
                const messages = [...state.messages, msg];
                const sessionCache = state.sessionId
                    ? { ...state.sessionCache, [state.sessionId]: messages }
                    : state.sessionCache;
                return { messages, sessionCache };
            }),
            appendToolCallToLastAssistant: (call) => set((state) => {
                const msgs = [...state.messages];
                let targetIndex = -1;
                for (let i = msgs.length - 1; i >= 0; i -= 1) {
                    if (msgs[i].role === "Assistant") {
                        targetIndex = i;
                        break;
                    }
                }
                if (targetIndex === -1) {
                    msgs.push({ role: "Assistant", content: "", tool_calls: [call] });
                } else {
                    const target = { ...msgs[targetIndex] };
                    const existingCalls = Array.isArray(target.tool_calls) ? [...target.tool_calls] : [];
                    const hasCall = existingCalls.some((existing) => existing.id === call.id);
                    if (!hasCall) {
                        existingCalls.push(call);
                        target.tool_calls = existingCalls;
                        msgs[targetIndex] = target;
                    }
                }
                const sessionCache = state.sessionId
                    ? { ...state.sessionCache, [state.sessionId]: msgs }
                    : state.sessionCache;
                return { messages: msgs, sessionCache };
            }),
            setMessages: (messages) => set((state) => {
                const sessionCache = state.sessionId
                    ? { ...state.sessionCache, [state.sessionId]: messages }
                    : state.sessionCache;
                return { messages, sessionCache };
            }),
            appendTokenToLastMessage: (token) => set((state) => {
                const msgs = [...state.messages];
                if (msgs.length > 0) {
                    const lastIdx = msgs.length - 1;
                    const last = { ...msgs[lastIdx] };
                    last.content = (last.content || "") + token;
                    msgs[lastIdx] = last;
                }
                const sessionCache = state.sessionId
                    ? { ...state.sessionCache, [state.sessionId]: msgs }
                    : state.sessionCache;
                return { messages: msgs, sessionCache };
            }),
            updateLastMessageContent: (content) => set((state) => {
                const msgs = [...state.messages];
                if (msgs.length > 0) {
                    const lastIdx = msgs.length - 1;
                    const last = { ...msgs[lastIdx] };
                    last.content = content;
                    msgs[lastIdx] = last;
                }
                const sessionCache = state.sessionId
                    ? { ...state.sessionCache, [state.sessionId]: msgs }
                    : state.sessionCache;
                return { messages: msgs, sessionCache };
            }),
            setActiveFile: (path) => set((state) => {
                if (!path) {
                    return {
                        activeFile: null,
                        activeFileContent: "// Select a file to view",
                    };
                }
                return {
                    activeFile: path,
                    activeFileContent: state.openFileContentMap[path] ?? state.activeFileContent,
                };
            }),
            setActiveFileContent: (content) => set((state) => {
                if (!state.activeFile) {
                    return { activeFileContent: content };
                }
                return {
                    activeFileContent: content,
                    openFileContentMap: {
                        ...state.openFileContentMap,
                        [state.activeFile]: content
                    }
                };
            }),
            openFileWithContent: (path, content) => set((state) => ({
                openFiles: state.openFiles.includes(path) ? state.openFiles : [...state.openFiles, path],
                activeFile: path,
                activeFileContent: content,
                openFileContentMap: {
                    ...state.openFileContentMap,
                    [path]: content
                }
            })),
            setFiles: (files) => set({ files }),
            openFile: (path) => set((state) => ({
                openFiles: state.openFiles.includes(path) ? state.openFiles : [...state.openFiles, path],
                activeFile: path,
                activeFileContent: state.openFileContentMap[path] ?? state.activeFileContent
            })),
            closeFile: (path) => set((state) => {
                const newOpenFiles = state.openFiles.filter(f => f !== path);
                const newContentMap = { ...state.openFileContentMap };
                delete newContentMap[path];
                let newActiveFile = state.activeFile;
                let newActiveFileContent = state.activeFileContent;
                if (state.activeFile === path) {
                    newActiveFile = newOpenFiles.length > 0 ? newOpenFiles[newOpenFiles.length - 1] : null;
                    newActiveFileContent = newActiveFile
                        ? (newContentMap[newActiveFile] ?? "// Select a file to view")
                        : "// Select a file to view";
                }
                return { 
                    openFiles: newOpenFiles,
                    activeFile: newActiveFile,
                    activeFileContent: newActiveFileContent,
                    openFileContentMap: newContentMap
                };
            }),
            clearMessages: () => set((state) => {
                const sessionCache = state.sessionId
                    ? { ...state.sessionCache, [state.sessionId]: [] }
                    : state.sessionCache;
                return { messages: [], sessionCache };
            }),
        }),
        {
            name: 'anvil-store',
            partialize: (state) => ({ 
                workspacePath: state.workspacePath,
                sessionId: state.sessionId,
                provider: state.provider,
                apiKey: state.apiKey,
            }),
        }
    )
);
