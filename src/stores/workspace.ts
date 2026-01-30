import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Workspace {
    initial: string;
    path: string;
    color: string;
    id: string;
}

interface WorkspaceState {
    workspaces: Workspace[];
    addWorkspace: (workspace: Workspace) => void;
    removeWorkspace: (id: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
    persist(
        (set) => ({
            workspaces: [
                { initial: 'A', path: '/home/develvir/Desktop/anvil', color: 'bg-indigo-600', id: 'default' }
            ],
            addWorkspace: (ws) => set((state) => ({
                // Don't add duplicate paths
                workspaces: state.workspaces.some(w => w.path === ws.path) 
                    ? state.workspaces 
                    : [...state.workspaces, ws]
            })),
            removeWorkspace: (id) => set((state) => ({
                workspaces: state.workspaces.filter(ws => ws.id !== id)
            })),
        }),
        {
            name: 'anvil-workspaces',
        }
    )
);
