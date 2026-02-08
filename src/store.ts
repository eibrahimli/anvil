import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Message, FileNode } from './types';

interface AppState {
    sessionId: string | null;
    workspacePath: string;
    apiKey: string;
    provider: string;
    files: FileNode[];
    activeFile: string | null;
    activeFileContent: string;
    openFiles: string[];
    messages: Message[];
    
    setSessionId: (id: string | null) => void;
    setWorkspacePath: (path: string) => void;
    setApiKey: (key: string) => void;
    setProvider: (provider: string) => void;
    addMessage: (msg: Message) => void;
    appendToolCallToLastAssistant: (call: { id: string; name: string; arguments: string }) => void;
    appendTokenToLastMessage: (token: string) => void;
    updateLastMessageContent: (content: string) => void;
    setActiveFile: (path: string | null) => void;
    setActiveFileContent: (content: string) => void;
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
            workspacePath: "",
            apiKey: "",
            provider: "openai",
            files: [],
            activeFile: null,
            activeFileContent: "// Select a file to view",
            openFiles: [],
            messages: [],

            setSessionId: (id) => set({ sessionId: id }),
            setWorkspacePath: (path) => set({ workspacePath: path }),
            setApiKey: (key) => set({ apiKey: key }),
            setProvider: (provider) => set({ provider }),
            addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
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
                return { messages: msgs };
            }),
            setMessages: (messages) => set({ messages }),
            appendTokenToLastMessage: (token) => set((state) => {
                const msgs = [...state.messages];
                if (msgs.length > 0) {
                    const lastIdx = msgs.length - 1;
                    const last = { ...msgs[lastIdx] };
                    last.content = (last.content || "") + token;
                    msgs[lastIdx] = last;
                }
                return { messages: msgs };
            }),
            updateLastMessageContent: (content) => set((state) => {
                const msgs = [...state.messages];
                if (msgs.length > 0) {
                    const lastIdx = msgs.length - 1;
                    const last = { ...msgs[lastIdx] };
                    last.content = content;
                    msgs[lastIdx] = last;
                }
                return { messages: msgs };
            }),
            setActiveFile: (path) => set({ activeFile: path }),
            setActiveFileContent: (content) => set({ activeFileContent: content }),
            setFiles: (files) => set({ files }),
            openFile: (path) => set((state) => ({ 
                openFiles: state.openFiles.includes(path) ? state.openFiles : [...state.openFiles, path],
                activeFile: path
            })),
            closeFile: (path) => set((state) => {
                const newOpenFiles = state.openFiles.filter(f => f !== path);
                let newActiveFile = state.activeFile;
                if (state.activeFile === path) {
                    newActiveFile = newOpenFiles.length > 0 ? newOpenFiles[newOpenFiles.length - 1] : null;
                }
                return { 
                    openFiles: newOpenFiles,
                    activeFile: newActiveFile
                };
            }),
            clearMessages: () => set({ messages: [] }),
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
