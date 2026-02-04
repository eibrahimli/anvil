import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DiffContent {
    oldContent: string | null;
    newContent: string | null;
}

export type PermissionAction = 'allow' | 'ask' | 'deny';

export interface PermissionRule {
    pattern: string;
    action: PermissionAction;
}

export interface ToolPermission {
    default: PermissionAction;
    rules: PermissionRule[];
}

export type PermissionValue = ToolPermission | PermissionAction;

export interface PermissionConfig {
    bash: PermissionValue;
    edit: PermissionValue;
    read: PermissionValue;
    write: PermissionValue;
    skill: PermissionValue;
    // We can add external_directory later if needed
}

interface SettingsState {
    theme: 'aura' | 'dark' | 'light';
    fontFamily: string;
    fontSize: number;
    language: string;
    isDiffMode: boolean;
    diffContent: DiffContent;
    permissions: PermissionConfig;

    setTheme: (theme: 'aura' | 'dark' | 'light') => void;
    setFontFamily: (font: string) => void;
    setFontSize: (size: number) => void;
    setLanguage: (lang: string) => void;
    setDiffMode: (active: boolean, content?: DiffContent) => void;
    setPermissions: (permissions: PermissionConfig) => void;
}

const defaultToolPermission: ToolPermission = {
    default: 'ask',
    rules: []
};

// Skills are allowed by default as per Rust config
const defaultSkillPermission: ToolPermission = {
    default: 'allow',
    rules: []
};

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            theme: 'aura',
            fontFamily: 'JetBrains Mono',
            fontSize: 14,
            language: 'english',
            isDiffMode: false,
            diffContent: { oldContent: null, newContent: null },
            permissions: {
              read: { ...defaultToolPermission },
              write: { ...defaultToolPermission },
              edit: { ...defaultToolPermission },
              bash: { ...defaultToolPermission },
              skill: { ...defaultSkillPermission },
            },
            setTheme: (theme) => set({ theme }),
            setFontFamily: (fontFamily) => set({ fontFamily }),
            setFontSize: (fontSize) => set({ fontSize }),
            setLanguage: (language) => set({ language }),
            setDiffMode: (active, content) => set({ 
                isDiffMode: active, 
                diffContent: content || { oldContent: null, newContent: null } 
            }),
            setPermissions: (permissions: PermissionConfig) => set({ permissions }),
        }),
        {
            name: 'anvil-settings',
            migrate: (persistedState: any, version) => {
                if (version === 0) {
                    // Migration from version 0 to 1
                    // Convert string permissions to object permissions
                    const newState = { ...persistedState } as SettingsState;
                    const tools = ['read', 'write', 'edit', 'bash', 'skill'];
                    
                    if (newState.permissions) {
                        tools.forEach(tool => {
                            const val = (newState.permissions as any)[tool];
                            if (typeof val === 'string') {
                                // Convert legacy string "ask" to { default: "ask", rules: [] }
                                (newState.permissions as any)[tool] = {
                                    default: val as PermissionAction,
                                    rules: []
                                };
                            }
                        });
                    }
                    return newState;
                }
                return persistedState;
            },
            version: 1,
        }
    )
);
