import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

export interface Model {
    id: string;
    name: string;
    providerId: string;
    source: "builtin" | "custom" | "synced";
}

interface ProviderState {
    apiKeys: Record<string, string>; // providerId -> key
    enabledModels: string[]; // List of enabled model IDs
    modelRegistry: Model[];
    activeModelId: string;
    activeProviderId: string;
    openaiAuthMethod: "apiKey" | "oauth";
    ollamaBaseUrl: string; // Ollama endpoint URL

    setApiKey: (provider: string, key: string) => void;
    loadApiKeysFromKeychain: () => Promise<void>;
    toggleModel: (modelId: string) => void;
    addModel: (model: Omit<Model, "source">, enabled?: boolean) => void;
    updateModel: (modelId: string, updates: Partial<Omit<Model, "id" | "source">>) => void;
    removeModel: (modelId: string) => void;
    replaceProviderModels: (providerId: string, modelIds: string[]) => void;
    setActiveModel: (providerId: string, modelId: string) => void;
    setOpenAIAuthMethod: (method: "apiKey" | "oauth") => void;
    setOllamaBaseUrl: (url: string) => void;
}

const defaultModelRegistry: Model[] = [];

const inferProviderId = (modelId: string) => {
    if (modelId.startsWith("gemini")) return "gemini";
    if (modelId.startsWith("claude")) return "anthropic";
    if (modelId.startsWith("gpt") || modelId.startsWith("o1") || modelId.startsWith("o3") || modelId.startsWith("codex")) return "openai";
    return "ollama";
};

