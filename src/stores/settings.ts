import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
    theme: 'aura' | 'dark' | 'light';
    fontFamily: string;
    fontSize: number;
    language: string;
    setTheme: (theme: 'aura' | 'dark' | 'light') => void;
    setFontFamily: (font: string) => void;
    setFontSize: (size: number) => void;
    setLanguage: (lang: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            theme: 'aura',
            fontFamily: 'JetBrains Mono',
            fontSize: 14,
            language: 'english',
            setTheme: (theme) => set({ theme }),
            setFontFamily: (fontFamily) => set({ fontFamily }),
            setFontSize: (fontSize) => set({ fontSize }),
            setLanguage: (language) => set({ language }),
        }),
        {
            name: 'anvil-settings',
        }
    )
);
