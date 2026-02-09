import { useState, useRef, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../store";
import { useProviderStore } from "../stores/provider";
import { useUIStore, AgentMode } from "../stores/ui";
import { Message, Attachment, FileNode } from "../types";
import { ChevronDown, Send, Sparkles, History as HistoryIcon, Terminal as TermIcon, Zap, Image as ImageIcon, List as ListIcon, Clock, PanelRight, Pencil, X } from "lucide-react";
import { QuestionModal } from "./QuestionModal";
import { TodoIndicator } from "./TodoIndicator";
import { ActivityStream } from "./ActivityStream";
import { StatusBar, AgentStatus } from "./StatusBar";
import clsx from "clsx";
import { estimateUsage } from "../utils/usage";

import { useAgentEvents } from "../hooks/useAgentEvents";

export function Chat() {
    const { sessionId, messages, addMessage, workspacePath, setSessionId, appendTokenToLastMessage, updateLastMessageContent, files, setFiles } = useStore();
    const { enabledModels, activeModelId, setActiveModel, activeProviderId, apiKeys } = useProviderStore();
    const { activeMode, setActiveMode, temperature, setTemperature, isEditorOpen, setEditorOpen, setSettingsOpen, isQuestionOpen } = useUIStore();
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [activityView, setActivityView] = useState<'stream' | 'timeline'>("stream");
    const [activeDropdown, setActiveDropdown] = useState<'mode' | 'model' | null>(null);
    const [gitSummary, setGitSummary] = useState<{ staged: number; unstaged: number; untracked: number; conflicted: number; branch?: string; files?: string[] } | null>(null);
    const [showGitDetails, setShowGitDetails] = useState(false);
    const [imageAttachments, setImageAttachments] = useState<(Attachment & { previewUrl: string })[]>([]);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [commandIndex, setCommandIndex] = useState(0);
    const [mentionIndex, setMentionIndex] = useState(0);
    const [sessionStartedAt, setSessionStartedAt] = useState<Date | null>(null);
    const [lastActivityAt, setLastActivityAt] = useState<Date | null>(null);
    const [isFetchingFiles, setIsFetchingFiles] = useState(false);
    const [messageTimes, setMessageTimes] = useState<string[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const modeDropdownRef = useRef<HTMLDivElement>(null);
    const modelDropdownRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const textareaOverlayRef = useRef<HTMLDivElement>(null);
    
    useAgentEvents(); // Hook to listen for backend events (file open, etc.)

    const flattenFileNodes = (nodes: FileNode[]): string[] => {
        const result: string[] = [];
        const walk = (entries: FileNode[]) => {
            entries.forEach((entry) => {
                if (entry.kind === "file") {
                    result.push(entry.path);
                } else if (entry.children) {
                    walk(entry.children);
                }
            });
        };
        walk(nodes);
        return result;
    };

    const fileIndex = useMemo(() => flattenFileNodes(files || []), [files]);
    const mentionMatch = input.slice(0, cursorPosition).match(/@([\w./-]*)$/);
    const mentionQuery = mentionMatch?.[1] ?? null;
    const mentionSuggestions = mentionQuery !== null
        ? fileIndex
            .map((path) => {
                const relative = workspacePath && path.startsWith(`${workspacePath}/`)
                    ? path.slice(workspacePath.length + 1)
                    : path;
                const name = relative.split("/").pop() || relative;
                return { path, name, relative };
            })
            .filter((item) => {
                const query = mentionQuery.toLowerCase();
                return item.relative.toLowerCase().includes(query) || item.path.toLowerCase().includes(query);
            })
            .slice(0, 6)
        : [];

    type MentionToken = {
        path: string;
        start: number;
        end: number;
    };

    const mentionTokens = useMemo<MentionToken[]>(() => {
        if (!input) return [];
        const tokens: MentionToken[] = [];
        const mentionRegex = /(^|[\s([{])@([\w./-]+)/g;
        let match: RegExpExecArray | null;
        while ((match = mentionRegex.exec(input)) !== null) {
            const leading = match[1] ?? "";
            const path = match[2];
            const start = match.index + leading.length;
            const end = start + path.length + 1;
            tokens.push({ path, start, end });
        }
        return tokens;
    }, [input]);

    const mentionBadges = useMemo(() => {
        const seen = new Set<string>();
        return mentionTokens.reduce((acc, token) => {
            if (seen.has(token.path)) return acc;
            seen.add(token.path);
            const relative = workspacePath && token.path.startsWith(`${workspacePath}/`)
                ? token.path.slice(workspacePath.length + 1)
                : token.path;
            const name = relative.split("/").pop() || relative;
            acc.push({ path: token.path, name, relative });
            return acc;
        }, [] as { path: string; name: string; relative: string }[]);
    }, [mentionTokens, workspacePath]);

    const highlightedInput = useMemo(() => {
        if (!input) return [" "];
        const mentionRegex = /@[\w./-]+/g;
        const parts: ReactNode[] = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = mentionRegex.exec(input)) !== null) {
            const start = match.index;
            const value = match[0];
            if (start > lastIndex) {
                parts.push(input.slice(lastIndex, start));
            }
            parts.push(
                <span
                    key={`mention-${start}-${value}`}
                    className="rounded-md bg-[var(--accent)]/15 px-1 py-0.5 font-mono text-[12px] text-[var(--accent)]"
                >
                    {value}
                </span>
            );
            lastIndex = start + value.length;
        }
        if (lastIndex < input.length) {
            parts.push(input.slice(lastIndex));
        }
        return parts;
    }, [input]);

    const slashMatch = input.slice(0, cursorPosition).match(/\/(\w*)$/);
    const slashQuery = slashMatch?.[1]?.toLowerCase() ?? "";
    const commandOptions = [
        { key: "mode", label: "Mode", detail: "Switch plan/build/research", value: "/mode " },
        { key: "model", label: "Model", detail: "Switch active model", value: "/model " },
        { key: "provider", label: "Provider", detail: "Switch provider", value: "/provider " },
        { key: "temp", label: "Temperature", detail: "low | medium | high", value: "/temp " },
        { key: "settings", label: "Settings", detail: "Open settings", value: "/settings" },
        { key: "help", label: "Help", detail: "List commands", value: "/help" }
    ];

    const toolOptions = [
        { key: "read_file", label: "Read file", detail: "Open file contents", value: "Use read_file on " },
        { key: "list", label: "List", detail: "List directory contents", value: "Use list on " },
        { key: "glob", label: "Glob", detail: "Find by glob pattern", value: "Use glob with pattern " },
        { key: "grep", label: "Grep", detail: "Search content", value: "Use grep with pattern " },
        { key: "search", label: "Search", detail: "Regex search", value: "Use search with pattern " },
        { key: "bash", label: "Bash", detail: "Run a shell command", value: "Run bash command " },
        { key: "webfetch", label: "Webfetch", detail: "Fetch a URL", value: "Fetch URL " },
        { key: "write_file", label: "Write file", detail: "Create a file", value: "Write file " },
        { key: "edit_file", label: "Edit file", detail: "Modify a file", value: "Edit file " }
    ];

    const commandItems = commandOptions.filter((cmd) => cmd.key.includes(slashQuery));
    const toolItems = toolOptions.filter((cmd) => cmd.key.includes(slashQuery));
    const slashItems = [...commandItems, ...toolItems];

    const insertMention = (path: string) => {
        const before = input.slice(0, cursorPosition);
        const after = input.slice(cursorPosition);
        const nextBefore = before.replace(/@[\w./-]*$/, `@${path} `);
        const nextValue = `${nextBefore}${after}`;
        setInput(nextValue);
        setCursorPosition(nextBefore.length);
        setMentionIndex(0);
        requestAnimationFrame(() => {
            if (textareaRef.current) {
                textareaRef.current.focus();
            }
        });
    };

    const removeMention = (path: string) => {
        const targets = mentionTokens.filter((token) => token.path === path);
        if (targets.length === 0) return;
        let nextValue = input;
        const sorted = [...targets].sort((a, b) => b.start - a.start);
        sorted.forEach((token) => {
            let start = token.start;
            let end = token.end;
            if (nextValue[end] === " ") {
                end += 1;
            } else if (start > 0 && nextValue[start - 1] === " ") {
                start -= 1;
            }
            nextValue = `${nextValue.slice(0, start)}${nextValue.slice(end)}`;
        });
        setInput(nextValue);
        setCursorPosition(nextValue.length);
        requestAnimationFrame(() => {
            if (textareaRef.current) {
                textareaRef.current.focus();
                textareaRef.current.setSelectionRange(nextValue.length, nextValue.length);
            }
        });
    };

    const replaceMention = (path: string) => {
        const target = mentionTokens.find((token) => token.path === path);
        if (!target) return;
        const nextValue = `${input.slice(0, target.start)}@${input.slice(target.end)}`;
        const nextCursor = target.start + 1;
        setInput(nextValue);
        setCursorPosition(nextCursor);
        setShowCommandPalette(false);
        setMentionIndex(0);
        requestAnimationFrame(() => {
            if (textareaRef.current) {
                textareaRef.current.focus();
                textareaRef.current.setSelectionRange(nextCursor, nextCursor);
            }
        });
    };

    const insertCommand = (value: string) => {
        const before = input.slice(0, cursorPosition).replace(/\/(\w*)$/, value);
        const after = input.slice(cursorPosition);
        const nextValue = `${before}${after}`;
        setInput(nextValue);
        setShowCommandPalette(false);
        setCommandIndex(0);
        requestAnimationFrame(() => textareaRef.current?.focus());
    };

    useEffect(() => {
        if (sessionId && !sessionStartedAt) {
            setSessionStartedAt(new Date());
        }
    }, [sessionId, sessionStartedAt]);

    useEffect(() => {
        if (messages.length > 0) {
            setLastActivityAt(new Date());
        }
    }, [messages.length]);

    useEffect(() => {
        if (messages.length === messageTimes.length) return;
        setMessageTimes((prev) => {
            if (messages.length < prev.length) {
                return prev.slice(0, messages.length);
            }
            const next = [...prev];
            for (let i = prev.length; i < messages.length; i += 1) {
                next.push(new Date().toLocaleString());
            }
            return next;
        });
    }, [messageTimes.length, messages.length]);

    useEffect(() => {
        if (mentionQuery === null || !workspacePath) return;
        if (fileIndex.length > 0 || isFetchingFiles) return;

        const fetchFiles = async () => {
            try {
                setIsFetchingFiles(true);
                const nodes = await invoke<FileNode[]>("get_file_tree", { path: workspacePath });
                setFiles(nodes);
            } catch (error) {
                console.error("Failed to load file index:", error);
            } finally {
                setIsFetchingFiles(false);
            }
        };

        fetchFiles();
    }, [fileIndex.length, isFetchingFiles, mentionQuery, setFiles, workspacePath]);

    useEffect(() => {
        if (showCommandPalette) {
            setCommandIndex(0);
        }
    }, [showCommandPalette, slashQuery]);

    useEffect(() => {
        if (commandIndex >= slashItems.length) {
            setCommandIndex(0);
        }
    }, [commandIndex, slashItems.length]);

    useEffect(() => {
                                    if (mentionSuggestions.length > 0) {
                                        setMentionIndex(0);
                                    }
                                }, [mentionSuggestions.length, mentionQuery]);

    useEffect(() => {
                                    if (mentionIndex >= mentionSuggestions.length) {
                                        setMentionIndex(0);
                                    }
                                }, [mentionIndex, mentionSuggestions.length]);

    const supportsImages = useMemo(() => {
        if (activeProviderId === "gemini") return activeModelId.startsWith("gemini");
        if (activeProviderId === "openai") {
            return activeModelId.startsWith("gpt-4o") || activeModelId.startsWith("gpt-4.1");
        }
        return false;
    }, [activeModelId, activeProviderId]);

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

    useEffect(() => {
        let timer: number | null = null;

        const refreshGit = async () => {
            if (!workspacePath) {
                setGitSummary(null);
                return;
            }
            try {
                const result = await invoke<any>("git_status_summary", { workspacePath });
                const stagedList = Array.isArray(result?.staged) ? result.staged : [];
                const unstagedList = Array.isArray(result?.unstaged) ? result.unstaged : [];
                const untrackedList = Array.isArray(result?.untracked) ? result.untracked : [];
                const conflictedList = Array.isArray(result?.conflicted) ? result.conflicted : [];
                const staged = stagedList.length;
                const unstaged = unstagedList.length;
                const untracked = untrackedList.length;
                const conflicted = conflictedList.length;
                const branch = typeof result?.branch === "string" ? result.branch : undefined;
                const files = [...new Set([...stagedList, ...unstagedList, ...untrackedList, ...conflictedList])];
                setGitSummary({ staged, unstaged, untracked, conflicted, branch, files });
            } catch (error) {
                setGitSummary(null);
            }
        };

        refreshGit();
        if (workspacePath) {
            timer = window.setInterval(refreshGit, 15000);
        }

        return () => {
            if (timer) {
                window.clearInterval(timer);
            }
        };
    }, [workspacePath]);

    type StatusInfo = {
        status: AgentStatus;
        message: string;
        detail?: string;
    };

    const usage = useMemo(() => estimateUsage(messages, activeModelId), [messages, activeModelId]);
    const contextMeta = useMemo(() => {
        const sessionLabel = workspacePath ? workspacePath.split("/").pop() : "No workspace";
        const rawMessages = messages.slice(-12).map((msg, idx) => {
            const absoluteIndex = messages.length - 12 + idx;
            return {
                id: `msg-${absoluteIndex + 1}`,
                role: msg.role.toLowerCase(),
                time: messageTimes[absoluteIndex] || "N/A"
            };
        });
        return {
            sessionLabel,
            sessionId: sessionId ? sessionId.slice(0, 8) : undefined,
            workspace: workspacePath || undefined,
            provider: activeProviderId,
            model: activeModelId,
            mode: activeMode,
            sessionStarted: sessionStartedAt ? sessionStartedAt.toLocaleString() : undefined,
            lastActivity: lastActivityAt ? lastActivityAt.toLocaleString() : undefined,
            rawMessages
        };
    }, [activeMode, activeModelId, activeProviderId, lastActivityAt, messageTimes, messages, sessionId, sessionStartedAt, workspacePath]);

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

            const toolCalls = messages
                .filter((msg) => msg.role === "Assistant")
                .flatMap((msg) => msg.tool_calls || []);

            const toolResults = new Set(
                messages
                    .filter((msg) => msg.role === "Tool")
                    .map((msg) => msg.tool_call_id)
                    .filter((id): id is string => Boolean(id))
            );

            const pendingToolCalls = toolCalls.filter((call) => !toolResults.has(call.id));
            const toolNames = pendingToolCalls.map((call) => call.name);

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
                status: "responding",
                message: "Composing response...",
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

    const providerForModel = (modelId: string) => {
        if (modelId.startsWith("gemini")) return "gemini";
        if (modelId.startsWith("claude")) return "anthropic";
        if (
            modelId.startsWith("llama") ||
            modelId.startsWith("mistral") ||
            modelId.startsWith("codellama") ||
            modelId.startsWith("deepseek")
        ) {
            return "ollama";
        }
        return "openai";
    };

    const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selected = Array.from(event.target.files || []);
        selected.forEach((file) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = String(reader.result || "");
                const base64 = result.split(",")[1] || "";
                const previewUrl = URL.createObjectURL(file);
                setImageAttachments((prev) => ([
                    ...prev,
                    {
                        name: file.name,
                        mime_type: file.type || "image/png",
                        data: base64,
                        previewUrl
                    }
                ]));
            };
            reader.readAsDataURL(file);
        });
        event.target.value = "";
    };

    const removeImageAttachment = (index: number) => {
        setImageAttachments((prev) => {
            const next = [...prev];
            const [removed] = next.splice(index, 1);
            if (removed?.previewUrl) {
                URL.revokeObjectURL(removed.previewUrl);
            }
            return next;
        });
    };

    const clearImageAttachments = () => {
        imageAttachments.forEach((attachment) => {
            if (attachment.previewUrl) {
                URL.revokeObjectURL(attachment.previewUrl);
            }
        });
        setImageAttachments([]);
    };

    const handleSlashCommand = (raw: string) => {
        const trimmed = raw.trim();
        if (!trimmed.startsWith("/")) return false;

        const [command, ...args] = trimmed.slice(1).split(/\s+/);
        const value = args.join(" ").trim();
        const normalized = command.toLowerCase();

        if (!normalized) return false;

        if (normalized === "help") {
            addMessage({
                role: "System",
                content: "Commands:\n- /mode plan|build|research\n- /model <id>\n- /provider <openai|gemini|anthropic|ollama>\n- /temp low|medium|high\n- /settings"
            });
            setInput("");
            return true;
        }

        if (normalized === "settings") {
            setSettingsOpen(true);
            addMessage({ role: "System", content: "Opened settings." });
            setInput("");
            return true;
        }

        if (normalized === "mode") {
            const mode = value.toLowerCase();
            if (!mode) {
                addMessage({ role: "System", content: "Usage: /mode plan|build|research" });
                setInput("");
                return true;
            }
            if (mode === "plan" || mode === "build" || mode === "research") {
                setActiveMode(mode as AgentMode);
                addMessage({ role: "System", content: `Mode set to ${mode}.` });
            } else {
                addMessage({ role: "System", content: "Unknown mode. Use /mode plan|build|research." });
            }
            setInput("");
            return true;
        }

        if (normalized === "temp") {
            const temp = value.toLowerCase();
            if (!temp) {
                addMessage({ role: "System", content: "Usage: /temp low|medium|high" });
                setInput("");
                return true;
            }
            if (temp === "low" || temp === "medium" || temp === "high") {
                setTemperature(temp as "low" | "medium" | "high");
                addMessage({ role: "System", content: `Temperature set to ${temp}.` });
            } else {
                addMessage({ role: "System", content: "Unknown temperature. Use /temp low|medium|high." });
            }
            setInput("");
            return true;
        }

        if (normalized === "model") {
            if (!value) {
                addMessage({ role: "System", content: `Available models: ${enabledModels.join(", ")}` });
                setInput("");
                return true;
            }
            const match = enabledModels.find((model) => model.toLowerCase() === value.toLowerCase())
                || enabledModels.find((model) => model.toLowerCase().includes(value.toLowerCase()));
            if (!match) {
                addMessage({ role: "System", content: "Model not found or not enabled." });
                setInput("");
                return true;
            }
            const provider = providerForModel(match);
            setActiveModel(provider, match);
            addMessage({ role: "System", content: `Model set to ${match}.` });
            setInput("");
            return true;
        }

        if (normalized === "provider") {
            const provider = value.toLowerCase();
            if (!provider) {
                addMessage({ role: "System", content: "Usage: /provider openai|gemini|anthropic|ollama" });
                setInput("");
                return true;
            }
            const providerModels = enabledModels.filter((model) => providerForModel(model) === provider);
            if (!providerModels.length) {
                addMessage({ role: "System", content: "No enabled models for that provider." });
                setInput("");
                return true;
            }
            setActiveModel(provider, providerModels[0]);
            addMessage({ role: "System", content: `Provider set to ${provider}.` });
            setInput("");
            return true;
        }

        addMessage({ role: "System", content: "Unknown command. Use /help for options." });
        setInput("");
        return true;
    };

    async function handleSend() {
        if (!input.trim()) return;
        if (handleSlashCommand(input)) return;

        if (imageAttachments.length > 0 && !supportsImages) {
            addMessage({ role: "System", content: "Image upload is not supported for the active model. Please switch to a vision-capable model." });
            return;
        }

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

        const attachments: Attachment[] = imageAttachments.map(({ previewUrl, ...rest }) => rest);
        const userMsg: Message = { role: "User", content: input, attachments: attachments.length ? attachments : undefined };
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
                temperature: tempValue,
                attachments
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
            clearImageAttachments();
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
            <div className="relative z-30 h-14 flex items-center px-6 justify-between border-b border-[var(--border)] bg-[var(--bg-base)]/50 backdrop-blur-md overflow-visible">
                <div className="flex flex-col">
                    <span className="text-sm font-bold text-zinc-100 tracking-tight">Agent Console</span>
                    <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-widest truncate max-w-[200px]">
                        {workspacePath ? workspacePath.split('/').pop() : 'No Workspace'}
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setEditorOpen(!isEditorOpen)}
                        className={clsx(
                            "p-1.5 rounded-md transition-colors",
                            isEditorOpen ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "hover:bg-[var(--bg-elevated)] text-gray-400"
                        )}
                        title={isEditorOpen ? "Hide observation window" : "Show observation window"}
                    >
                        <PanelRight size={16} />
                    </button>
                    {gitSummary && (() => {
                        const total = gitSummary.staged + gitSummary.unstaged + gitSummary.untracked + gitSummary.conflicted;
                        return (
                            <div className="relative flex items-center gap-2 text-[10px] text-zinc-400">
                                {gitSummary.branch && (
                                    <span className="px-2 py-1 rounded-full bg-[var(--bg-elevated)] text-zinc-500">
                                        {gitSummary.branch}
                                    </span>
                                )}
                                <button
                                    onClick={() => setShowGitDetails((prev) => !prev)}
                                    className={clsx(
                                        "px-2 py-1 rounded-full",
                                        total === 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-[var(--bg-elevated)] text-zinc-300"
                                    )}
                                >
                                    {total === 0 ? "Clean" : `Changes ${total}`}
                                </button>
                                {total > 0 && showGitDetails && gitSummary.files && (
                                    <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl overflow-hidden z-50">
                                        <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-zinc-500 border-b border-[var(--border)]">Changed Files</div>
                                        <div className="max-h-48 overflow-y-auto">
                                            {gitSummary.files.length === 0 ? (
                                                <div className="px-3 py-2 text-xs text-zinc-500">No changes</div>
                                            ) : (
                                                gitSummary.files.map((file) => (
                                                    <div key={file} className="px-3 py-2 text-xs text-zinc-300 border-b border-[var(--border)]/60 last:border-0 truncate">
                                                        {file}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}
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
                usage={usage}
                contextMeta={contextMeta}
            />
            <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto p-6 space-y-4 scroll-smooth">
                <div className="mx-auto w-full max-w-[1100px] min-h-full flex flex-col">
                    {messages.length === 0 && (
                        <div className="flex-1 flex flex-col items-center justify-center text-center opacity-30 px-12">
                            <Sparkles size={48} className="mb-4 text-[var(--accent)]" />
                            <h3 className="text-lg font-medium mb-2">How can I help you build today?</h3>
                            <p className="text-sm">I can edit files, run terminal commands, and reason about your code architecture.</p>
                        </div>
                    )}

                    <ActivityStream 
                        messages={messages} 
                        isLoading={loading}
                        view={activityView}
                        meta={{ mode: activeMode, model: activeModelId }}
                    />
                </div>
            </div>
            
            {/* Input Area */}
            <div className="relative z-40 p-6 bg-gradient-to-t from-[var(--bg-base)] via-[var(--bg-base)] to-transparent sticky bottom-0">
                <div className="mx-auto w-full max-w-[1100px]">
                    <div className="relative group bg-[var(--bg-surface)] rounded-2xl border border-[var(--border)] focus-within:border-[var(--accent)] transition-all shadow-2xl overflow-visible">
                        {imageAttachments.length > 0 && (
                            <div className="flex flex-wrap gap-2 px-4 pt-4">
                                {imageAttachments.map((attachment, index) => (
                                    <div key={`${attachment.name}-${index}`} className="relative group">
                                        <img
                                            src={attachment.previewUrl}
                                            alt={attachment.name}
                                            className="w-16 h-16 rounded-lg object-cover border border-[var(--border)]"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => removeImageAttachment(index)}
                                            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Remove"
                                        >
                                            x
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {mentionBadges.length > 0 && (
                            <div className="flex flex-wrap gap-2 px-4 pt-3">
                                {mentionBadges.map((mention) => (
                                    <div
                                        key={mention.path}
                                        className="group flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/60 px-3 py-1 text-[11px] text-zinc-200"
                                        title={mention.relative}
                                    >
                                        <span className="text-[10px] text-zinc-500">@</span>
                                        <span className="max-w-[240px] truncate font-medium">{mention.name}</span>
                                        <div className="flex items-center gap-1 pl-1 border-l border-[var(--border)]/60">
                                            <button
                                                type="button"
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={() => replaceMention(mention.path)}
                                                className="p-1 rounded-full text-zinc-400 hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                                                title="Replace mention"
                                                aria-label="Replace mention"
                                            >
                                                <Pencil size={12} />
                                            </button>
                                            <button
                                                type="button"
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={() => removeMention(mention.path)}
                                                className="p-1 rounded-full text-zinc-400 hover:text-red-300 hover:bg-red-500/10"
                                                title="Remove mention"
                                                aria-label="Remove mention"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="relative">
                            <div
                                ref={textareaOverlayRef}
                                aria-hidden
                                className="pointer-events-none absolute inset-0 overflow-hidden p-4 pr-16 text-[var(--text-primary)] font-sans text-sm whitespace-pre-wrap break-words"
                            >
                                {highlightedInput}
                            </div>
                            <textarea
                                ref={textareaRef}
                                className="w-full bg-transparent p-4 pr-16 text-transparent caret-[var(--text-primary)] placeholder-zinc-600 focus:outline-none resize-none font-sans text-sm min-h-[60px] whitespace-pre-wrap break-words selection:bg-[var(--accent)]/30 selection:text-[var(--text-primary)]"
                                rows={2}
                                value={input}
                                onChange={e => {
                                    setInput(e.target.value);
                                    setCursorPosition(e.target.selectionStart);
                                    const nextValue = e.target.value;
                                    const slashOpen = /\/(\w*)$/.test(nextValue.slice(0, e.target.selectionStart));
                                    setShowCommandPalette(slashOpen);
                                    if (!slashOpen) {
                                        setCommandIndex(0);
                                    }
                                }}
                                onSelect={e => setCursorPosition(e.currentTarget.selectionStart)}
                                onKeyUp={e => setCursorPosition(e.currentTarget.selectionStart)}
                                onScroll={e => {
                                    if (textareaOverlayRef.current) {
                                        textareaOverlayRef.current.scrollTop = e.currentTarget.scrollTop;
                                        textareaOverlayRef.current.scrollLeft = e.currentTarget.scrollLeft;
                                    }
                                }}
                                onKeyDown={e => {
                                    if (showCommandPalette && slashItems.length > 0) {
                                        if (e.key === "ArrowDown") {
                                            e.preventDefault();
                                            setCommandIndex((idx) => (idx + 1) % slashItems.length);
                                            return;
                                    }
                                    if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        setCommandIndex((idx) => (idx - 1 + slashItems.length) % slashItems.length);
                                        return;
                                    }
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        const selected = slashItems[commandIndex];
                                        if (selected) {
                                            insertCommand(selected.value);
                                        }
                                        return;
                                    }
                                    if (e.key === "Escape") {
                                        setShowCommandPalette(false);
                                        return;
                                    }
                                }

                                if (!showCommandPalette && mentionSuggestions.length > 0) {
                                    if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        setMentionIndex((idx) => (idx + 1) % mentionSuggestions.length);
                                        return;
                                    }
                                    if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        setMentionIndex((idx) => (idx - 1 + mentionSuggestions.length) % mentionSuggestions.length);
                                        return;
                                    }
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        const selected = mentionSuggestions[mentionIndex];
                                        if (selected) {
                                            insertMention(selected.relative);
                                        }
                                        return;
                                    }
                                    if (e.key === "Escape") {
                                        return;
                                    }
                                }

                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                                }}
                                placeholder="Explain your changes or ask a question..."
                            />
                        </div>
                        {((mentionQuery !== null) || showCommandPalette) && (
                            <div
                                className="absolute left-4 bottom-full mb-2 w-96 rounded-2xl border border-[var(--border)] bg-[var(--bg-base)] shadow-2xl overflow-hidden z-[60] ring-1 ring-black/40 pointer-events-auto"
                                style={{
                                    backgroundColor: "var(--bg-base)",
                                    opacity: 1,
                                    backdropFilter: "none",
                                    filter: "none",
                                    mixBlendMode: "normal",
                                    isolation: "isolate"
                                }}
                            >
                                <div className="px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500 border-b border-[var(--border)] bg-[var(--bg-base)] flex items-center justify-between">
                                    <span>{showCommandPalette ? "Commands" : "Files"}</span>
                                    <span className="text-[9px] tracking-[0.2em] text-zinc-600">{showCommandPalette ? "Slash" : "At"}</span>
                                </div>
                                <div className="max-h-56 overflow-y-auto">
                                    {showCommandPalette && commandItems.length > 0 && (
                                        <div className="px-4 py-2 text-[9px] uppercase tracking-[0.2em] text-zinc-600">Commands</div>
                                    )}
                                    {showCommandPalette && commandItems.map((cmd, index) => (
                                        <button
                                            key={cmd.key}
                                            type="button"
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => insertCommand(cmd.value)}
                                            className={clsx(
                                                "w-full text-left px-4 py-2 text-xs flex items-center justify-between",
                                                index === commandIndex
                                                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                                                    : "text-zinc-300 hover:bg-[var(--bg-elevated)]"
                                            )}
                                        >
                                            <span className="font-mono">/{cmd.key}</span>
                                            <span className="text-[10px] text-zinc-500">{cmd.detail}</span>
                                        </button>
                                    ))}
                                    {showCommandPalette && toolItems.length > 0 && (
                                        <div className="px-4 py-2 text-[9px] uppercase tracking-[0.2em] text-zinc-600">Tools</div>
                                    )}
                                    {showCommandPalette && toolItems.map((cmd, index) => {
                                        const globalIndex = commandItems.length + index;
                                        return (
                                            <button
                                                key={cmd.key}
                                                type="button"
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={() => insertCommand(cmd.value)}
                                                className={clsx(
                                                    "w-full text-left px-4 py-2 text-xs flex items-center justify-between",
                                                    globalIndex === commandIndex
                                                        ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                                                        : "text-zinc-300 hover:bg-[var(--bg-elevated)]"
                                                )}
                                            >
                                                <span className="font-mono">{cmd.key}</span>
                                                <span className="text-[10px] text-zinc-500">{cmd.detail}</span>
                                            </button>
                                        );
                                    })}
                                    {showCommandPalette && slashItems.length === 0 && (
                                        <div className="px-4 py-3 text-xs text-zinc-500">No matching commands.</div>
                                    )}
                                    {!showCommandPalette && mentionSuggestions.map((item, index) => (
                                        <button
                                            key={item.path}
                                            type="button"
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => insertMention(item.relative)}
                                            className={clsx(
                                                "w-full text-left px-4 py-2 text-xs",
                                                index === mentionIndex
                                                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                                                    : "text-zinc-300 hover:bg-[var(--bg-elevated)]"
                                            )}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="font-medium">{item.name}</span>
                                                <span className="text-[10px] text-zinc-500 truncate max-w-[220px]">{item.relative}</span>
                                            </div>
                                        </button>
                                    ))}
                                    {!showCommandPalette && mentionSuggestions.length === 0 && (
                                        <div className="px-4 py-3 text-xs text-zinc-500">
                                            {workspacePath ? (isFetchingFiles ? "Indexing files..." : "No files found. Refresh the file tree.") : "Select a workspace to search files."}
                                        </div>
                                    )}
                                </div>
                                <div className="px-4 py-2 border-t border-[var(--border)] text-[10px] text-zinc-500 bg-[var(--bg-base)]">
                                    {showCommandPalette ? "Type to filter commands." : "Type to filter files."}
                                </div>
                            </div>
                        )}
                        
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
                                <input
                                    ref={imageInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    className="hidden"
                                    onChange={handleImageSelect}
                                />
                                <button
                                    type="button"
                                    onClick={() => imageInputRef.current?.click()}
                                    disabled={!supportsImages}
                                    className={clsx(
                                        "p-2 rounded-lg transition-colors",
                                        supportsImages ? "hover:bg-zinc-800 text-zinc-500" : "text-zinc-700 cursor-not-allowed"
                                    )}
                                    title={supportsImages ? "Add Image" : "Image upload not supported for this model"}
                                >
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
            </div>
            
            {/* Question Modal for agent interactions */}
            <QuestionModal />
        </div>
    );
}
