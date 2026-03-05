import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

export type AgentRole = 'Coder' | 'Reviewer' | 'Planner' | 'Debugger' | 'Generic';
export type AgentStatus = 'idle' | 'working' | 'completed' | 'error';
export type TaskStatus = 'Pending' | 'InProgress' | 'Completed' | 'Failed';
export type OrchestratorBackendStatus = 'idle' | 'initializing' | 'ready' | 'error';
export type OrchestratorExecutionMode = 'parallel' | 'sequential';
export type TaskGroupMode = 'parallel' | 'sequential';

export interface Agent {
    id: string;
    role: AgentRole;
    modelId: string;
    providerId: string;
    status: AgentStatus;
}

export interface Task {
    id: string;
    description: string;
    status: TaskStatus;
    preferredAgentId?: string;
    dependencies: string[];
    assignedTo?: string;
    groupId?: string;
    groupMode?: TaskGroupMode;
    result?: string;
    createdAt: string;
}

interface OrchestratorState {
    agents: Agent[];
    tasks: Task[];
    activeTask: string | null;
    isOrchestratorOpen: boolean;
    backendStatus: OrchestratorBackendStatus;
    executionMode: OrchestratorExecutionMode;
    lastError: string | null;
    
    // Actions
    setOrchestratorOpen: (open: boolean) => void;
    initOrchestrator: (workspacePath: string) => Promise<boolean>;
    addAgent: (agent: Omit<Agent, 'status'>, apiKey: string, workspacePath: string) => Promise<boolean>;
    removeAgent: (id: string) => Promise<boolean>;
    clearAgents: () => void;
    addTask: (
        description: string,
        runAfterPrevious?: boolean,
        preferredAgentId?: string,
        groupId?: string,
        groupMode?: TaskGroupMode
    ) => Promise<boolean>;
    cancelTask: (id: string) => Promise<boolean>;
    retryTask: (id: string) => Promise<boolean>;
    removeTask: (id: string) => void;
    clearTasks: () => void;
    setActiveTask: (id: string | null) => void;
    updateTaskStatus: (id: string, status: TaskStatus, result?: string) => void;
    updateAgentStatus: (id: string, status: AgentStatus) => void;
    loadOrchestratorState: (options?: { suppressErrors?: boolean }) => Promise<boolean>;
    loadExecutionMode: () => Promise<boolean>;
    setExecutionMode: (mode: OrchestratorExecutionMode) => Promise<boolean>;
    restorePersistedState: (
        workspacePath: string,
        apiKeys: Record<string, string>,
        openaiAuthMethod: "apiKey" | "oauth"
    ) => Promise<boolean>;
    processTasks: () => Promise<boolean>;
    clearError: () => void;
}

type BackendTask = {
    id: string;
    description: string;
    status: TaskStatus;
    preferred_agent?: string | null;
    preferredAgentId?: string | null;
    dependencies?: string[];
    assigned_to?: string | null;
    assignedTo?: string | null;
    group_id?: string | null;
    groupId?: string | null;
    group_mode?: string | null;
    groupMode?: string | null;
    result?: string | null;
    created_at?: string;
    createdAt?: string;
};

const delay = (ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
});

const parseError = (error: unknown): string => {
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
        const value = (error as { message?: unknown }).message;
        if (typeof value === "string" && value.length > 0) return value;
    }
    return String(error);
};

const normalizeTaskStatus = (status: unknown): TaskStatus => {
    if (status === "Pending" || status === "InProgress" || status === "Completed" || status === "Failed") {
        return status;
    }
    return "Pending";
};

const normalizeTaskGroupMode = (mode: unknown): TaskGroupMode | undefined => {
    if (typeof mode !== "string") return undefined;
    const normalized = mode.toLowerCase();
    if (normalized === "parallel") return "parallel";
    if (normalized === "sequential") return "sequential";
    return undefined;
};

const normalizeTask = (task: BackendTask): Task => ({
    id: task.id,
    description: task.description,
    status: normalizeTaskStatus(task.status),
    preferredAgentId: task.preferredAgentId ?? task.preferred_agent ?? undefined,
    dependencies: Array.isArray(task.dependencies)
        ? task.dependencies.filter((item): item is string => typeof item === "string")
        : [],
    assignedTo: task.assignedTo ?? task.assigned_to ?? undefined,
    groupId: task.groupId ?? task.group_id ?? undefined,
    groupMode: normalizeTaskGroupMode(task.groupMode ?? task.group_mode),
    result: task.result ?? undefined,
    createdAt: task.createdAt ?? task.created_at ?? new Date().toISOString()
});

