import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

export interface SessionMetadata {
    id: string;
    workspace_path: string;
    model: string;
    mode: string;
    created_at: string;
    message_count: number;
}

interface HistoryState {
    sessions: SessionMetadata[];
    activeSessionId: string | null;
    
    loadSessions: () => Promise<void>;
    deleteSession: (sessionId: string) => Promise<void>;
    setActiveSessionId: (sessionId: string | null) => void;
    clearActiveSessionId: () => void;
}

export const useHistoryStore = create<HistoryState>()(
    persist(
        (set) => ({
            sessions: [],
            activeSessionId: null,
            
            loadSessions: async () => {
                try {
                    const sessions = await invoke<SessionMetadata[]>('list_sessions');
                    set({ sessions: sessions || [] });
                } catch (error) {
                    console.error('Failed to load sessions:', error);
                }
            },
            
            deleteSession: async (sessionId: string) => {
                try {
                    await invoke('delete_session', { sessionId });
                    set((state) => ({
                        sessions: state.sessions.filter(s => s.id !== sessionId)
                    }));
                } catch (error) {
                    console.error('Failed to delete session:', error);
                    throw error;
                }
            },
            
            setActiveSessionId: (sessionId: string | null) => set({ activeSessionId: sessionId }),
            
            clearActiveSessionId: () => set({ activeSessionId: null }),
        }),
        {
            name: 'anvil-history',
        }
    )
);
