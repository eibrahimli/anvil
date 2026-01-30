import { X, Moon, Keyboard, Box, Cpu, Search } from 'lucide-react';
import { useUIStore } from '../../stores/ui';
import { useSettingsStore } from '../../stores/settings';
import { useProviderStore } from '../../stores/provider';
import clsx from 'clsx';
import { useState } from 'react';

type SettingsTab = 'general' | 'shortcuts' | 'providers' | 'models';

export function SettingsModal() {
    const { isSettingsOpen, setSettingsOpen } = useUIStore();
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');

    if (!isSettingsOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center animate-in fade-in duration-300">
            <div className="w-[850px] h-[650px] bg-[var(--bg-surface)] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-[var(--border)] flex overflow-hidden scale-in-center animate-in zoom-in-95 duration-200">
                {/* Sidebar */}
                <div className="w-52 border-r border-[var(--border)] p-3 flex flex-col gap-1 bg-[var(--bg-base)]">
                    <div className="px-4 py-6 font-bold text-zinc-500 text-[10px] uppercase tracking-[0.2em]">User Preferences</div>
                    <TabButton 
                        active={activeTab === 'general'} 
                        onClick={() => setActiveTab('general')} 
                        icon={<Moon size={18} />} 
                        label="Appearance" 
                    />
                    <TabButton 
                        active={activeTab === 'shortcuts'} 
                        onClick={() => setActiveTab('shortcuts')} 
                        icon={<Keyboard size={18} />} 
                        label="Shortcuts" 
                    />
                    <div className="px-4 py-4 mt-6 font-bold text-zinc-500 text-[10px] uppercase tracking-[0.2em]">Agent Config</div>
                    <TabButton 
                        active={activeTab === 'providers'} 
                        onClick={() => setActiveTab('providers')} 
                        icon={<Box size={18} />} 
                        label="Providers" 
                    />
                    <TabButton 
                        active={activeTab === 'models'} 
                        onClick={() => setActiveTab('models')} 
                        icon={<Cpu size={18} />} 
                        label="Models" 
                    />
                </div>

                {/* Content */}
                <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg-surface)]">
                    <div className="h-16 border-b border-[var(--border)] flex items-center justify-between px-8 bg-[var(--bg-surface)]/50">
                        <h2 className="font-bold text-lg tracking-tight text-zinc-100">{activeTab.toUpperCase()}</h2>
                        <button 
                            onClick={() => setSettingsOpen(false)}
                            className="p-2 hover:bg-[var(--bg-elevated)] rounded-full transition-all text-zinc-400 hover:text-white"
                        >
                            <X size={20} />
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-auto p-8">
                        {activeTab === 'general' && <GeneralSettings />}
                        {activeTab === 'shortcuts' && <ShortcutSettings />}
                        {activeTab === 'providers' && <ProviderSettings />}
                        {activeTab === 'models' && <ModelSettings />}
                    </div>
                </div>
            </div>
        </div>
    );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
    return (
        <button
            onClick={onClick}
            className={clsx(
                "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-bold transition-all w-full text-left",
                active 
                    ? "bg-[var(--accent)] text-white shadow-[0_0_15px_rgba(139,92,246,0.3)]" 
                    : "text-zinc-500 hover:text-zinc-200 hover:bg-[var(--bg-elevated)]"
            )}
        >
            {icon}
            <span className="tracking-tight">{label}</span>
        </button>
    );
}

// --- Sub Components ---

