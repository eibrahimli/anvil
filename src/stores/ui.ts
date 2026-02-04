import { create } from 'zustand';

type SidebarTab = 'explorer' | 'search' | 'settings' | 'rules' | 'skills' | 'mcp' | null;
export type AgentMode = 'plan' | 'build' | 'research';
export type Temperature = 'low' | 'medium' | 'high';

interface UIState {
    activeSidebarTab: SidebarTab;
    activeMode: AgentMode;
    temperature: Temperature;
    isTerminalOpen: boolean;
    isSettingsOpen: boolean;
    isEditorOpen: boolean;
    isOrchestratorOpen: boolean;
    isQuestionOpen: boolean;

    setActiveSidebarTab: (tab: SidebarTab) => void;
    setActiveMode: (mode: AgentMode) => void;
    setTemperature: (temp: Temperature) => void;
    toggleTerminal: () => void;
    setSettingsOpen: (open: boolean) => void;
    setEditorOpen: (open: boolean) => void;
    setOrchestratorOpen: (open: boolean) => void;
    setQuestionOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
    activeSidebarTab: null,
    activeMode: 'build',
    temperature: 'low',
    isTerminalOpen: false,
    isSettingsOpen: false,
    isEditorOpen: false,
    isOrchestratorOpen: false,
    isQuestionOpen: false,

    setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
    setActiveMode: (mode) => set({ activeMode: mode }),
    setTemperature: (temp) => set({ temperature: temp }),
    toggleTerminal: () => set((state) => ({ isTerminalOpen: !state.isTerminalOpen })),
    setSettingsOpen: (open) => set({ isSettingsOpen: open }),
    setEditorOpen: (open) => set({ isEditorOpen: open }),
    setOrchestratorOpen: (open) => set({ isOrchestratorOpen: open }),
    setQuestionOpen: (open) => set({ isQuestionOpen: open }),
}));
