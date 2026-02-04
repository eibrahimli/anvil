import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Sparkles, X, ArrowUpRight, Play } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { useProviderStore } from '../stores/provider';
import { useUIStore } from '../stores/ui';

export function Terminal() {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const lineBufferRef = useRef<string>('');
    const promptInputRef = useRef<HTMLInputElement>(null);
    const terminalReadyRef = useRef(false);
    const terminalStartedRef = useRef(false);
    const lastWorkspaceRef = useRef<string | null>(null);
    const outputLineBufferRef = useRef<string>('');
    const outputLinesRef = useRef<string[]>([]);
    const fitRafRef = useRef<number | null>(null);
    const [suggestionOpen, setSuggestionOpen] = useState(false);
    const [suggestionPrompt, setSuggestionPrompt] = useState('');
    const [suggestionLoading, setSuggestionLoading] = useState(false);
    const [suggestionError, setSuggestionError] = useState<string | null>(null);
    const [suggestionCommand, setSuggestionCommand] = useState<string | null>(null);
    const [suggestionRationale, setSuggestionRationale] = useState<string | null>(null);
    const [suggestionRisk, setSuggestionRisk] = useState<'low' | 'medium' | 'high' | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [explainOpen, setExplainOpen] = useState(false);
    const [explainLoading, setExplainLoading] = useState(false);
    const [explainError, setExplainError] = useState<string | null>(null);
    const [explainText, setExplainText] = useState<string | null>(null);
    const { sessionId, setSessionId, workspacePath } = useStore();
    const { activeModelId, activeProviderId, apiKeys } = useProviderStore();
    const { setSettingsOpen } = useUIStore();

    useEffect(() => {
        if (!terminalRef.current) return;

        const term = new XTerm({
            theme: {
                background: '#09090B',
                foreground: '#F4F4F5',
                cursor: '#8B5CF6',
                selectionBackground: 'rgba(139, 92, 246, 0.3)',
            },
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 13,
            cursorBlink: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        
        term.open(terminalRef.current);
        fitAddon.fit();

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;
        terminalReadyRef.current = true;

        // Initialize backend terminal
        if (workspacePath && terminalReadyRef.current && !terminalStartedRef.current) {
            invoke('spawn_terminal', { workspacePath }).catch(console.error);
            terminalStartedRef.current = true;
            lastWorkspaceRef.current = workspacePath;
        }

        // Handle Input
        term.onData((data) => {
            if (suggestionOpen) {
                if (data === '\u001b') {
                    setSuggestionOpen(false);
                }
                return;
            }

            if (data === '#') {
                if (lineBufferRef.current.length === 0) {
                    setSuggestionOpen(true);
                    setSuggestionPrompt('');
                    setSuggestionCommand(null);
                    setSuggestionRationale(null);
                    setSuggestionRisk(null);
                    setSuggestionError(null);
                    return;
                }
            }

            for (const char of data) {
                if (char === '\r' || char === '\n') {
                    lineBufferRef.current = '';
                } else if (char === '\u007f') {
                    lineBufferRef.current = lineBufferRef.current.slice(0, -1);
                } else {
                    lineBufferRef.current += char;
                }
            }

            invoke('write_terminal', { data });
        });

        // Listen for backend data
        const unlisten = listen<string>('term-data', (event) => {
            term.write(event.payload);
            updateOutputBuffer(event.payload);
        });

        const scheduleFit = () => {
            if (fitRafRef.current !== null) return;
            fitRafRef.current = window.requestAnimationFrame(() => {
                fitAddon.fit();
                invoke('resize_terminal', {
                    cols: term.cols,
                    rows: term.rows
                }).catch(console.error);
                fitRafRef.current = null;
            });
        };

        // Handle Resizing
        const resizeHandler = () => {
            scheduleFit();
        };
        window.addEventListener('resize', resizeHandler);

        const resizeObserver = new ResizeObserver(() => {
            scheduleFit();
        });
        resizeObserver.observe(terminalRef.current);

        return () => {
            window.removeEventListener('resize', resizeHandler);
            resizeObserver.disconnect();
            if (fitRafRef.current !== null) {
                window.cancelAnimationFrame(fitRafRef.current);
            }
            unlisten.then(f => f());
            term.dispose();
            terminalReadyRef.current = false;
            terminalStartedRef.current = false;
            lastWorkspaceRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!workspacePath) return;
        if (!xtermRef.current) return;
        if (!terminalReadyRef.current) return;
        if (!terminalStartedRef.current || workspacePath !== lastWorkspaceRef.current) {
            invoke('spawn_terminal', { workspacePath }).catch(console.error);
            terminalStartedRef.current = true;
            lastWorkspaceRef.current = workspacePath;
        }
    }, [workspacePath]);

    const updateOutputBuffer = (data: string) => {
        const cleaned = data.replace(/\r/g, '');
        const parts = cleaned.split('\n');

        if (parts.length === 1) {
            outputLineBufferRef.current += parts[0];
            return;
        }

        const first = parts.shift();
        if (first !== undefined) {
            outputLineBufferRef.current += first;
            pushOutputLine(outputLineBufferRef.current);
            outputLineBufferRef.current = '';
        }

        const last = parts.pop();
        for (const line of parts) {
            pushOutputLine(line);
        }
        outputLineBufferRef.current = last ?? '';
    };

    const pushOutputLine = (line: string) => {
        const maxLines = 200;
        const lines = outputLinesRef.current;
        lines.push(line);
        if (lines.length > maxLines) {
            lines.splice(0, lines.length - maxLines);
        }
    };

    const ansiRegex = useMemo(
        () => /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
        []
    );

    const getRecentOutput = () => {
        const recent = outputLinesRef.current.slice(-120).join('\n');
        const current = outputLineBufferRef.current;
        const merged = current ? `${recent}\n${current}` : recent;
        return merged.replace(ansiRegex, '').trim();
    };

    useEffect(() => {
        if (suggestionOpen) {
            promptInputRef.current?.focus();
        }
    }, [suggestionOpen]);

    type SessionResult = { sessionId: string; apiKey: string } | { error: string };

    const workflowTemplates = [
        "List recently modified files",
        "Find TODO comments in the project",
        "Run the test suite",
        "Install dependencies",
        "Show git status and recent changes",
        "Search for a string across the workspace"
    ];

    const parseSuggestion = (text: string) => {
        const trimmed = text.trim();
        const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]) as {
                    command?: string;
                    rationale?: string;
                    risk?: string;
                };
                return {
                    command: parsed.command || null,
                    rationale: parsed.rationale || null,
                    risk: (parsed.risk as 'low' | 'medium' | 'high' | undefined) || null,
                };
            } catch {
                // fall through
            }
        }

        const firstLine = trimmed.split('\n')[0]?.trim();
        return {
            command: firstLine || null,
            rationale: null,
            risk: null
        };
    };

    const ensureSession = async (): Promise<SessionResult> => {
        if (!workspacePath) {
            return { error: 'Select a workspace to continue.' };
        }

        const key = apiKeys[activeProviderId];
        if (!key && activeProviderId !== 'ollama') {
            setSettingsOpen(true);
            return { error: 'AI Provider not connected. Add an API key in Settings.' };
        }

        let currentSessionId = sessionId;
        if (!currentSessionId) {
            const sid = await invoke<string>('create_session', {
                workspacePath,
                apiKey: key || '',
                provider: activeProviderId,
                modelId: activeModelId
            });
            setSessionId(sid);
            currentSessionId = sid;
        }

        return { sessionId: currentSessionId, apiKey: key || '' };
    };

    const handleSuggestCommand = async () => {
        if (!suggestionPrompt.trim()) return;
        const session = await ensureSession().catch((e) => ({ error: String(e) }));
        if ('error' in session) {
            setSuggestionError(session.error);
            return;
        }
        const { sessionId: currentSessionId, apiKey } = session;

        setSuggestionLoading(true);
        setSuggestionError(null);
        try {
            const payload: Record<string, unknown> = {
                sessionId: currentSessionId,
                message: `You are a shell assistant. Suggest a safe single command for the request below. Do not call tools. Respond only with JSON {"command":"...","rationale":"...","risk":"low|medium|high"}.\n\nRequest: ${suggestionPrompt}`,
                modelId: activeModelId,
                mode: 'plan'
            };
            if (activeProviderId !== 'ollama') {
                payload.apiKey = apiKey || '';
            }

            const response = await invoke<string>('chat', payload);
            const parsed = parseSuggestion(response || '');
            setSuggestionCommand(parsed.command ?? null);
            setSuggestionRationale(parsed.rationale ?? null);
            setSuggestionRisk(parsed.risk ?? null);
        } catch (e) {
            const message = String(e);
            if (message.includes('Session not found')) {
                try {
                    setSessionId(null);
                    const sid = await invoke<string>('create_session', {
                        workspacePath,
                        apiKey: apiKey || '',
                        provider: activeProviderId,
                        modelId: activeModelId
                    });
                    setSessionId(sid);
                    const retryPayload: Record<string, unknown> = {
                        sessionId: sid,
                        message: `You are a shell assistant. Suggest a safe single command for the request below. Do not call tools. Respond only with JSON {"command":"...","rationale":"...","risk":"low|medium|high"}.\n\nRequest: ${suggestionPrompt}`,
                        modelId: activeModelId,
                        mode: 'plan'
                    };
                    if (activeProviderId !== 'ollama') {
                        retryPayload.apiKey = apiKey || '';
                    }
                    const response = await invoke<string>('chat', retryPayload);
                    const parsed = parseSuggestion(response || '');
                    setSuggestionCommand(parsed.command ?? null);
                    setSuggestionRationale(parsed.rationale ?? null);
                    setSuggestionRisk(parsed.risk ?? null);
                } catch (retryError) {
                    setSuggestionError(`Suggestion failed: ${String(retryError)}`);
                }
            } else {
                setSuggestionError(`Suggestion failed: ${String(e)}`);
            }
        } finally {
            setSuggestionLoading(false);
        }
    };

    const handleExplainOutput = async () => {
        const output = getRecentOutput();
        if (!output) {
            setExplainError('No terminal output to explain yet.');
            return;
        }
        const session = await ensureSession().catch((e) => ({ error: String(e) }));
        if ('error' in session) {
            setExplainError(session.error);
            return;
        }

        setExplainLoading(true);
        setExplainError(null);
        setExplainText(null);
        setExplainOpen(true);
        const { sessionId: currentSessionId, apiKey } = session;

        try {
            const payload: Record<string, unknown> = {
                sessionId: currentSessionId,
                message: `Explain the following terminal output. Focus on errors and next steps.\n\nOutput:\n\n${output}`,
                modelId: activeModelId,
                mode: 'plan'
            };
            if (activeProviderId !== 'ollama') {
                payload.apiKey = apiKey || '';
            }

            const response = await invoke<string>('chat', payload);
            setExplainText(response || 'No explanation returned.');
        } catch (e) {
            setExplainError(`Explain failed: ${String(e)}`);
        } finally {
            setExplainLoading(false);
        }
    };

    const handleInsertCommand = () => {
        if (!suggestionCommand) return;
        invoke('write_terminal', { data: suggestionCommand });
        setSuggestionOpen(false);
    };

    const handleRunCommand = () => {
        if (!suggestionCommand) return;
        invoke('write_terminal', { data: `${suggestionCommand}\n` });
        setSuggestionOpen(false);
    };

    return (
        <div
            className="w-full h-full bg-[#09090B] relative"
            onContextMenu={(event) => {
                event.preventDefault();
                const rect = terminalRef.current?.getBoundingClientRect();
                if (!rect) return;
                setContextMenu({ x: event.clientX - rect.left, y: event.clientY - rect.top });
            }}
        >
            <div ref={terminalRef} className="w-full h-full p-2" />
            {contextMenu && (
                <div
                    className="absolute inset-0"
                    onClick={() => setContextMenu(null)}
                >
                    <div
                        className="absolute z-20 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={() => {
                                setContextMenu(null);
                                handleExplainOutput();
                            }}
                            className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-200 hover:bg-[var(--bg-elevated)] rounded-lg"
                        >
                            Explain output
                        </button>
                    </div>
                </div>
            )}
            {suggestionOpen && (
                <div
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
                    onClick={() => setSuggestionOpen(false)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            setSuggestionOpen(false);
                        }
                    }}
                >
                    <div
                        className="w-full max-w-xl max-h-[calc(100vh-4rem)] my-6 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-base)]">
                            <div className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                                <Sparkles size={16} className="text-[var(--accent)]" />
                                Command Suggestion
                            </div>
                            <button
                                onClick={() => setSuggestionOpen(false)}
                                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                                title="Close"
                            >
                                <X size={14} />
                            </button>
                        </div>
                        <div className="p-4 space-y-3 flex-1 overflow-y-auto min-h-0">
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Describe your task</label>
                                <input
                                    ref={promptInputRef}
                                    value={suggestionPrompt}
                                    onChange={(e) => setSuggestionPrompt(e.target.value)}
                                    placeholder="e.g. list all JS files modified today"
                                    className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') {
                                            e.preventDefault();
                                            setSuggestionOpen(false);
                                            return;
                                        }
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleSuggestCommand();
                                        }
                                    }}
                                />
                            </div>

                            <div className="space-y-2">
                                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Quick templates</div>
                                <div className="flex flex-wrap gap-2">
                                    {workflowTemplates.map((template) => (
                                        <button
                                            key={template}
                                            onClick={() => {
                                                setSuggestionPrompt(template);
                                                setSuggestionError(null);
                                                promptInputRef.current?.focus();
                                            }}
                                            className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800/60"
                                        >
                                            {template}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {suggestionError && (
                                <div className="text-xs text-red-400">{suggestionError}</div>
                            )}

                            {suggestionCommand && (
                                <div className="rounded-lg border border-white/5 bg-[#0b0b0f] px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Suggested command</div>
                                    <div className="mt-1 font-mono text-sm text-zinc-100 break-all">{suggestionCommand}</div>
                                    {suggestionRationale && (
                                        <div className="mt-2 text-xs text-zinc-400">{suggestionRationale}</div>
                                    )}
                                    {suggestionRisk && (
                                        <div className={clsx(
                                            "mt-2 text-[10px] uppercase tracking-wider",
                                            suggestionRisk === 'low' && "text-green-400",
                                            suggestionRisk === 'medium' && "text-yellow-400",
                                            suggestionRisk === 'high' && "text-red-400"
                                        )}>
                                            Risk: {suggestionRisk}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-base)] flex items-center justify-between">
                            <span className="text-[10px] text-zinc-500">Trigger with # at a new prompt</span>
                            <div className="flex items-center gap-2">
                                {suggestionCommand && (
                                    <button
                                        onClick={handleInsertCommand}
                                        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/60"
                                    >
                                        <ArrowUpRight size={14} />
                                        Insert
                                    </button>
                                )}
                                {suggestionCommand && (
                                    <button
                                        onClick={handleRunCommand}
                                        className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-purple-900/20 hover:bg-[var(--accent)]/90"
                                    >
                                        <Play size={14} />
                                        Run
                                    </button>
                                )}
                                <button
                                    onClick={handleSuggestCommand}
                                    disabled={suggestionLoading}
                                    className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-60"
                                >
                                    <Sparkles size={14} className={clsx(suggestionLoading && 'animate-pulse')} />
                                    {suggestionLoading ? 'Generating' : 'Generate'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {explainOpen && (
                <div
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
                    onClick={() => setExplainOpen(false)}
                >
                    <div
                        className="w-full max-w-2xl max-h-[calc(100vh-4rem)] my-6 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-base)]">
                            <div className="text-sm font-bold text-zinc-100">Explain Output</div>
                            <button
                                onClick={() => setExplainOpen(false)}
                                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                                title="Close"
                            >
                                <X size={14} />
                            </button>
                        </div>
                        <div className="p-4 text-sm text-zinc-200 whitespace-pre-wrap flex-1 overflow-y-auto">
                            {explainLoading && "Analyzing output..."}
                            {explainError && <span className="text-red-400">{explainError}</span>}
                            {!explainLoading && !explainError && (explainText || "No explanation returned.")}
                        </div>
                        <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-base)] flex justify-end">
                            <button
                                onClick={() => setExplainOpen(false)}
                                className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/60"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
