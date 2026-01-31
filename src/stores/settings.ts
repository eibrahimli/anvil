import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DiffContent {
    oldContent: string | null;
    newContent: string | null;
}

interface SettingsState {
    theme: 'aura' | 'dark' | 'light';
    fontFamily: string;
    fontSize: number;
    language: string;
    isDiffMode: boolean;
    diffContent: DiffContent;

    setTheme: (theme: 'aura' | 'dark' | 'light') => void;
    setFontFamily: (font: string) => void;
    setFontSize: (size: number) => void;
    setLanguage: (lang: string) => void;
    setDiffMode: (active: boolean, content?: DiffContent) => void;
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            theme: 'aura',
            fontFamily: 'JetBrains Mono',
            fontSize: 14,
            language: 'english',
            isDiffMode: false,
            diffContent: { oldContent: null, newContent: null },
            setTheme: (theme) => set({ theme }),
            setFontFamily: (fontFamily) => set({ fontFamily }),
            setFontSize: (fontSize) => set({ fontSize }),
            setLanguage: (language) => set({ language }),
            setDiffMode: (active, content) => set({ 
                isDiffMode: active, 
                diffContent: content || { oldContent: null, newContent: null } 
            }),
        }),
        {
            name: 'anvil-settings',
        }
    )
);