export const useProviderStore = create<ProviderState>()(
    persist(
        (set) => ({
            apiKeys: {},
            enabledModels: [],
            modelRegistry: defaultModelRegistry,
            activeModelId: '',
            activeProviderId: 'openai',
            openaiAuthMethod: 'apiKey',
            ollamaBaseUrl: 'http://localhost:11434',

            setApiKey: (provider, key) => {
                // Update in-memory state immediately
                if (key) {
                    set((state) => ({ apiKeys: { ...state.apiKeys, [provider]: key } }));
                    // Persist to OS keychain (fire-and-forget)
                    invoke('store_api_key', { provider, apiKey: key }).catch(console.error);
                } else {
                    set((state) => {
                        const next = { ...state.apiKeys };
                        delete next[provider];
                        return { apiKeys: next };
                    });
                    invoke('delete_api_key', { provider }).catch(console.error);
                }
            },

            loadApiKeysFromKeychain: async () => {
                try {
                    const providers = await invoke<string[]>('list_stored_providers');
                    const keys: Record<string, string> = {};
                    await Promise.all(
                        providers.map(async (provider) => {
                            try {
                                const key = await invoke<string | null>('get_api_key', { provider });
                                if (key) keys[provider] = key;
                            } catch (_) {}
                        })
                    );
                    set({ apiKeys: keys });
                } catch (_) {}
            },
            
            toggleModel: (modelId) => set((state) => {
                const isEnabled = state.enabledModels.includes(modelId);
                return {
                    enabledModels: isEnabled 
                        ? state.enabledModels.filter(id => id !== modelId)
                        : [...state.enabledModels, modelId]
                };
            }),

            addModel: (model, enabled = true) => set((state) => {
                if (state.modelRegistry.some((entry) => entry.id === model.id)) {
                    return state;
                }
                const newModel: Model = { ...model, source: "custom" };
                const modelRegistry = [
                    ...state.modelRegistry,
                    newModel
                ];
                const enabledModels = enabled
                    ? [...state.enabledModels, model.id]
                    : state.enabledModels;
                return { modelRegistry, enabledModels };
            }),

            updateModel: (modelId, updates) => set((state) => {
                const modelRegistry = state.modelRegistry.map((entry) => {
                    if (entry.id !== modelId) return entry;
                    if (entry.source !== "custom") return entry;
                    return {
                        ...entry,
                        ...updates
                    };
                });
                return { modelRegistry };
            }),

            removeModel: (modelId) => set((state) => {
                const target = state.modelRegistry.find((entry) => entry.id === modelId);
                if (!target || target.source !== "custom") {
                    return state;
                }
                const modelRegistry = state.modelRegistry.filter((entry) => entry.id !== modelId);
                const enabledModels = state.enabledModels.filter((id) => id !== modelId);
                let activeModelId = state.activeModelId;
                let activeProviderId = state.activeProviderId;
                if (activeModelId === modelId) {
                    const fallback = enabledModels[0] || modelRegistry[0]?.id;
                    if (fallback) {
                        activeModelId = fallback;
                        const fallbackProvider = modelRegistry.find((entry) => entry.id === fallback)?.providerId;
                        if (fallbackProvider) {
                            activeProviderId = fallbackProvider;
                        }
                    }
                }
                return { modelRegistry, enabledModels, activeModelId, activeProviderId };
            }),

            replaceProviderModels: (providerId, modelIds) => set((state) => {
                const retained = state.modelRegistry.filter((entry) => entry.providerId !== providerId || entry.source === "custom");
                const synced = modelIds.map((id) => ({
                    id,
                    name: id,
                    providerId,
                    source: "synced" as const
                }));
                const modelRegistry = [...retained, ...synced];
                const modelIdsSet = new Set(modelRegistry.map((entry) => entry.id));
                let enabledModels = state.enabledModels.filter((id) => modelIdsSet.has(id));
                if (synced.length > 0 && enabledModels.filter((id) => modelRegistry.find((m) => m.id === id)?.providerId === providerId).length === 0) {
                    enabledModels = [...enabledModels, synced[0].id];
                }
                let activeModelId = state.activeModelId;
                let activeProviderId = state.activeProviderId;
                if (!modelIdsSet.has(activeModelId)) {
                    const fallback = enabledModels[0] || synced[0]?.id || modelRegistry[0]?.id || "";
                    if (fallback) {
                        activeModelId = fallback;
                        activeProviderId = modelRegistry.find((entry) => entry.id === fallback)?.providerId || activeProviderId;
                    }
                }
                return { modelRegistry, enabledModels, activeModelId, activeProviderId };
            }),

            setActiveModel: (providerId, modelId) => set({ 
                activeProviderId: providerId, 
                activeModelId: modelId 
            }),

            setOpenAIAuthMethod: (method) => set({ openaiAuthMethod: method }),

            setOllamaBaseUrl: (url) => set({ ollamaBaseUrl: url }),
        }),
        {
            name: 'anvil-providers',
            // Exclude apiKeys from persistence — they live in the OS keychain
            partialize: (state) => {
                const { apiKeys: _apiKeys, loadApiKeysFromKeychain: _load, ...rest } = state;
                return rest as any;
            },
            merge: (persistedState, currentState) => {
                const ps = persistedState as any;
                // One-time migration: if old localStorage had apiKeys, move them to keychain
                if (ps.apiKeys && typeof ps.apiKeys === 'object') {
                    for (const [provider, key] of Object.entries(ps.apiKeys) as [string, string][]) {
                        if (key && typeof key === 'string') {
                            invoke('store_api_key', { provider, apiKey: key }).catch(console.error);
                        }
                    }
                }
                const nextState = {
                    ...currentState,
                    ...(persistedState as Partial<ProviderState>)
                } as ProviderState;

                const registry = [...(nextState.modelRegistry || [])];
                const knownIds = new Set(registry.map((model) => model.id));
                (nextState.enabledModels || []).forEach((modelId) => {
                    if (!knownIds.has(modelId)) {
                        registry.push({
                            id: modelId,
                            name: modelId,
                            providerId: inferProviderId(modelId),
                            source: "custom"
                        });
                        knownIds.add(modelId);
                    }
                });

                nextState.modelRegistry = registry;
                nextState.enabledModels = (nextState.enabledModels || []).filter((id) => knownIds.has(id));

                if (!nextState.activeModelId || !knownIds.has(nextState.activeModelId)) {
                    const fallback = nextState.enabledModels[0] || registry[0]?.id || "";
                    nextState.activeModelId = fallback;
                    if (fallback) {
                        nextState.activeProviderId = registry.find((model) => model.id === fallback)?.providerId || nextState.activeProviderId;
                    }
                }
                return nextState;
            }
        }
    )
);
