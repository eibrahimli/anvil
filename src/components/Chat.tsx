import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../store";
import { useProviderStore } from "../stores/provider";
import { useUIStore, AgentMode } from "../stores/ui";
import { Message } from "../types";
import { ChevronDown, Send, Sparkles, User, Terminal as TermIcon, History as HistoryIcon, Zap, Clock, Image as ImageIcon } from "lucide-react";
import { ToolResultRenderer } from "./tools/ToolResultRenderer";
import clsx from "clsx";

import { useAgentEvents } from "../hooks/useAgentEvents";

export function Chat() {
    const { sessionId, messages, addMessage, workspacePath, setSessionId, appendTokenToLastMessage, updateLastMessageContent } = useStore();
    const { enabledModels, activeModelId, setActiveModel, activeProviderId, apiKeys } = useProviderStore();
    const { activeMode, setActiveMode, temperature, setTemperature, isEditorOpen: _isEditorOpen, setSettingsOpen } = useUIStore();
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [activeDropdown, setActiveDropdown] = useState<'mode' | 'model' | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const modeDropdownRef = useRef<HTMLDivElement>(null);
    const modelDropdownRef = useRef<HTMLDivElement>(null);
    
    useAgentEvents(); // Hook to listen for backend events (file open, etc.)

    // Close dropdowns when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (activeDropdown === 'mode' && modeDropdownRef.current && !modeDropdownRef.current.contains(event.target as Node)) {
                setActiveDropdown(null);
            }
            if (activeDropdown === 'model' && modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
                setActiveDropdown(null);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [activeDropdown]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, loading]);

    const availableModels = enabledModels; 

    async function handleSend() {
        if (!input.trim()) return;
        
        let currentSessionId = sessionId;

        // Auto-create session if missing
        if (!currentSessionId) {
            const key = apiKeys[activeProviderId];
            // Ollama doesn't require an API key
            if (!key && activeProviderId !== 'ollama') {
                addMessage({ role: "System", content: "AI Provider not connected. Please go to Settings (Gear icon) -> Providers to enter your API key." });
                setSettingsOpen(true);
                return;
            }
            if (!workspacePath) {
                // Try to get CWD first if path is empty
                try {
                    const cwd = await invoke<string>("get_cwd");
                    // Continue with cwd
                    setLoading(true);
                    const sid = await invoke<string>("create_session", {
                        workspacePath: cwd,
                        apiKey: key || '',  // Empty string for Ollama
                        provider: activeProviderId,
                        modelId: activeModelId
                    });
                    setSessionId(sid);
                    currentSessionId = sid;
                } catch (e) {
                    addMessage({ role: "System", content: "Please select a workspace folder first (use the + button in the sidebar)." });
                    return;
                }
            } else {
                setLoading(true);
                try {
                    const sid = await invoke<string>("create_session", {
                        workspacePath,
                        apiKey: key || '',  // Empty string for Ollama
                        provider: activeProviderId,
                        modelId: activeModelId
                    });
                    setSessionId(sid);
                    currentSessionId = sid;
                } catch (e) {
                    addMessage({ role: "System", content: `Failed to initialize agent: ${e}` });
                    setLoading(false);
                    return;
                }
            }
        }

        const userMsg: Message = { role: "User", content: input };
        addMessage(userMsg);
        setInput("");
        setLoading(true);

        // Add empty assistant message for streaming
        addMessage({ role: "Assistant", content: "" });

        let unlisten: (() => void) | undefined;

        try {
            // Setup listener
            const listener = await listen<string>("chat-token", (event) => {
                appendTokenToLastMessage(event.payload);
            });
            unlisten = listener;

            const tempValue = temperature === 'low' ? 0.0 : temperature === 'medium' ? 0.5 : 0.9;

            const response = await invoke<string>("stream_chat", {
                sessionId: currentSessionId,
                message: userMsg.content,
                modelId: activeModelId,
                apiKey: apiKeys[activeProviderId],
                mode: activeMode,
                temperature: tempValue
            });
            
            if (response && response.trim().length > 0) {
                 updateLastMessageContent(response);
            }
        } catch (e) {
            addMessage({ role: "System", content: `Error: ${e}` });
        } finally {
            if (unlisten) unlisten();
            setLoading(false);
            // Auto-save session after chat completes
            if (currentSessionId) {
                invoke('save_session', { sessionId: currentSessionId }).catch(err => {
                    console.error('Failed to auto-save session:', err);
                });
            }
        }
    }

    // Helper function to parse tool execution patterns in message content
    interface ToolPart {
        type: 'tool';
        toolName: string;
        result: string;
    }
    interface TextPart {
        type: 'text';
        content: string;
    }
    type MessagePart = ToolPart | TextPart;

    const parseToolResults = (content: string): MessagePart[] => {
        const parts: MessagePart[] = [];
        const toolPattern = /> Executing tool: `([^`]+)`[\s\S]*?(?:> Result:\s*)?```\n?([\s\S]*?)```/g;

        let lastIndex = 0;
        let match;

        while ((match = toolPattern.exec(content)) !== null) {
            // Add text before the tool execution
            if (match.index > lastIndex) {
                parts.push({
                    type: 'text',
                    content: content.slice(lastIndex, match.index)
                });
            }

            // Add the tool execution
            parts.push({
                type: 'tool',
                toolName: match[1],
                result: match[2]
            });

            lastIndex = match.index + match[0].length;
        }

        // Add remaining text
        if (lastIndex < content.length) {
            parts.push({
                type: 'text',
                content: content.slice(lastIndex)
            });
        }

        return parts.length > 0 ? parts : [{ type: 'text', content }];
    };

    return (
        <div className="flex flex-col h-full bg-[var(--bg-base)] text-[var(--text-primary)] font-sans relative">
            {/* Header - Simple and clean */}
            <div className="h-14 flex items-center px-6 justify-between border-b border-[var(--border)] bg-[var(--bg-base)]/50 backdrop-blur-md">
                <div className="flex flex-col">
                    <span className="text-sm font-bold text-zinc-100 tracking-tight">Agent Console</span>
                    <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-widest truncate max-w-[200px]">
                        {workspacePath ? workspacePath.split('/').pop() : 'No Workspace'}
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    <button className="p-1.5 hover:bg-[var(--bg-elevated)] rounded-md text-gray-400 transition-colors">
                        <HistoryIcon size={16} />
                    </button>
                </div>
            </div>

            {/* Messages Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth">
                {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-30 px-12">
                        <Sparkles size={48} className="mb-4 text-[var(--accent)]" />
                        <h3 className="text-lg font-medium mb-2">How can I help you build today?</h3>
                        <p className="text-sm">I can edit files, run terminal commands, and reason about your code architecture.</p>
                    </div>
                )}

                {messages.map((m, i) => {
                    const parsedParts = parseToolResults(m.content || '');

                    return (
                    <div key={i} className={`flex gap-4 ${m.role === "User" ? "flex-row-reverse" : "flex-row"}`}>
                        <div className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center ${
                            m.role === "User" ? "bg-[var(--bg-elevated)] text-zinc-400" :
                            m.role === "System" ? "bg-red-900/20 text-red-500" : "bg-[var(--accent)]/20 text-[var(--accent)]"
                        }`}>
                            {m.role === "User" ? <User size={16} /> : <Sparkles size={16} />}
                        </div>

                        <div className={`flex flex-col max-w-[85%] ${m.role === "User" ? "items-end" : "items-start"}`}>
                            <div className={`rounded-xl p-4 text-sm leading-relaxed ${
                                m.role === "User" ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded-tr-none" :
                                m.role === "System" ? "bg-red-900/10 border border-red-900/30 text-red-400" : "bg-transparent text-[var(--text-secondary)] pl-0 w-full"
                            }`}>
                                {parsedParts.map((part, idx) => (
                                    <div key={idx}>
                                        {part.type === 'text' && part.content && (
                                            <div className="whitespace-pre-wrap font-sans">
                                                {part.content}
                                            </div>
                                        )}
                                        {part.type === 'tool' && part.toolName && part.result && (
                                            <div className="mt-3 mb-3">
                                                <ToolResultRenderer toolName={part.toolName} result={part.result} />
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {m.tool_calls && (
                                    <div className="mt-4 space-y-2">
                                        {m.tool_calls.map((t, idx) => (
                                            <div key={idx} className="flex items-center gap-2 text-[11px] bg-[var(--bg-base)] border border-[var(--border)] px-3 py-1.5 rounded-lg font-mono text-zinc-500">
                                                <TermIcon size={12} className="text-[var(--accent)]" />
                                                <span className="text-zinc-400 font-bold uppercase tracking-tighter">EXECUTE:</span>
                                                <span className="text-zinc-300">{t.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    );
                })}
                {loading && (
                    <div className="flex gap-4 animate-pulse">
                         <div className="w-8 h-8 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)]">
                            <Sparkles size={16} />
                        </div>
                        <div className="flex flex-col gap-2 mt-1">
                            <div className="h-4 w-48 bg-[var(--bg-elevated)] rounded-full"></div>
                            <div className="h-4 w-32 bg-[var(--bg-elevated)] rounded-full opacity-50"></div>
                        </div>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="p-6 bg-gradient-to-t from-[var(--bg-base)] via-[var(--bg-base)] to-transparent sticky bottom-0">
                <div className="relative group bg-[var(--bg-surface)] rounded-2xl border border-[var(--border)] focus-within:border-[var(--accent)] transition-all shadow-2xl overflow-visible">
                    <textarea
                        className="w-full bg-transparent p-4 pr-16 text-[var(--text-primary)] placeholder-zinc-600 focus:outline-none resize-none font-sans text-sm min-h-[60px]"
                        rows={2}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder="Explain your changes or ask a question..."
                    />
                    
                    <div className="flex items-center justify-between px-2 pt-2 pb-1 border-t border-zinc-800/50 mt-2">
                        {/* Left Side Buttons */}
                        <div className="flex items-center gap-1.5">
                            <div className="relative" ref={modeDropdownRef}>
                                <button 
                                    onClick={() => setActiveDropdown(activeDropdown === 'mode' ? null : 'mode')}
                                    className={clsx(
                                        "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold tracking-tighter uppercase transition-colors",
                                        activeMode === 'build' ? "bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/20" : 
                                        activeMode === 'plan' ? "bg-blue-500/10 text-blue-500 border-blue-500/20" : 
                                        "bg-green-500/10 text-green-500 border-green-500/20"
                                    )}
                                >
                                    {activeMode === 'build' ? <Zap size={12} /> : activeMode === 'plan' ? <Sparkles size={12} /> : <TermIcon size={12} />}
                                    {activeMode}
                                    <ChevronDown size={12} />
                                </button>
                                {activeDropdown === 'mode' && (
                                    <div className="absolute bottom-full left-0 mb-2 w-32 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden z-50">
                                        {(['plan', 'build', 'research'] as AgentMode[]).map(mode => (
                                            <button
                                                key={mode}
                                                onClick={() => {
                                                    setActiveMode(mode);
                                                    setActiveDropdown(null);
                                                }}
                                                className={clsx(
                                                    "w-full text-left px-4 py-2.5 text-xs transition-colors capitalize flex items-center gap-2",
                                                    activeMode === mode ? "text-[var(--text-primary)] bg-[var(--bg-elevated)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                                )}
                                            >
                                                {mode}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            
                            <div className="relative" ref={modelDropdownRef}>
                                <button 
                                    onClick={() => setActiveDropdown(activeDropdown === 'model' ? null : 'model')}
                                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[11px] font-bold text-[var(--accent)] tracking-tighter uppercase transition-colors"
                                >
                                    <Sparkles size={12} />
                                    {activeModelId}
                                    <ChevronDown size={12} />
                                </button>
                                {activeDropdown === 'model' && (
                                    <div className="absolute bottom-full left-0 mb-2 w-64 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden z-50">
                                        <div className="p-3 text-[10px] text-zinc-500 font-bold border-b border-[var(--border)] bg-[var(--bg-base)] uppercase tracking-widest">Select Model</div>
                                        <div className="max-h-64 overflow-y-auto">
                                            {availableModels.map(model => (
                                                <button
                                                    key={model}
                                                    onClick={() => {
                                                        setActiveModel(activeProviderId, model);
                                                        setActiveDropdown(null);
                                                    }}
                                                    className={clsx(
                                                        "w-full text-left px-4 py-2.5 text-xs hover:bg-[var(--accent)]/10 transition-colors",
                                                        activeModelId === model ? 'text-[var(--accent)] bg-[var(--accent)]/5' : 'text-zinc-400'
                                                    )}
                                                >
                                                    {model}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button 
                                onClick={() => {
                                    if (temperature === 'low') setTemperature('medium');
                                    else if (temperature === 'medium') setTemperature('high');
                                    else setTemperature('low');
                                }}
                                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-zinc-800 text-[11px] font-bold text-zinc-400 tracking-tighter uppercase transition-colors"
                            >
                                <Zap size={12} className={clsx(
                                    temperature === 'high' ? "text-red-400" : 
                                    temperature === 'medium' ? "text-yellow-400" : "text-blue-400"
                                )} />
                                {temperature}
                            </button>
                        </div>

                        {/* Right Side Buttons */}
                        <div className="flex items-center gap-1">
                            <button className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 transition-colors" title="Recent History">
                                <Clock size={18} />
                            </button>
                            <button className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 transition-colors" title="Add Image">
                                <ImageIcon size={18} />
                            </button>
                            <button 
                                onClick={handleSend}
                                disabled={!input.trim() || loading}
                                className="ml-1 p-2 bg-[var(--accent)] hover:bg-[var(--accent)]/80 disabled:bg-zinc-900 disabled:text-zinc-700 text-white rounded-xl transition-all active:scale-95 group/send"
                            >
                                <Send size={20} className="group-hover/send:translate-x-0.5 group-hover/send:-translate-y-0.5 transition-transform" strokeWidth={2.5} />
                            </button>
                        </div>
                    </div>
                    <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-zinc-600 font-bold uppercase tracking-widest">
                        <span>Shift + Enter for new line</span>
                        <span className="w-1 h-1 bg-zinc-800 rounded-full" />
                        <span>Control + P for commands</span>
                    </div>
                </div>
            </div>
            <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-zinc-600 font-bold uppercase tracking-widest">
                <span>Shift + Enter for new line</span>
                <span className="w-1 h-1 bg-zinc-800 rounded-full" />
                <span>Control + P for commands</span>
            </div>
        </div>
    );
}
