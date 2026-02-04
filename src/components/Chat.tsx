import { useState, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../store";
import { useProviderStore } from "../stores/provider";
import { useUIStore, AgentMode } from "../stores/ui";
import { Message } from "../types";
import { ChevronDown, Send, Sparkles, History as HistoryIcon, Terminal as TermIcon, Zap, Image as ImageIcon, List as ListIcon, Clock } from "lucide-react";
import { QuestionModal } from "./QuestionModal";
import { TodoIndicator } from "./TodoIndicator";
import { ActivityStream } from "./ActivityStream";
import { StatusBar, AgentStatus } from "./StatusBar";
import clsx from "clsx";

import { useAgentEvents } from "../hooks/useAgentEvents";

export function Chat() {
    const { sessionId, messages, addMessage, workspacePath, setSessionId, appendTokenToLastMessage, updateLastMessageContent } = useStore();
    const { enabledModels, activeModelId, setActiveModel, activeProviderId, apiKeys } = useProviderStore();
    const { activeMode, setActiveMode, temperature, setTemperature, isEditorOpen: _isEditorOpen, setSettingsOpen, isQuestionOpen } = useUIStore();
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [activityView, setActivityView] = useState<'stream' | 'timeline'>("stream");
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

    type StatusInfo = {
        status: AgentStatus;
        message: string;
        detail?: string;
    };

    const statusInfo = useMemo<StatusInfo>(() => {
        const modeLabel = activeMode.charAt(0).toUpperCase() + activeMode.slice(1);
        const modeDetail = `Mode: ${modeLabel}`;

        if (isQuestionOpen) {
            return {
                status: "waiting",
                message: "Waiting for your input...",
                detail: "Answer the prompt to continue"
            };
        }

        if (loading) {
            const recentUserText = messages
                .filter((msg) => msg.role === "User")
                .slice(-3)
                .map((msg) => msg.content || "")
                .join(" ");
            const recentAssistantText = messages
                .filter((msg) => msg.role === "Assistant")
                .slice(-3)
                .map((msg) => msg.content || "")
                .join(" ");
            const recentText = `${recentUserText} ${recentAssistantText}`.trim();

            const hasTestIntent =
                activeMode === "build" &&
                /\b(?:npm|pnpm|yarn)\s+test\b|\bcargo\s+test\b|\bpytest\b|\bvitest\b|\bjest\b|\bgo\s+test\b/i.test(recentText);

            const commandIntentPatterns: RegExp[] = [
                /\b(run|execute|command|terminal|bash|shell)\b/i,
                /\b(ls|pwd|cd|cat|head|tail|rg|grep|find|sed|awk|chmod|chown|mkdir|rm|cp|mv|git|npm|pnpm|yarn|cargo|pytest|vitest|jest|go|python|pip|node|deno|docker|kubectl|terraform)\b/i
            ];
            const hasCommandIntent = commandIntentPatterns.some((pattern) => pattern.test(recentUserText));

            const toolPattern = /> Executing tool: `([^`]+)`/g;
            const toolNames: string[] = [];
            let toolMatch: RegExpExecArray | null;
            while ((toolMatch = toolPattern.exec(recentAssistantText)) !== null) {
                toolNames.push(toolMatch[1]);
            }

            const getToolStatus = (name: string): AgentStatus | null => {
                const tool = name.toLowerCase();
                if (tool.includes("question")) return "waiting";
                if (tool.includes("bash") || tool.includes("git")) return "executing";
                if (
                    tool.includes("search") ||
                    tool.includes("glob") ||
                    tool.includes("list") ||
                    tool.includes("symbol") ||
                    tool.includes("web") ||
                    tool.includes("lsp")
                ) return "researching";
                if (tool.includes("todo")) return "planning";
                if (
                    tool.includes("read") ||
                    tool.includes("write") ||
                    tool.includes("edit") ||
                    tool.includes("patch") ||
                    tool.includes("skill") ||
                    tool.includes("mcp")
                ) return "implementing";
                return null;
            };

            const toolStatuses = toolNames.map(getToolStatus).filter((status): status is AgentStatus => status !== null);
            const hasExecutingTool = toolStatuses.includes("executing");
            const hasResearchingTool = toolStatuses.includes("researching");
            const hasPlanningTool = toolStatuses.includes("planning");
            const hasImplementingTool = toolStatuses.includes("implementing");

            if (hasTestIntent) {
                return {
                    status: "testing",
                    message: "Running tests...",
                    detail: modeDetail
                };
            }

            if (hasCommandIntent || hasExecutingTool) {
                return {
                    status: "executing",
                    message: "Executing command...",
                    detail: modeDetail
                };
            }

            if (hasResearchingTool) {
                return {
                    status: "researching",
                    message: "Searching documentation...",
                    detail: modeDetail
                };
            }

            if (hasPlanningTool) {
                return {
                    status: "planning",
                    message: "Planning tasks...",
                    detail: modeDetail
                };
            }

            if (hasImplementingTool) {
                return {
                    status: "implementing",
                    message: "Writing code...",
                    detail: modeDetail
                };
            }

            if (activeMode === "plan") {
                return {
                    status: "planning",
                    message: "Analyzing problem...",
                    detail: modeDetail
                };
            }

            if (activeMode === "research") {
                return {
                    status: "researching",
                    message: "Searching documentation...",
                    detail: modeDetail
                };
            }

            return {
                status: "implementing",
                message: "Writing code...",
                detail: modeDetail
            };
        }

        const hasConversation = messages.some((msg) => msg.role === "User" || msg.role === "Assistant");

        if (!hasConversation) {
            return {
                status: "done",
                message: "Ready when you are",
                detail: modeDetail
            };
        }

        return {
            status: "done",
            message: "Task completed",
            detail: modeDetail
        };
    }, [activeMode, isQuestionOpen, loading, messages]);

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
            const errorMsg = String(e);
            // If session not found, clear it and retry
            if (errorMsg.includes("Session not found")) {
                console.log("Session not found in backend, clearing and retrying...");
                setSessionId(null);
                addMessage({ role: "System", content: "Session expired. Please send your message again to create a new session." });
            } else {
                addMessage({ role: "System", content: `Error: ${e}` });
            }
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
                    <TodoIndicator />
                    <button
                        className="p-1.5 hover:bg-[var(--bg-elevated)] rounded-md text-gray-400 transition-colors"
                        title={activityView === "stream" ? "Switch to timeline view" : "Switch to stream view"}
                        onClick={() => setActivityView(activityView === "stream" ? "timeline" : "stream")}
                    >
                        {activityView === "stream" ? <Clock size={16} /> : <ListIcon size={16} />}
                    </button>
                    <button className="p-1.5 hover:bg-[var(--bg-elevated)] rounded-md text-gray-400 transition-colors">
                        <HistoryIcon size={16} />
                    </button>
                </div>
            </div>

            {/* Activity Stream Area */}
            <StatusBar
                status={statusInfo.status}
                message={statusInfo.message}
                detail={statusInfo.detail}
            />
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 scroll-smooth">
                {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-30 px-12">
                        <Sparkles size={48} className="mb-4 text-[var(--accent)]" />
                        <h3 className="text-lg font-medium mb-2">How can I help you build today?</h3>
                        <p className="text-sm">I can edit files, run terminal commands, and reason about your code architecture.</p>
                    </div>
                )}

                <ActivityStream 
                    messages={messages} 
                    isLoading={loading}
                    view={activityView}
                />
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
            
            {/* Question Modal for agent interactions */}
            <QuestionModal />
        </div>
    );
}
