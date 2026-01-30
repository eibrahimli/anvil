import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store";
import { useProviderStore } from "../stores/provider";

export function Setup() {
    const { setSessionId, setWorkspacePath, setApiKey, setProvider } = useStore();
    const { enabledModels, setActiveModel } = useProviderStore();
    
    const [path, setPath] = useState("/home/develvir/Desktop/anvil"); 
    const [key, setKey] = useState("");
    const [provider, setLocalProvider] = useState("openai");
    const [modelId, setModelId] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // Filter models by provider
    const getModelsForProvider = (p: string) => {
        // This mapping logic should ideally be centralized or models should have provider metadata in the store
        // For now, simple string matching
        if (p === 'openai') return enabledModels.filter(m => m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3'));
        if (p === 'gemini') return enabledModels.filter(m => m.startsWith('gemini'));
        if (p === 'anthropic') return enabledModels.filter(m => m.startsWith('claude'));
        return [];
    };

    const currentModels = getModelsForProvider(provider);

    // Auto-select first model if current selection is invalid
    if (!currentModels.includes(modelId) && currentModels.length > 0) {
        setModelId(currentModels[0]);
    } else if (currentModels.length === 0 && modelId !== "") {
        setModelId("");
    }

    async function handleConnect() {
        if (!key) {
            setError("API Key is required");
            return;
        }
        if (!modelId) {
            setError("Please enable at least one model for this provider in Settings");
            return;
        }

        setLoading(true);
        setError("");
        try {
            const sid = await invoke<string>("create_session", {
                workspacePath: path,
                apiKey: key,
                provider: provider,
                modelId: modelId
            });
            setSessionId(sid);
            setWorkspacePath(path);
            setApiKey(key);
            setProvider(provider);
            setActiveModel(provider, modelId);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex flex-col items-center justify-center h-full bg-gray-950 text-white p-8 font-sans">
            <div className="mb-8 text-center">
                <h1 className="text-4xl font-bold mb-2">Anvil</h1>
                <p className="text-gray-400">Agentic AI Coding Environment</p>
            </div>
            
            <div className="w-full max-w-md space-y-6 bg-gray-900 p-8 rounded-lg border border-gray-800 shadow-xl">
                <div>
                    <label className="block text-sm font-medium mb-2 text-gray-300">Workspace Path</label>
                    <input 
                        className="w-full bg-gray-950 rounded p-2 border border-gray-700 text-white focus:border-blue-500 focus:outline-none"
                        value={path}
                        onChange={e => setPath(e.target.value)}
                    />
                </div>
                <div className="flex space-x-4">
                    <div className="flex-1">
                        <label className="block text-sm font-medium mb-2 text-gray-300">Provider</label>
                        <select 
                            className="w-full bg-gray-950 rounded p-2 border border-gray-700 text-white focus:border-blue-500 focus:outline-none appearance-none"
                            value={provider}
                            onChange={e => setLocalProvider(e.target.value)}
                        >
                            <option value="openai">OpenAI</option>
                            <option value="gemini">Google Gemini</option>
                            <option value="anthropic">Anthropic Claude</option>
                        </select>
                    </div>
                    <div className="flex-1">
                        <label className="block text-sm font-medium mb-2 text-gray-300">Model</label>
                        <select 
                            className="w-full bg-gray-950 rounded p-2 border border-gray-700 text-white focus:border-blue-500 focus:outline-none appearance-none"
                            value={modelId}
                            onChange={e => setModelId(e.target.value)}
                            disabled={currentModels.length === 0}
                        >
                            {currentModels.length === 0 ? (
                                <option>No models enabled in Settings</option>
                            ) : (
                                currentModels.map(m => (
                                    <option key={m} value={m}>{m}</option>
                                ))
                            )}
                        </select>
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium mb-2 text-gray-300">API Key</label>
                    <input 
                        type="password"
                        className="w-full bg-gray-950 rounded p-2 border border-gray-700 text-white focus:border-blue-500 focus:outline-none"
                        value={key}
                        onChange={e => setKey(e.target.value)}
                        placeholder={
                            provider === 'gemini' ? "AIza..." : 
                            provider === 'anthropic' ? "sk-ant-..." : "sk-..."
                        }
                    />
                </div>
                {error && <div className="text-red-500 text-sm bg-red-900/20 p-2 rounded border border-red-900">{error}</div>}
                <button 
                    onClick={handleConnect}
                    disabled={loading}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? "Initializing Agent..." : "Start Session"}
                </button>
            </div>
        </div>
    );
}
