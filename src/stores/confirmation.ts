import { create } from 'zustand';

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
}

export const useConfirmationStore = create<ConfirmationState>((set) => ({
    pendingRequest: null,
    setPendingRequest: (req) => set({ pendingRequest: req }),
}));