let orchestratorLoadRequestSeq = 0;
let orchestratorLoadAppliedSeq = 0;

const isDependencyReady = (task: Task, tasks: Task[]) => {
    return task.dependencies.every((dependencyId) =>
        tasks.some((candidate) => candidate.id === dependencyId && candidate.status === "Completed")
    );
};

const isSequentialGroupBlocked = (task: Task, tasks: Task[]) => {
    if (!task.groupId || task.groupMode !== "sequential") return false;
    for (const candidate of tasks) {
        if (candidate.id === task.id) break;
        if (candidate.groupId !== task.groupId || candidate.groupMode !== "sequential") continue;
        if (candidate.status !== "Completed" && candidate.status !== "Failed") {
            return true;
        }
    }
    return false;
};

const applyOptimisticTaskStart = (
    tasks: Task[],
    executionMode: OrchestratorExecutionMode,
    agentCount: number
): Task[] => {
    if (tasks.length === 0) return tasks;
    const optimistic = tasks.map((task) => ({ ...task }));
    const maxParallel = executionMode === "sequential"
        ? 1
        : Math.min(Math.max(agentCount, 1), 8);

    let started = 0;
    while (started < maxParallel) {
        const nextIndex = optimistic.findIndex((task) => {
            if (task.status !== "Pending") return false;
            if (!isDependencyReady(task, optimistic)) return false;
            if (isSequentialGroupBlocked(task, optimistic)) return false;
            return true;
        });

        if (nextIndex === -1) break;
        optimistic[nextIndex] = {
            ...optimistic[nextIndex],
            status: "InProgress"
        };
        started += 1;
    }

    return optimistic;
};

