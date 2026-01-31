import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

interface ConfirmationRequest {
    id: string;
    session_id: string;
    type: 'diff' | 'shell';
    file_path?: string;
    old_content?: string | null;
    new_content?: string;
    command?: string;
    suggested_pattern?: string;
}

interface ConfirmationState {
    pendingRequest: ConfirmationRequest | null;
    setPendingRequest: (req: ConfirmationRequest | null) => void;
    resolveConfirmation: (allowed: boolean, always?: boolean, pattern?: string) => Promise<void>;
}

export const useConfirmationStore = create<ConfirmationState>((set) => ({
    pendingRequest: null,
    setPendingRequest: (req) => set({ pendingRequest: req }),
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
            set({ pendingRequest: null });
        }
    },
}));
