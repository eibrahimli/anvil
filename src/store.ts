import { create } from 'zustand';
import { Message, FileNode } from './types';

interface AppState {
    sessionId: string | null;
    workspacePath: string;
    apiKey: string;
    provider: string;
    files: FileNode[];
    activeFile: string | null;
    activeFileContent: string;
    messages: Message[];
    
    setSessionId: (id: string) => void;
    setWorkspacePath: (path: string) => void;
    setApiKey: (key: string) => void;
    setProvider: (provider: string) => void;
    addMessage: (msg: Message) => void;
    appendTokenToLastMessage: (token: string) => void;
    updateLastMessageContent: (content: string) => void;
    setActiveFile: (path: string) => void;
    setActiveFileContent: (content: string) => void;
    setFiles: (files: FileNode[]) => void;
}

export const useStore = create<AppState>((set) => ({
    sessionId: null,
    workspacePath: "",
    apiKey: "",
    provider: "openai",
    files: [],
    activeFile: null,
    activeFileContent: "// Select a file to view",
    messages: [],

    setSessionId: (id) => set({ sessionId: id }),
    setWorkspacePath: (path) => set({ workspacePath: path }),
    setApiKey: (key) => set({ apiKey: key }),
    setProvider: (provider) => set({ provider }),
    addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
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
}));
