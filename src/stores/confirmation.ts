import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

interface ConfirmationRequest {
    id: string;
    type: 'diff' | 'shell';
    file_path?: string;
    old_content?: string | null;
    new_content?: string;
    command?: string;
}

interface ConfirmationState {
    pendingRequest: ConfirmationRequest | null;
    setPendingRequest: (req: ConfirmationRequest | null) => void;
    resolveConfirmation: (allowed: boolean) => Promise<void>;
}

export const useConfirmationStore = create<ConfirmationState>((set) => ({
    pendingRequest: null,
    setPendingRequest: (req) => set({ pendingRequest: req }),
    resolveConfirmation: async (allowed) => {
        const req = useConfirmationStore.getState().pendingRequest;
        if (!req) return;

        try {
            await invoke('confirm_action', { id: req.id, allowed });
            set({ pendingRequest: null });
        } catch (e) {
            console.error('Failed to send confirmation:', e);
        }
    },
}));
