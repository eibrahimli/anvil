import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Model {
    id: string;
    name: string;
    providerId: string;
    enabled: boolean;
}

interface ProviderState {
    apiKeys: Record<string, string>; // providerId -> key
    enabledModels: string[]; // List of enabled model IDs
    activeModelId: string;
    activeProviderId: string;
    ollamaBaseUrl: string; // Ollama endpoint URL

    setApiKey: (provider: string, key: string) => void;
    toggleModel: (modelId: string) => void;
    setActiveModel: (providerId: string, modelId: string) => void;
    setOllamaBaseUrl: (url: string) => void;
}

export const useProviderStore = create<ProviderState>()(
    persist(
        (set) => ({
            apiKeys: {},
            enabledModels: ['gemini-1.5-pro', 'gpt-4o', 'claude-3-5-sonnet-20240620', 'llama3:8b'], // Default enabled
            activeModelId: 'gemini-1.5-pro',
            activeProviderId: 'gemini',
            ollamaBaseUrl: 'http://localhost:11434',

            setApiKey: (provider, key) => set((state) => ({
                apiKeys: { ...state.apiKeys, [provider]: key }
            })),
            
            toggleModel: (modelId) => set((state) => {
                const isEnabled = state.enabledModels.includes(modelId);
                return {
                    enabledModels: isEnabled 
                        ? state.enabledModels.filter(id => id !== modelId)
                        : [...state.enabledModels, modelId]
                };
            }),

            setActiveModel: (providerId, modelId) => set({ 
                activeProviderId: providerId, 
                activeModelId: modelId 
            }),

            setOllamaBaseUrl: (url) => set({ ollamaBaseUrl: url }),
        }),
        {
            name: 'anvil-providers',
        }
    )
);
