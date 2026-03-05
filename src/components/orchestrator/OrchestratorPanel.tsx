import { X, Plus, Users, Play, Trash2, RefreshCw, CheckCircle, AlertCircle, Loader2, AlertTriangle, ChevronDown, Link2 } from 'lucide-react';
import { useOrchestratorStore, Agent, Task, OrchestratorExecutionMode, TaskGroupMode } from '../../stores/orchestrator';
import { useUIStore } from '../../stores/ui';
import { useProviderStore } from '../../stores/provider';
import { useConfirmationStore } from '../../stores/confirmation';
import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ConfirmDialog } from '../common/ConfirmDialog';

import { useStore } from '../../store';
import { mapProviderError, settingsTabLabel } from '../../utils/providerErrors';

interface OrchestratorPanelProps {
    onClose?: () => void;
}

export function OrchestratorPanel({ onClose }: OrchestratorPanelProps) {
    const AUTO_AGENT = "__auto__";
    const storeAgents = useOrchestratorStore((state) => state.agents);
    const storeTasks = useOrchestratorStore((state) => state.tasks);
    const activeTaskId = useOrchestratorStore((state) => state.activeTask);
    const backendStatus = useOrchestratorStore((state) => state.backendStatus);
    const executionMode = useOrchestratorStore((state) => state.executionMode);
    const lastError = useOrchestratorStore((state) => state.lastError);
    const {
        addAgent,
        addTask,
        cancelTask,
        clearAgents,
        clearTasks,
        initOrchestrator,
        loadOrchestratorState,
        removeAgent,
        retryTask,
        setExecutionMode,
        processTasks,
        restorePersistedState,
        clearError
    } = useOrchestratorStore();
    const { setOrchestratorOpen, openSettingsTab } = useUIStore();
    const { activeModelId, activeProviderId, apiKeys, openaiAuthMethod, setOpenAIAuthMethod } = useProviderStore();
    const pendingConfirmationCount = useConfirmationStore((state) =>
        Object.values(state.pendingBySession).reduce((count, queue) => count + queue.length, 0)
    );
    const { workspacePath } = useStore();

    const [processing, setProcessing] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [addAgentDialogOpen, setAddAgentDialogOpen] = useState(false);
    const [selectedRole, setSelectedRole] = useState<Agent['role']>('Coder');
    const [taskDialogOpen, setTaskDialogOpen] = useState(false);
    const [taskDescription, setTaskDescription] = useState("");
    const [preferredTaskAgentId, setPreferredTaskAgentId] = useState<string>(AUTO_AGENT);
    const [taskAgentFilter, setTaskAgentFilter] = useState<string>("all");
    const [taskGroupId, setTaskGroupId] = useState("");
    const [taskGroupMode, setTaskGroupMode] = useState<TaskGroupMode>("parallel");
    const [runAfterPreviousTask, setRunAfterPreviousTask] = useState(false);
    const [agentToRemove, setAgentToRemove] = useState<Agent | null>(null);
    const [taskToCancel, setTaskToCancel] = useState<Task | null>(null);
    const [agentActionPendingId, setAgentActionPendingId] = useState<string | null>(null);
    const [taskActionPendingKey, setTaskActionPendingKey] = useState<string | null>(null);
    const [restoreAttemptedWorkspace, setRestoreAttemptedWorkspace] = useState<string | null>(null);
    const [preflightError, setPreflightError] = useState<string | null>(null);
    const [preflightFixTab, setPreflightFixTab] = useState<"providers" | "models" | "oauth" | null>(null);

    useEffect(() => {
        if (!workspacePath) return;
        if (restoreAttemptedWorkspace === workspacePath) return;
        setRestoreAttemptedWorkspace(workspacePath);

        let cancelled = false;
        void (async () => {
            const initialized = await initOrchestrator(workspacePath);
            if (!initialized || cancelled) {
                return;
            }
            await restorePersistedState(workspacePath, apiKeys, openaiAuthMethod);
        })();

        return () => {
            cancelled = true;
        };
    }, [
        apiKeys,
        initOrchestrator,
        openaiAuthMethod,
        restoreAttemptedWorkspace,
        restorePersistedState,
        workspacePath
    ]);

    const handleOpenAddAgentDialog = () => {
        setSelectedRole('Coder');
        setAddAgentDialogOpen(true);
    };

    const handleOpenTaskDialog = () => {
        setTaskDescription("");
        setPreferredTaskAgentId(AUTO_AGENT);
        setTaskGroupId("");
        setTaskGroupMode("parallel");
        setTaskDialogOpen(true);
    };

    const handleConfirmAddAgent = async () => {
        if (!workspacePath) return;

        let apiKey = apiKeys[activeProviderId] || '';
        if (activeProviderId === "openai" && (openaiAuthMethod === "oauth" || !apiKey)) {
            try {
                const oauthToken = await invoke<string>("oauth_get_access_token", { providerId: "chatgpt" });
                if (oauthToken) {
                    apiKey = oauthToken;
                    if (openaiAuthMethod !== "oauth") {
                        setOpenAIAuthMethod("oauth");
                    }
                }
            } catch (_) {
                if (openaiAuthMethod === "oauth") {
                    return;
                }
            }
        }

        const created = await addAgent(
            {
                id: crypto.randomUUID(),
                role: selectedRole,
                modelId: activeModelId,
                providerId: activeProviderId
            },
            apiKey,
            workspacePath
        );

        if (created) {
            setAddAgentDialogOpen(false);
        }
    };

    const handleProcessTasks = async () => {
        setPreflightError(null);
        setPreflightFixTab(null);

        const hasOpenAIAgents = storeAgents.some((agent) => agent.providerId === "openai");
        if (hasOpenAIAgents && openaiAuthMethod === "oauth") {
            const hasDefaultModel = storeAgents.some(
                (agent) => agent.providerId === "openai" && agent.modelId.trim().toLowerCase() === "default"
            );
            if (hasDefaultModel) {
                setPreflightError("Model \"default\" is not supported for ChatGPT Codex accounts. Select an explicit model before processing tasks.");
                setPreflightFixTab("models");
                return;
            }

            try {
                const oauthStatus = await invoke<Record<string, { connected: boolean; expiresAt?: number }>>("oauth_token_status");
                const chatgptStatus = oauthStatus?.chatgpt;
                if (!chatgptStatus?.connected) {
                    setPreflightError("OpenAI OAuth is disconnected. Reconnect before running orchestration tasks.");
                    setPreflightFixTab("oauth");
                    return;
                }
                if (chatgptStatus.expiresAt && Date.now() > chatgptStatus.expiresAt) {
                    setPreflightError("OpenAI OAuth token is expired. Reconnect before running orchestration tasks.");
                    setPreflightFixTab("oauth");
                    return;
                }
            } catch (_) {
                // Best-effort preflight: continue if status lookup fails.
            }
        }

        setProcessing(true);
        await processTasks();
        setProcessing(false);
    };

    const handleCreateTask = async () => {
        if (taskValidationMessage) return;
        const normalized = taskDescription.trim();
        if (!normalized) return;
        const preferredAgentId =
            preferredTaskAgentId !== AUTO_AGENT ? preferredTaskAgentId : undefined;
        const normalizedGroupId = taskGroupId.trim() ? taskGroupId.trim() : undefined;
        const normalizedGroupMode = normalizedGroupId ? taskGroupMode : undefined;

        const created = await addTask(
            normalized,
            runAfterPreviousTask,
            preferredAgentId,
            normalizedGroupId,
            normalizedGroupMode
        );
        if (created) {
            setTaskDialogOpen(false);
        }
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        await loadOrchestratorState();
        setRefreshing(false);
    };

    const handleExecutionModeChange = async (mode: OrchestratorExecutionMode) => {
        await setExecutionMode(mode);
    };

    const handleConfirmRemoveAgent = async () => {
        if (!agentToRemove) return;
        setAgentActionPendingId(agentToRemove.id);
        const removed = await removeAgent(agentToRemove.id);
        setAgentActionPendingId(null);
        if (removed) {
            setAgentToRemove(null);
        }
    };

    const handleConfirmCancelTask = async () => {
        if (!taskToCancel) return;
        const pendingKey = `cancel:${taskToCancel.id}`;
        setTaskActionPendingKey(pendingKey);
        const cancelled = await cancelTask(taskToCancel.id);
        setTaskActionPendingKey(null);
        if (cancelled) {
            setTaskToCancel(null);
        }
    };

    const handleRetryTask = async (taskId: string) => {
        const pendingKey = `retry:${taskId}`;
        setTaskActionPendingKey(pendingKey);
        await retryTask(taskId);
        setTaskActionPendingKey(null);
    };

    const getRoleIcon = (role: Agent['role']) => {
        switch (role) {
            case 'Coder': return '💻';
            case 'Reviewer': return '👁';
            case 'Planner': return '📋';
            case 'Debugger': return '🐛';
            default: return '🤖';
        }
    };

    const getRoleColor = (role: Agent['role']) => {
        switch (role) {
            case 'Coder': return 'bg-blue-500';
            case 'Reviewer': return 'bg-purple-500';
            case 'Planner': return 'bg-green-500';
            case 'Debugger': return 'bg-orange-500';
            default: return 'bg-gray-500';
        }
    };

    const getTaskStatusIcon = (status: Task['status']) => {
        switch (status) {
            case 'Pending': return <AlertCircle size={16} className="text-zinc-500" />;
            case 'InProgress': return <Loader2 size={16} className="text-blue-500 animate-spin" />;
            case 'Completed': return <CheckCircle size={16} className="text-green-500" />;
            case 'Failed': return <AlertCircle size={16} className="text-red-500" />;
        }
    };

    const getTaskStatusLabelClass = (status: Task['status']) => {
        switch (status) {
            case 'Pending':
                return "border-zinc-600/60 bg-zinc-800/60 text-zinc-300";
            case 'InProgress':
                return "border-blue-500/40 bg-blue-500/10 text-blue-200";
            case 'Completed':
                return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
            case 'Failed':
                return "border-red-500/40 bg-red-500/10 text-red-200";
        }
    };

    const getAssignmentReason = (task: Task): "preferred" | "auto" | "fallback" | null => {
        if (!task.assignedTo) return null;
        if (task.preferredAgentId && task.preferredAgentId === task.assignedTo) {
            return "preferred";
        }
        if (task.preferredAgentId && task.preferredAgentId !== task.assignedTo) {
            return "fallback";
        }
        return "auto";
    };

    const getAssignmentReasonLabel = (reason: "preferred" | "auto" | "fallback" | null) => {
        switch (reason) {
            case "preferred":
                return "Preferred";
            case "fallback":
                return "Fallback";
            case "auto":
                return "Auto Role Match";
            default:
                return null;
        }
    };

    const getAssignmentReasonClass = (reason: "preferred" | "auto" | "fallback" | null) => {
        switch (reason) {
            case "preferred":
                return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
            case "fallback":
                return "border-amber-500/40 bg-amber-500/10 text-amber-200";
            case "auto":
                return "border-blue-500/40 bg-blue-500/10 text-blue-200";
            default:
                return "border-zinc-700 text-zinc-400";
        }
    };

    const getFailureType = (task: Task): 'timeout' | 'cancelled' | 'failed' => {
        if (task.status !== 'Failed') return 'failed';
        const detail = (task.result || '').toLowerCase();
        if (detail.includes('timed out')) return 'timeout';
        if (detail.includes('cancelled by user')) return 'cancelled';
        return 'failed';
    };

    const getFailureBadgeClass = (type: 'timeout' | 'cancelled' | 'failed') => {
        switch (type) {
            case 'timeout':
                return "border-amber-500/40 bg-amber-500/10 text-amber-200";
            case 'cancelled':
                return "border-orange-500/40 bg-orange-500/10 text-orange-200";
            default:
                return "border-red-500/40 bg-red-500/10 text-red-200";
        }
    };

    const getFailureBadgeLabel = (type: 'timeout' | 'cancelled' | 'failed') => {
        switch (type) {
            case 'timeout':
                return 'Timed Out';
            case 'cancelled':
                return 'Cancelled';
            default:
                return 'Failed';
        }
    };

    const getResultSummary = (task: Task) => {
        if (!task.result) return null;
        if (task.status !== 'Failed') return null;
        const mapped = mapProviderError(task.result);
        if (mapped) {
            return mapped.message;
        }
        const failureType = getFailureType(task);
        if (failureType === 'timeout') {
            return 'Execution timed out before the model returned a final result.';
        }
        if (failureType === 'cancelled') {
            return 'Execution was cancelled by user action.';
        }
        return 'Execution failed. Review details below.';
    };

    const formatAssignedAgent = (assignedTo?: string) => {
        if (!assignedTo) return null;
        const agent = storeAgents.find((candidate) => candidate.id === assignedTo);
        const shortId = `${assignedTo.substring(0, 8)}...`;
        if (!agent) {
            return shortId;
        }
        return `${agent.role} / ${agent.modelId} (${shortId})`;
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        }).format(date);
    };

    const handleClose = () => {
        if (onClose) onClose();
        setOrchestratorOpen(false);
    };

    const backendLabel =
        backendStatus === 'ready'
            ? 'Connected'
            : backendStatus === 'initializing'
            ? 'Connecting'
            : backendStatus === 'error'
            ? 'Disconnected'
            : 'Idle';

    const taskValidationMessage = useMemo(() => {
        if (!taskDescription.trim()) {
            return "Task description is required.";
        }
        if (runAfterPreviousTask && storeTasks.length === 0) {
            return "Chain mode requires at least one existing task.";
        }
        const normalizedGroupId = taskGroupId.trim();
        if (normalizedGroupId && !/^[a-zA-Z0-9._-]+$/.test(normalizedGroupId)) {
            return "Group ID can only include letters, numbers, '.', '_' and '-'.";
        }
        if (runAfterPreviousTask && normalizedGroupId && taskGroupMode === "parallel") {
            return "Chained tasks inside a group must use Sequential group mode.";
        }
        return null;
    }, [runAfterPreviousTask, storeTasks.length, taskDescription, taskGroupId, taskGroupMode]);

    const filteredTasks = storeTasks.filter((task) => {
        if (taskAgentFilter === "all") return true;
        if (taskAgentFilter === "__unassigned__") return !task.assignedTo;
        return task.assignedTo === taskAgentFilter;
    });

    const mappedLastError = useMemo(() => {
        if (!lastError) return null;
        return mapProviderError(lastError);
    }, [lastError]);
    const mappedLastErrorFixTab = mappedLastError?.fixTab ?? null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center animate-in fade-in duration-300">
            <div className="w-[1200px] h-[700px] bg-[var(--bg-surface)] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-[var(--border)] flex flex-col overflow-hidden scale-in-center animate-in zoom-in-95 duration-200">
                <div className="h-12 border-b border-[var(--border)] flex items-center justify-between px-4 bg-[var(--bg-surface)]/50">
                    <div className="flex items-center gap-2">
                        <Users size={18} className="text-[var(--accent)]" />
                        <span className="font-bold text-sm text-zinc-100">Multi-Agent Orchestration</span>
                        <span
                            className={clsx(
                                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                                backendStatus === 'ready' && "border-emerald-500/30 text-emerald-300",
                                backendStatus === 'initializing' && "border-blue-500/30 text-blue-300",
                                backendStatus === 'error' && "border-red-500/30 text-red-300",
                                backendStatus === 'idle' && "border-zinc-700 text-zinc-500"
                            )}
                        >
                            {backendLabel}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <select
                                className="appearance-none rounded-lg border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-primary)] pl-3 pr-8 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] outline-none focus:border-[var(--accent)]"
                                style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
                                value={executionMode}
                                onChange={(e) => {
                                    void handleExecutionModeChange(e.target.value as OrchestratorExecutionMode);
                                }}
                                disabled={backendStatus !== 'ready'}
                                title="Task execution mode"
                            >
                                <option value="parallel" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Parallel</option>
                                <option value="sequential" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Sequential</option>
                            </select>
                            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        </div>
                        <button
                            onClick={handleRefresh}
                            disabled={refreshing || backendStatus !== 'ready'}
                            className={clsx(
                                "p-1.5 rounded-lg text-zinc-400 transition-all",
                                backendStatus === 'ready' ? "hover:bg-[var(--bg-elevated)] hover:text-zinc-100" : "opacity-50 cursor-not-allowed"
                            )}
                            title="Refresh"
                        >
                            <RefreshCw size={16} className={clsx(refreshing && "animate-spin")} />
                        </button>
                        <button
                            onClick={handleProcessTasks}
                            disabled={processing || storeTasks.length === 0 || backendStatus !== 'ready'}
                            className={clsx(
                                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-tighter transition-all",
                                processing
                                    ? "bg-[var(--accent)]/50 text-zinc-400"
                                    : "bg-[var(--accent)] text-white hover:bg-[var(--accent)]/80 disabled:opacity-50"
                            )}
                        >
                            {processing ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <Play size={14} />
                                    Process Tasks
                                </>
                            )}
                        </button>
                        <button
                            onClick={() => setClearConfirmOpen(true)}
                            className="p-1.5 hover:bg-[var(--bg-elevated)] rounded-lg text-zinc-400 hover:text-red-500 transition-all"
                            title="Clear All"
                        >
                            <Trash2 size={16} />
                        </button>
                        <button
                            onClick={handleClose}
                            className="p-1.5 hover:bg-[var(--bg-elevated)] rounded-lg text-zinc-400 hover:text-white transition-all"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {preflightError && (
                    <div className="mx-4 mt-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300 flex items-center justify-between gap-2">
                        <span className="truncate">{preflightError}</span>
                        <div className="flex items-center gap-2">
                            {preflightFixTab && (
                                <button
                                    onClick={() => openSettingsTab(preflightFixTab)}
                                    className="text-[10px] uppercase tracking-[0.15em] text-red-100 hover:text-white"
                                >
                                    Fix now
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    setPreflightError(null);
                                    setPreflightFixTab(null);
                                }}
                                className="text-[10px] uppercase tracking-[0.15em] text-red-200 hover:text-white"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                )}

                {lastError && (
                    <div className="mx-4 mt-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300 flex items-center justify-between gap-2">
                        <span className="truncate">{mappedLastError?.message ?? lastError}</span>
                        <div className="flex items-center gap-2">
                            {mappedLastErrorFixTab && (
                                <button
                                    onClick={() => openSettingsTab(mappedLastErrorFixTab)}
                                    className="text-[10px] uppercase tracking-[0.15em] text-red-100 hover:text-white"
                                    title={`Open Settings → ${settingsTabLabel(mappedLastErrorFixTab)}`}
                                >
                                    Fix now
                                </button>
                            )}
                            <button
                                onClick={clearError}
                                className="text-[10px] uppercase tracking-[0.15em] text-red-200 hover:text-white"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                )}

                {pendingConfirmationCount > 0 && (
                    <div className="mx-4 mt-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200 flex items-center justify-between gap-2">
                        <span>
                            Waiting for approval ({pendingConfirmationCount}) before orchestration can continue.
                        </span>
                    </div>
                )}

                <div className="flex-1 flex overflow-hidden">
                    <div className="w-64 border-r border-[var(--border)] flex flex-col bg-[var(--bg-base)]">
                        <div className="p-3 border-b border-[var(--border)]">
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-bold text-xs text-zinc-400 uppercase tracking-widest">Agents</span>
                                <button
                                    onClick={handleOpenAddAgentDialog}
                                    disabled={backendStatus !== 'ready'}
                                    className={clsx(
                                        "p-1 rounded-md transition-all",
                                        backendStatus === 'ready'
                                            ? "hover:bg-[var(--bg-elevated)] text-zinc-400 hover:text-[var(--accent)]"
                                            : "text-zinc-600 cursor-not-allowed"
                                    )}
                                    title="Add Agent"
                                >
                                    <Plus size={14} />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto p-3 space-y-2">
                            {storeAgents.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-48 text-zinc-500">
                                    <Users size={32} className="mb-2 opacity-20" />
                                    <p className="text-xs text-center">No agents yet. Add an agent to get started.</p>
                                </div>
                            ) : (
                                storeAgents.map((agent) => (
                                    <div
                                        key={agent.id}
                                        className="group flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-elevated)]/50 border border-transparent hover:border-[var(--border)] transition-all"
                                    >
                                        <div className={clsx(
                                            "w-8 h-8 rounded-md flex items-center justify-center text-lg",
                                            getRoleColor(agent.role)
                                        )}>
                                            {getRoleIcon(agent.role)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-xs text-zinc-100">{agent.role}</span>
                                                    <span className="text-[10px] text-zinc-500 font-mono">{agent.modelId}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className={clsx(
                                                        "text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full",
                                                        agent.status === 'idle' && "bg-zinc-600 text-zinc-400",
                                                        agent.status === 'working' && "bg-green-500/10 text-green-400",
                                                        agent.status === 'completed' && "bg-blue-500/10 text-blue-400",
                                                        agent.status === 'error' && "bg-red-500/10 text-red-400"
                                                    )}>
                                                        {agent.status}
                                                    </div>
                                                    <button
                                                        onClick={() => setAgentToRemove(agent)}
                                                        disabled={backendStatus !== 'ready' || agentActionPendingId !== null}
                                                        className={clsx(
                                                            "p-1 rounded-md text-zinc-500 transition-all",
                                                            "opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-300",
                                                            (backendStatus !== 'ready' || agentActionPendingId !== null) && "opacity-40 cursor-not-allowed"
                                                        )}
                                                        title="Remove agent"
                                                    >
                                                        {agentActionPendingId === agent.id ? (
                                                            <Loader2 size={12} className="animate-spin" />
                                                        ) : (
                                                            <Trash2 size={12} />
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="flex-1 flex flex-col bg-[var(--bg-base)]">
                        <div className="p-3 border-b border-[var(--border)]">
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-bold text-xs text-zinc-400 uppercase tracking-widest">Task Queue</span>
                                <div className="flex items-center gap-2">
                                    <div className="relative">
                                        <select
                                            className="appearance-none rounded-md border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-primary)] pl-2 pr-7 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] outline-none focus:border-[var(--accent)]"
                                            style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
                                            value={taskAgentFilter}
                                            onChange={(e) => setTaskAgentFilter(e.target.value)}
                                            title="Filter tasks by agent"
                                        >
                                            <option value="all" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
                                                All Agents
                                            </option>
                                            <option value="__unassigned__" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
                                                Unassigned
                                            </option>
                                            {storeAgents.map((agent) => (
                                                <option
                                                    key={agent.id}
                                                    value={agent.id}
                                                    style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
                                                >
                                                    {agent.role} / {agent.modelId}
                                                </option>
                                            ))}
                                        </select>
                                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                                    </div>
                                    <button
                                        onClick={() => setRunAfterPreviousTask((prev) => !prev)}
                                        disabled={backendStatus !== 'ready'}
                                        className={clsx(
                                            "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-[0.08em] transition-all border",
                                            runAfterPreviousTask
                                                ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-200"
                                                : "border-[var(--border)] bg-[var(--bg-elevated)]/60 text-zinc-400 hover:text-zinc-200",
                                            backendStatus !== 'ready' && "opacity-60 cursor-not-allowed"
                                        )}
                                        title="If enabled, new tasks depend on the previous task (sequential chain)"
                                    >
                                        <Link2 size={12} />
                                        Chain
                                    </button>
                                    <button
                                        onClick={handleOpenTaskDialog}
                                        disabled={backendStatus !== 'ready'}
                                        className={clsx(
                                            "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold uppercase tracking-tighter transition-all",
                                            backendStatus === 'ready'
                                                ? "bg-[var(--accent)] text-white hover:bg-[var(--accent)]/80"
                                                : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                                        )}
                                    >
                                        <Plus size={12} />
                                        Add Task
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto p-3">
                            {filteredTasks.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-48 text-zinc-500">
                                    <Play size={32} className="mb-2 opacity-20" />
                                    <p className="text-xs text-center">
                                        {storeTasks.length === 0
                                            ? "No tasks yet. Create a task to begin orchestration."
                                            : "No tasks match this agent filter."}
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {filteredTasks.map((task) => (
                                        <div
                                            key={task.id}
                                            className={clsx(
                                                "p-3 rounded-xl border transition-all",
                                                (task.status === 'InProgress' || activeTaskId === task.id)
                                                    ? "border-[var(--accent)] bg-[var(--accent)]/5"
                                                    : "border-[var(--border)] bg-[var(--bg-elevated)]/50"
                                            )}
                                        >
                                            <div className="flex items-start gap-2">
                                                <div className="mt-0.5">
                                                    {getTaskStatusIcon(task.status)}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <p className="font-bold text-sm text-zinc-100">{task.description}</p>
                                                        <div className="flex items-center gap-2">
                                                            {(task.status === 'Pending' || task.status === 'InProgress') && (
                                                                <button
                                                                    onClick={() => setTaskToCancel(task)}
                                                                    disabled={backendStatus !== 'ready' || taskActionPendingKey !== null}
                                                                    className={clsx(
                                                                        "h-6 w-6 rounded-md border border-red-500/30 bg-red-500/10 text-red-200 flex items-center justify-center transition-all hover:bg-red-500/20",
                                                                        (backendStatus !== 'ready' || taskActionPendingKey !== null) && "opacity-50 cursor-not-allowed"
                                                                    )}
                                                                    title="Cancel task"
                                                                >
                                                                    {taskActionPendingKey === `cancel:${task.id}` ? (
                                                                        <Loader2 size={12} className="animate-spin" />
                                                                    ) : (
                                                                        <X size={12} />
                                                                    )}
                                                                </button>
                                                            )}
                                                            {task.status === 'Failed' && (
                                                                <button
                                                                    onClick={() => {
                                                                        void handleRetryTask(task.id);
                                                                    }}
                                                                    disabled={backendStatus !== 'ready' || taskActionPendingKey !== null}
                                                                    className={clsx(
                                                                        "h-6 w-6 rounded-md border border-blue-500/30 bg-blue-500/10 text-blue-200 flex items-center justify-center transition-all hover:bg-blue-500/20",
                                                                        (backendStatus !== 'ready' || taskActionPendingKey !== null) && "opacity-50 cursor-not-allowed"
                                                                    )}
                                                                    title="Retry task"
                                                                >
                                                                    <RefreshCw
                                                                        size={12}
                                                                        className={clsx(taskActionPendingKey === `retry:${task.id}` && "animate-spin")}
                                                                    />
                                                                </button>
                                                            )}
                                                            <span className={clsx(
                                                                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                                                                getTaskStatusLabelClass(task.status)
                                                            )}>
                                                                {task.status}
                                                            </span>
                                                            {task.status === 'Failed' && (
                                                                <span className={clsx(
                                                                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                                                                    getFailureBadgeClass(getFailureType(task))
                                                                )}>
                                                                    {getFailureBadgeLabel(getFailureType(task))}
                                                                </span>
                                                            )}
                                                            {(task.status === 'InProgress' || activeTaskId === task.id) && (
                                                                <RefreshCw size={14} className="text-[var(--accent)] animate-spin" />
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                                                        <span>{formatDate(task.createdAt)}</span>
                                                        {task.assignedTo && (
                                                            <>
                                                                <span>•</span>
                                                                <span>Agent: {formatAssignedAgent(task.assignedTo)}</span>
                                                                {getAssignmentReason(task) && (
                                                                    <span className={clsx(
                                                                        "rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]",
                                                                        getAssignmentReasonClass(getAssignmentReason(task))
                                                                    )}>
                                                                        {getAssignmentReasonLabel(getAssignmentReason(task))}
                                                                    </span>
                                                                )}
                                                            </>
                                                        )}
                                                        {task.groupId && (
                                                            <>
                                                                <span>•</span>
                                                                <span>
                                                                    Group: {task.groupId}
                                                                    {task.groupMode ? ` (${task.groupMode})` : ""}
                                                                </span>
                                                            </>
                                                        )}
                                                    </div>
                                                    {task.dependencies.length > 0 && (
                                                        <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] text-zinc-500">
                                                            <Link2 size={11} className="text-zinc-600" />
                                                            <span>Depends on:</span>
                                                            {task.dependencies.map((dependencyId) => {
                                                                const dependencyTask = storeTasks.find((candidate) => candidate.id === dependencyId);
                                                                const dependencyIndex = storeTasks.findIndex((candidate) => candidate.id === dependencyId);
                                                                const label = dependencyTask
                                                                    ? `#${dependencyIndex + 1} ${dependencyTask.status}`
                                                                    : `${dependencyId.substring(0, 8)}...`;
                                                                return (
                                                                    <span
                                                                        key={`${task.id}-${dependencyId}`}
                                                                        className="rounded-full border border-zinc-700/60 bg-zinc-900/60 px-2 py-0.5 text-[9px] uppercase tracking-[0.1em] text-zinc-300"
                                                                    >
                                                                        {label}
                                                                    </span>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                    {task.status === 'InProgress' && pendingConfirmationCount > 0 && (
                                                        <div className="mt-2 text-[11px] text-yellow-300/90">
                                                            Waiting for approval to continue execution.
                                                        </div>
                                                    )}
                                                    {task.status === 'InProgress' && pendingConfirmationCount === 0 && (
                                                        <div className="mt-2 text-[11px] text-blue-300/90">
                                                            Running task orchestration...
                                                        </div>
                                                    )}
                                                    {task.result && (
                                                        <div className="mt-2 p-2 rounded bg-[var(--bg-base)] text-xs font-mono text-zinc-400 border-l-2 border-[var(--accent)]">
                                                            {getResultSummary(task) && (
                                                                <div className="mb-1 text-[11px] font-semibold text-zinc-300">
                                                                    {getResultSummary(task)}
                                                                </div>
                                                            )}
                                                            {task.status === "Failed"
                                                                ? (mapProviderError(task.result)?.message ?? task.result)
                                                                : task.result}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <ConfirmDialog
                open={clearConfirmOpen}
                title="Clear Orchestrator"
                subtitle="Remove all agents and tasks"
                description="Are you sure you want to clear all agents and tasks? This cannot be undone."
                confirmLabel="Clear"
                cancelLabel="Cancel"
                confirmTone="danger"
                icon={<AlertTriangle size={20} />}
                onCancel={() => setClearConfirmOpen(false)}
                onConfirm={() => {
                    clearAgents();
                    clearTasks();
                    setClearConfirmOpen(false);
                }}
            />

            <ConfirmDialog
                open={addAgentDialogOpen}
                title="Add Agent"
                subtitle="Select a role for the new agent"
                confirmLabel="Add Agent"
                cancelLabel="Cancel"
                confirmTone="primary"
                icon={<Users size={20} />}
                confirmDisabled={backendStatus !== 'ready'}
                onCancel={() => setAddAgentDialogOpen(false)}
                onConfirm={() => {
                    void handleConfirmAddAgent();
                }}
                body={
                    <div className="space-y-3">
                        <div className="text-xs text-zinc-500">Role</div>
                        <div className="relative">
                            <select
                                className="appearance-none w-full bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border)] rounded-lg pl-3 pr-8 py-2 text-sm outline-none focus:border-[var(--accent)]"
                                style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
                                value={selectedRole}
                                onChange={(e) => setSelectedRole(e.target.value as Agent['role'])}
                            >
                                <option value="Coder" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Coder</option>
                                <option value="Reviewer" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Reviewer</option>
                                <option value="Planner" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Planner</option>
                                <option value="Debugger" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Debugger</option>
                                <option value="Generic" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Generic</option>
                            </select>
                            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        </div>
                        <div className="text-[11px] text-zinc-500">
                            Uses current provider/model: <span className="text-zinc-300 font-mono">{activeProviderId} / {activeModelId}</span>
                        </div>
                    </div>
                }
            />

            <ConfirmDialog
                open={taskDialogOpen}
                title="Create Task"
                subtitle="Add a task to the orchestrator queue"
                confirmLabel="Create Task"
                cancelLabel="Cancel"
                confirmTone="primary"
                icon={<Play size={20} />}
                confirmDisabled={backendStatus !== 'ready' || Boolean(taskValidationMessage)}
                onCancel={() => setTaskDialogOpen(false)}
                onConfirm={() => {
                    void handleCreateTask();
                }}
                body={
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <div className="text-xs text-zinc-500">Task</div>
                            <input
                                value={taskDescription}
                                onChange={(e) => setTaskDescription(e.target.value)}
                                placeholder="Describe what the agent should do"
                                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-[var(--accent)]"
                                autoFocus
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="text-xs text-zinc-500">Preferred Agent (optional)</div>
                            <div className="relative">
                                <select
                                    className="appearance-none w-full bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border)] rounded-lg pl-3 pr-8 py-2 text-sm outline-none focus:border-[var(--accent)]"
                                    style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
                                    value={preferredTaskAgentId}
                                    onChange={(e) => setPreferredTaskAgentId(e.target.value)}
                                >
                                    <option value={AUTO_AGENT} style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
                                        Automatic
                                    </option>
                                    {storeAgents.map((agent) => (
                                        <option
                                            key={agent.id}
                                            value={agent.id}
                                            style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
                                        >
                                            {agent.role} ({agent.id.substring(0, 8)}...)
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <div className="text-xs text-zinc-500">Group (optional)</div>
                            <input
                                value={taskGroupId}
                                onChange={(e) => setTaskGroupId(e.target.value)}
                                placeholder="e.g. lint-pass, feature-a"
                                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-[var(--accent)]"
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="text-xs text-zinc-500">Group Mode</div>
                            <div className="relative">
                                <select
                                    className="appearance-none w-full bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border)] rounded-lg pl-3 pr-8 py-2 text-sm outline-none focus:border-[var(--accent)] disabled:opacity-60"
                                    style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
                                    value={taskGroupMode}
                                    onChange={(e) => setTaskGroupMode(e.target.value as TaskGroupMode)}
                                    disabled={!taskGroupId.trim()}
                                >
                                    <option value="parallel" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
                                        Parallel
                                    </option>
                                    <option value="sequential" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
                                        Sequential
                                    </option>
                                </select>
                                <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                            </div>
                            <div className="text-[10px] text-zinc-500">
                                Sequential runs tasks in this group one-by-one. Parallel allows same-group tasks to run concurrently.
                            </div>
                        </div>
                        {runAfterPreviousTask && (
                            <div className="text-[11px] text-yellow-200/90">
                                Chain is enabled. This task will run after the previous task finishes.
                            </div>
                        )}
                        {taskValidationMessage && (
                            <div className="text-[11px] text-red-300">
                                {taskValidationMessage}
                            </div>
                        )}
                    </div>
                }
            />

            <ConfirmDialog
                open={agentToRemove !== null}
                title="Remove Agent"
                subtitle="Unregister selected agent"
                description={
                    agentToRemove
                        ? `Remove ${agentToRemove.role} (${agentToRemove.id.substring(0, 8)}...)?`
                        : undefined
                }
                confirmLabel="Remove"
                cancelLabel="Cancel"
                confirmTone="danger"
                icon={<Trash2 size={20} />}
                confirmDisabled={backendStatus !== 'ready' || agentActionPendingId !== null}
                onCancel={() => setAgentToRemove(null)}
                onConfirm={() => {
                    void handleConfirmRemoveAgent();
                }}
            />

            <ConfirmDialog
                open={taskToCancel !== null}
                title="Cancel Task"
                subtitle="Stop this task from continuing"
                description={
                    taskToCancel
                        ? `Cancel "${taskToCancel.description}"?`
                        : undefined
                }
                confirmLabel="Cancel Task"
                cancelLabel="Back"
                confirmTone="danger"
                icon={<AlertTriangle size={20} />}
                confirmDisabled={backendStatus !== 'ready' || taskActionPendingKey !== null}
                onCancel={() => setTaskToCancel(null)}
                onConfirm={() => {
                    void handleConfirmCancelTask();
                }}
            />
        </div>
    );
}