function GeneralSettings() {
    const { theme, setTheme, fontFamily, setFontFamily } = useSettingsStore();

    return (
        <div className="space-y-8 max-w-lg">
            <div>
                <h3 className="text-sm font-medium text-gray-300 mb-4">Appearance</h3>
                <div className="grid grid-cols-2 gap-4">
                    {['aura', 'dark', 'light'].map((t) => (
                        <button
                            key={t}
                            onClick={() => setTheme(t as any)}
                            className={clsx(
                                "border rounded-xl p-4 text-left capitalize transition-all",
                                theme === t 
                                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] shadow-[0_0_20px_rgba(139,92,246,0.1)]" 
                                    : "border-[var(--border)] hover:border-zinc-600 bg-[var(--bg-base)] text-zinc-400"
                            )}
                        >
                            <div className="font-bold text-sm">{t}</div>
                            <div className="text-[10px] opacity-60 mt-1 uppercase tracking-tighter">
                                {t === 'aura' ? 'Signature purple' : t === 'dark' ? 'Neutral black' : 'High contrast'}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <h3 className="text-sm font-medium text-zinc-300 mb-4">Font</h3>
                <div className="space-y-3">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Interface & Editor Font</label>
                    <select 
                        className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm focus:border-[var(--accent)] outline-none appearance-none text-[var(--text-primary)]"
                        value={fontFamily}
                        onChange={(e) => setFontFamily(e.target.value)}
                    >
                        <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
                        <option value="'Fira Code', monospace">Fira Code</option>
                        <option value="'Source Code Pro', monospace">Source Code Pro</option>
                        <option value="'Inter', sans-serif">Inter Sans</option>
                        <option value="monospace">System Mono</option>
                    </select>
                </div>
            </div>
        </div>
    );
}

function ShortcutSettings() {
    const shortcuts = [
        { key: 'Ctrl+P', desc: 'Command Palette' },
        { key: 'Ctrl+\\', desc: 'Toggle Terminal' },
        { key: 'Ctrl+,', desc: 'Open Settings' },
        { key: 'Ctrl+Enter', desc: 'Send Message' },
    ];

    return (
        <div className="space-y-2">
            {shortcuts.map(s => (
                <div key={s.key} className="flex items-center justify-between py-4 border-b border-[var(--border)] group">
                    <span className="text-sm text-zinc-400 group-hover:text-zinc-200 transition-colors">{s.desc}</span>
                    <kbd className="bg-[var(--bg-elevated)] border border-[var(--border)] px-3 py-1.5 rounded-lg text-[10px] font-bold font-mono text-zinc-400 shadow-sm">{s.key}</kbd>
                </div>
            ))}
        </div>
    );
}

function ProviderSettings() {
    const { apiKeys, setApiKey, ollamaBaseUrl, setOllamaBaseUrl } = useProviderStore();
    
    const providers = [
        { id: 'openai', name: 'OpenAI', icon: '⚡', needsKey: true },
        { id: 'gemini', name: 'Google Gemini', icon: '✨', needsKey: true },
        { id: 'anthropic', name: 'Anthropic', icon: '🧠', needsKey: true },
        { id: 'ollama', name: 'Ollama (Local)', icon: '🏠', needsKey: false },
    ];

    return (
        <div className="space-y-4">
            {providers.map(p => (
                <div key={p.id} className="bg-[var(--bg-base)] border border-[var(--border)] rounded-2xl p-5 hover:border-[var(--accent)]/30 transition-all group">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-[var(--bg-elevated)] flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                                {p.icon}
                            </div>
                            <div>
                                <div className="font-bold text-zinc-100">{p.name}</div>
                                <div className={clsx(
                                    "text-[10px] font-bold uppercase tracking-widest",
                                    p.needsKey 
                                        ? (apiKeys[p.id] ? 'text-green-500' : 'text-zinc-600')
                                        : 'text-green-500'
                                )}>
                                    {p.needsKey 
                                        ? (apiKeys[p.id] ? 'Connected' : 'Disconnected')
                                        : 'Always Available'
                                    }
                                </div>
                            </div>
                        </div>
                        {p.needsKey ? (
                            <button 
                                className={clsx(
                                    "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-tighter transition-all",
                                    apiKeys[p.id] 
                                        ? "bg-red-500/10 text-red-500 hover:bg-red-500/20" 
                                        : "bg-[var(--accent)] text-white hover:bg-[var(--accent)]/80 shadow-lg"
                                )}
                                onClick={() => {
                                    if (apiKeys[p.id]) {
                                        setApiKey(p.id, ""); // Disconnect
                                    } else {
                                        const key = prompt(`Enter API Key for ${p.name}:`);
                                        if (key) setApiKey(p.id, key);
                                    }
                                }}
                            >
                                {apiKeys[p.id] ? 'Revoke Access' : 'Connect'}
                            </button>
                        ) : (
                            <button 
                                className="bg-[var(--bg-elevated)] text-zinc-400 hover:text-white px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-tighter transition-all border border-[var(--border)] hover:border-[var(--accent)]"
                                onClick={() => {
                                    const url = prompt("Enter Ollama Base URL:", ollamaBaseUrl);
                                    if (url) setOllamaBaseUrl(url);
                                }}
                            >
                                Configure
                            </button>
                        )}
                    </div>
                    {p.id === 'ollama' && (
                        <div className="mt-3 pt-3 border-t border-[var(--border)]">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-500">Base URL:</span>
                                <span className="text-zinc-300 font-mono">{ollamaBaseUrl}</span>
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

function ModelSettings() {
    const { enabledModels, toggleModel } = useProviderStore();
    const [search, setSearch] = useState("");

    const allModels = [
        // Google
        { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', provider: 'Google' },
        { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', provider: 'Google' },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'Google' },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google' },
        { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash Exp', provider: 'Google' },
        
        // Anthropic
        { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', provider: 'Anthropic' },
        { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', provider: 'Anthropic' },
        { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', provider: 'Anthropic' },
        { id: 'claude-3-5-sonnet-20240620', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },

        // OpenAI
        { id: 'gpt-5.2', name: 'GPT-5.2', provider: 'OpenAI' },
        { id: 'o3-pro', name: 'o3 Pro (Reasoning)', provider: 'OpenAI' },
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },

        // Ollama (Local)
        { id: 'llama3:70b', name: 'Llama 3 70B', provider: 'Ollama' },
        { id: 'llama3:8b', name: 'Llama 3 8B', provider: 'Ollama' },
        { id: 'llama3.1:70b', name: 'Llama 3.1 70B', provider: 'Ollama' },
        { id: 'llama3.1:8b', name: 'Llama 3.1 8B', provider: 'Ollama' },
        { id: 'llama3.2:3b', name: 'Llama 3.2 3B', provider: 'Ollama' },
        { id: 'mistral:7b', name: 'Mistral 7B', provider: 'Ollama' },
        { id: 'codellama:34b', name: 'Code Llama 34B', provider: 'Ollama' },
        { id: 'deepseek-coder', name: 'DeepSeek Coder', provider: 'Ollama' },
        { id: 'deepseek-coder-v2:16b', name: 'DeepSeek Coder V2 16B', provider: 'Ollama' },
        { id: 'phi3:14b', name: 'Phi-3 14B', provider: 'Ollama' },
        { id: 'gemma2:27b', name: 'Gemma 2 27B', provider: 'Ollama' },
    ];

    const filtered = allModels.filter(m => 
        m.name.toLowerCase().includes(search.toLowerCase()) || 
        m.id.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <div className="relative group">
                <Search size={16} className="absolute left-4 top-3.5 text-zinc-600 group-focus-within:text-[var(--accent)] transition-colors" />
                <input 
                    className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-2xl pl-12 pr-4 py-3 text-sm focus:border-[var(--accent)] outline-none text-[var(--text-primary)] transition-all shadow-inner"
                    placeholder="Search available models..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>

            <div className="grid grid-cols-1 gap-2">
                {filtered.map(m => (
                    <div key={m.id} className="flex items-center justify-between p-4 rounded-xl hover:bg-[var(--bg-elevated)]/50 border border-transparent hover:border-[var(--border)] transition-all">
                        <div className="flex flex-col gap-1">
                            <div className="text-sm font-bold text-zinc-100 tracking-tight">{m.name}</div>
                            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{m.id} • {m.provider}</div>
                        </div>
                        <button
                            onClick={() => toggleModel(m.id)}
                            className={clsx(
                                "w-12 h-6 rounded-full transition-all relative shadow-inner",
                                enabledModels.includes(m.id) ? "bg-[var(--accent)]" : "bg-zinc-800"
                            )}
                        >
                            <div className={clsx(
                                "absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform shadow-md",
                                enabledModels.includes(m.id) ? "translate-x-6" : "translate-x-0"
                            )} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