export const useOrchestratorStore = create<OrchestratorState>()(persist((set, get) => ({
    agents: [],
    tasks: [],
    activeTask: null,
    isOrchestratorOpen: false,
    backendStatus: 'idle',
    executionMode: 'parallel',
    lastError: null,

    setOrchestratorOpen: (open) => set({ isOrchestratorOpen: open }),

    initOrchestrator: async (workspacePath) => {
        if (!workspacePath || !workspacePath.trim()) {
            set({
                backendStatus: "error",
                lastError: "Select a workspace before using multi-agent orchestration."
            });
            return false;
        }

        set({ backendStatus: "initializing", lastError: null });
        try {
            await invoke('init_orchestrator', { workspacePath });
            set({ backendStatus: "ready", lastError: null });
            await get().loadOrchestratorState();
            await get().loadExecutionMode();
            return true;
        } catch (error) {
            set({
                backendStatus: "error",
                lastError: `Failed to initialize orchestrator: ${parseError(error)}`
            });
            return false;
        }
    },

    addAgent: async (agentData, apiKey, workspacePath) => {
        if (get().backendStatus !== "ready") {
            set({ lastError: "Orchestrator is not ready. Initialize it first." });
            return false;
        }

        const requiresKey = agentData.providerId !== "ollama";
        if (requiresKey && !apiKey.trim()) {
            set({
                lastError: `Missing API credential for provider "${agentData.providerId}". Connect OAuth/API key in Settings first.`
            });
            return false;
        }

        const newAgent: Agent = {
            ...agentData,
            status: 'idle'
        };
        
        try {
            await invoke('add_agent_to_orchestrator', {
                agentId: newAgent.id,
                role: newAgent.role,
                modelId: newAgent.modelId,
                apiKey: apiKey,
                provider: newAgent.providerId,
                workspacePath: workspacePath
            });
            set((state) => ({
                agents: [...state.agents, newAgent],
                lastError: null
            }));
            return true;
        } catch (error) {
            set({ lastError: `Failed to add agent: ${parseError(error)}` });
            return false;
        }
    },

    removeAgent: async (id) => {
        if (get().backendStatus !== "ready") {
            set({ lastError: "Orchestrator is not ready. Initialize it first." });
            return false;
        }

        try {
            await invoke('remove_agent_from_orchestrator', { agentId: id });
            set((state) => ({
                agents: state.agents.filter((agent) => agent.id !== id),
                lastError: null
            }));
            return true;
        } catch (error) {
            set({ lastError: `Failed to remove agent: ${parseError(error)}` });
            return false;
        }
    },

    clearAgents: () => set({ agents: [] }),

    addTask: async (description, runAfterPrevious = false, preferredAgentId, groupId, groupMode) => {
        if (get().backendStatus !== "ready") {
            set({ lastError: "Orchestrator is not ready. Initialize it first." });
            return false;
        }

        const dependencyIds: string[] = [];
        if (runAfterPrevious) {
            const previousTask = get().tasks[get().tasks.length - 1];
            if (previousTask) {
                dependencyIds.push(previousTask.id);
            }
        }

        try {
            await invoke<string>('create_task', {
                description,
                dependencyIds: dependencyIds.length > 0 ? dependencyIds : null,
                preferredAgentId: preferredAgentId && preferredAgentId.trim() ? preferredAgentId : null,
                groupId: groupId && groupId.trim() ? groupId.trim() : null,
                groupMode: groupMode ?? null
            });
            await get().loadOrchestratorState();
            set({ lastError: null });
            return true;
        } catch (error) {
            set({ lastError: `Failed to create task: ${parseError(error)}` });
            return false;
        }
    },

    cancelTask: async (id) => {
        if (get().backendStatus !== "ready") {
            set({ lastError: "Orchestrator is not ready. Initialize it first." });
            return false;
        }

        try {
            await invoke('cancel_task', { taskId: id });
            await get().loadOrchestratorState();
            set({ lastError: null });
            return true;
        } catch (error) {
            set({ lastError: `Failed to cancel task: ${parseError(error)}` });
            return false;
        }
    },

    retryTask: async (id) => {
        if (get().backendStatus !== "ready") {
            set({ lastError: "Orchestrator is not ready. Initialize it first." });
            return false;
        }

        try {
            await invoke('retry_task', { taskId: id });
            await get().loadOrchestratorState();
            set({ lastError: null });
            return true;
        } catch (error) {
            set({ lastError: `Failed to retry task: ${parseError(error)}` });
            return false;
        }
    },

    removeTask: (id) => {
        set((state) => ({
            tasks: state.tasks.filter(t => t.id !== id)
        }));
    },

    clearTasks: () => set({ tasks: [], activeTask: null }),

    setActiveTask: (id) => set({ activeTask: id }),

    updateTaskStatus: (id, status, result) => {
        set((state) => ({
            tasks: state.tasks.map(t => 
                t.id === id ? { ...t, status, result: result || t.result } : t
            )
        }));
    },

    updateAgentStatus: (id, status) => {
        set((state) => ({
            agents: state.agents.map(a => 
                a.id === id ? { ...a, status } : a
            )
        }));
    },

    loadOrchestratorState: async (options) => {
        if (get().backendStatus !== "ready") {
            return false;
        }

        const requestSeq = ++orchestratorLoadRequestSeq;

        try {
            const tasks = await invoke<BackendTask[]>('get_all_tasks');
            const normalized = tasks.map(normalizeTask);
            const activeTask = normalized.find((task) => task.status === "InProgress")?.id ?? null;
            if (requestSeq < orchestratorLoadAppliedSeq) {
                return true;
            }
            orchestratorLoadAppliedSeq = requestSeq;
            set({
                tasks: normalized,
                activeTask,
                lastError: null
            });
            return true;
        } catch (error) {
            if (requestSeq >= orchestratorLoadAppliedSeq && !options?.suppressErrors) {
                set({ lastError: `Failed to load orchestrator state: ${parseError(error)}` });
            }
            return false;
        }
    },

    loadExecutionMode: async () => {
        if (get().backendStatus !== "ready") {
            return false;
        }

        try {
            const rawMode = await invoke<string>('get_orchestrator_execution_mode');
            const executionMode: OrchestratorExecutionMode = rawMode === 'sequential' ? 'sequential' : 'parallel';
            set({ executionMode, lastError: null });
            return true;
        } catch (error) {
            set({ lastError: `Failed to load execution mode: ${parseError(error)}` });
            return false;
        }
    },

    setExecutionMode: async (mode) => {
        if (get().backendStatus !== "ready") {
            set({ lastError: "Orchestrator is not ready. Initialize it first." });
            return false;
        }

        try {
            await invoke('set_orchestrator_execution_mode', { mode });
            set({ executionMode: mode, lastError: null });
            return true;
        } catch (error) {
            set({ lastError: `Failed to set execution mode: ${parseError(error)}` });
            return false;
        }
    },

    restorePersistedState: async (workspacePath, apiKeys, openaiAuthMethod) => {
        if (get().backendStatus !== "ready") {
            return false;
        }

        try {
            const backendTasks = await invoke<BackendTask[]>('get_all_tasks');
            if (backendTasks.length > 0) {
                const normalized = backendTasks.map(normalizeTask);
                const activeTask = normalized.find((task) => task.status === "InProgress")?.id ?? null;
                set({
                    tasks: normalized,
                    activeTask,
                    lastError: null
                });
                return true;
            }

            const persistedAgents = get().agents;
            const persistedTasks = get().tasks;
            if (persistedAgents.length === 0 && persistedTasks.length === 0) {
                return true;
            }

            const restoredAgentIds = new Set<string>();
            const failedAgents: string[] = [];

            for (const agent of persistedAgents) {
                let apiKey = agent.providerId === "ollama" ? "" : (apiKeys[agent.providerId] ?? "");
                if (agent.providerId === "openai" && openaiAuthMethod === "oauth" && !apiKey.trim()) {
                    try {
                        const oauthToken = await invoke<string>("oauth_get_access_token", { providerId: "chatgpt" });
                        if (oauthToken) {
                            apiKey = oauthToken;
                        }
                    } catch (_) {
                        // Best-effort restore; report through failedAgents below.
                    }
                }

                if (agent.providerId !== "ollama" && !apiKey.trim()) {
                    failedAgents.push(`${agent.role} (${agent.id.substring(0, 8)}...): missing credentials`);
                    continue;
                }

                try {
                    await invoke('add_agent_to_orchestrator', {
                        agentId: agent.id,
                        role: agent.role,
                        modelId: agent.modelId,
                        apiKey,
                        provider: agent.providerId,
                        workspacePath
                    });
                    restoredAgentIds.add(agent.id);
                } catch (error) {
                    failedAgents.push(`${agent.role} (${agent.id.substring(0, 8)}...): ${parseError(error)}`);
                }
            }

            const restorableTasks = persistedTasks
                .filter((task) => task.status === "Pending" || task.status === "InProgress")
                .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

            const remappedTaskIds = new Map<string, string>();
            const failedTasks: string[] = [];

            for (const task of restorableTasks) {
                const mappedDependencies = task.dependencies
                    .map((dependencyId) => remappedTaskIds.get(dependencyId))
                    .filter((value): value is string => Boolean(value));
                const preferredAgentId =
                    task.preferredAgentId && restoredAgentIds.has(task.preferredAgentId)
                        ? task.preferredAgentId
                        : null;

                try {
                    const newTaskId = await invoke<string>('create_task', {
                        description: task.description,
                        dependencyIds: mappedDependencies.length > 0 ? mappedDependencies : null,
                        preferredAgentId,
                        groupId: task.groupId ?? null,
                        groupMode: task.groupMode ?? null
                    });
                    remappedTaskIds.set(task.id, newTaskId);
                } catch (error) {
                    failedTasks.push(`${task.description}: ${parseError(error)}`);
                }
            }

            await invoke('set_orchestrator_execution_mode', { mode: get().executionMode });
            await get().loadOrchestratorState();

            if (failedAgents.length > 0 || failedTasks.length > 0) {
                set({
                    lastError: `Restored with issues. Agents failed: ${failedAgents.length}. Tasks failed: ${failedTasks.length}.`
                });
                return false;
            }

            set({ lastError: null });
            return true;
        } catch (error) {
            set({ lastError: `Failed to restore orchestrator state: ${parseError(error)}` });
            return false;
        }
    },

    processTasks: async () => {
        if (get().backendStatus !== "ready") {
            set({ lastError: "Orchestrator is not ready. Initialize it first." });
            return false;
        }

        set((state) => {
            const tasks = applyOptimisticTaskStart(state.tasks, state.executionMode, state.agents.length);
            const activeTask = tasks.find((task) => task.status === "InProgress")?.id ?? state.activeTask;
            return {
                tasks,
                activeTask,
                lastError: null
            };
        });

        let finished = false;
        const pollPromise = (async () => {
            while (!finished) {
                await get().loadOrchestratorState({ suppressErrors: true });
                await delay(350);
            }
        })();

        try {
            await invoke<string[]>('process_tasks');
            finished = true;
            await pollPromise;
            await get().loadOrchestratorState();
            set({ lastError: null });
            return true;
        } catch (error) {
            finished = true;
            await pollPromise;
            set({ lastError: `Failed to process tasks: ${parseError(error)}` });
            return false;
        }
    },

    clearError: () => set({ lastError: null }),
}), {
    name: "anvil-orchestrator",
    partialize: (state) => ({
        agents: state.agents,
        tasks: state.tasks,
        executionMode: state.executionMode
    })
}));
