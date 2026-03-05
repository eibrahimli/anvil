import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';

interface ConfirmationRequest {
    id: string;
    session_id: string;
    type: 'diff' | 'shell' | 'permission' | 'doom_loop' | 'mode';
    file_path?: string;
    old_content?: string | null;
    new_content?: string;
    command?: string;
    tool_name?: string;
    input?: string;
    suggested_pattern?: string;
}

interface ConfirmationState {
    pendingRequest: ConfirmationRequest | null;
    pendingBySession: Record<string, ConfirmationRequest[]>;
    enqueueRequest: (req: ConfirmationRequest) => void;
    activateSession: (sessionId: string | null) => void;
    resolveConfirmation: (allowed: boolean, always?: boolean, pattern?: string) => Promise<void>;
}

const pickNextPendingRequest = (
    pendingBySession: Record<string, ConfirmationRequest[]>,
    preferredSessionId: string | null
): ConfirmationRequest | null => {
    if (preferredSessionId) {
        const preferredQueue = pendingBySession[preferredSessionId] ?? [];
        if (preferredQueue.length > 0) {
            return preferredQueue[0];
        }
    }

    for (const queue of Object.values(pendingBySession)) {
        if (queue.length > 0) {
            return queue[0];
        }
    }

    return null;
};

export const useConfirmationStore = create<ConfirmationState>((set) => ({
    pendingRequest: null,
    pendingBySession: {},
    enqueueRequest: (req) => set((state) => {
        const queue = state.pendingBySession[req.session_id] ?? [];
        const pendingBySession = {
            ...state.pendingBySession,
            [req.session_id]: [...queue, req]
        };
        const activeSessionId = useStore.getState().sessionId;
        const pendingRequest = state.pendingRequest ?? pickNextPendingRequest(pendingBySession, activeSessionId);
        return { pendingBySession, pendingRequest };
    }),
    activateSession: (sessionId) => set((state) => {
        return { pendingRequest: pickNextPendingRequest(state.pendingBySession, sessionId) };
    }),
    resolveConfirmation: async (allowed, always = false, pattern) => {
        const req = useConfirmationStore.getState().pendingRequest;
        if (!req) return;

        try {
            console.log('Resolving confirmation:', { id: req.id, session_id: req.session_id, allowed, always, pattern });
            await invoke('confirm_action', { 
                id: req.id, 
                sessionId: req.session_id,
                allowed, 
                always, 
                pattern: pattern || null
            });
        } catch (e) {
            console.error('Failed to send confirmation:', e);
            // Close modal anyway to prevent UI blocking
            alert(`Failed to confirm action: ${e}`);
        } finally {
            set((state) => {
                const queue = state.pendingBySession[req.session_id] ?? [];
                const nextQueue = queue.filter((item) => item.id !== req.id);
                const pendingBySession = { ...state.pendingBySession };
                if (nextQueue.length > 0) {
                    pendingBySession[req.session_id] = nextQueue;
                } else {
                    delete pendingBySession[req.session_id];
                }

                const activeSessionId = useStore.getState().sessionId;
                const pendingRequest = pickNextPendingRequest(pendingBySession, activeSessionId);
                return { pendingRequest, pendingBySession };
            });
        }
    },
}));
