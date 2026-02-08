import { create } from 'zustand';

type SidebarTab = 'explorer' | 'search' | 'workflows' | 'settings' | 'rules' | 'skills' | 'mcp' | null;
export type AgentMode = 'plan' | 'build' | 'research';
export type Temperature = 'low' | 'medium' | 'high';

interface UIState {
    activeSidebarTab: SidebarTab;
    activeMode: AgentMode;
    temperature: Temperature;
    isTerminalOpen: boolean;
    terminalHeight: number;
    sidebarWidth: number;
    editorWidth: number;
    isSettingsOpen: boolean;
    isEditorOpen: boolean;
    isOrchestratorOpen: boolean;
    isQuestionOpen: boolean;

    setActiveSidebarTab: (tab: SidebarTab) => void;
    setActiveMode: (mode: AgentMode) => void;
    setTemperature: (temp: Temperature) => void;
    toggleTerminal: () => void;
    setTerminalHeight: (height: number) => void;
    setSidebarWidth: (width: number) => void;
    setEditorWidth: (width: number) => void;
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
    terminalHeight: 240,
    sidebarWidth: 320,
    editorWidth: 560,
    isSettingsOpen: false,
    isEditorOpen: false,
    isOrchestratorOpen: false,
    isQuestionOpen: false,

    setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
    setActiveMode: (mode) => set({ activeMode: mode }),
    setTemperature: (temp) => set({ temperature: temp }),
    toggleTerminal: () => set((state) => ({ isTerminalOpen: !state.isTerminalOpen })),
    setTerminalHeight: (height) => set({ terminalHeight: height }),
    setSidebarWidth: (width) => set({ sidebarWidth: width }),
    setEditorWidth: (width) => set({ editorWidth: width }),
    setSettingsOpen: (open) => set({ isSettingsOpen: open }),
    setEditorOpen: (open) => set({ isEditorOpen: open }),
    setOrchestratorOpen: (open) => set({ isOrchestratorOpen: open }),
    setQuestionOpen: (open) => set({ isQuestionOpen: open }),
}));
