import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type AgentRole = 'Coder' | 'Reviewer' | 'Planner' | 'Debugger' | 'Generic';
export type AgentStatus = 'idle' | 'working' | 'completed' | 'error';
export type TaskStatus = 'Pending' | 'InProgress' | 'Completed' | 'Failed';

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
    assignedTo?: string;
    result?: string;
    createdAt: string;
}

interface OrchestratorState {
    agents: Agent[];
    tasks: Task[];
    activeTask: string | null;
    isOrchestratorOpen: boolean;
    
    // Actions
    setOrchestratorOpen: (open: boolean) => void;
    initOrchestrator: (workspacePath: string) => Promise<void>;
    addAgent: (agent: Omit<Agent, 'status'>, apiKey: string, workspacePath: string) => Promise<void>;
    removeAgent: (id: string) => void;
    clearAgents: () => void;
    addTask: (description: string) => Promise<void>;
    removeTask: (id: string) => void;
    clearTasks: () => void;
    setActiveTask: (id: string | null) => void;
    updateTaskStatus: (id: string, status: TaskStatus, result?: string) => void;
    updateAgentStatus: (id: string, status: AgentStatus) => void;
    loadOrchestratorState: () => Promise<void>;
}

export const useOrchestratorStore = create<OrchestratorState>((set) => ({
    agents: [],
    tasks: [],
    activeTask: null,
    isOrchestratorOpen: false,

    setOrchestratorOpen: (open) => set({ isOrchestratorOpen: open }),

    initOrchestrator: async (workspacePath) => {
        try {
            await invoke('init_orchestrator', { workspacePath });
        } catch (error) {
            console.log('Failed to init orchestrator:', error);
        }
    },

    addAgent: async (agentData, apiKey, workspacePath) => {
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
        } catch (error) {
            console.log('Backend orchestrator not available, using frontend-only mode', error);
        }
        
        set((state) => ({
            agents: [...state.agents, newAgent]
        }));
    },

    removeAgent: (id) => {
        set((state) => ({
            agents: state.agents.filter(a => a.id !== id)
        }));
    },

    clearAgents: () => set({ agents: [] }),

    addTask: async (description) => {
        const newTask: Task = {
            id: Math.random().toString(36).substring(7),
            description,
            status: 'Pending',
            createdAt: new Date().toISOString()
        };
        
        // Try to add task via backend
        try {
            const taskId = await invoke<string>('create_task', { description });
            newTask.id = taskId;
        } catch (error) {
            console.log('Backend orchestrator not available, using frontend-only mode');
        }
        
        set((state) => ({
            tasks: [...state.tasks, newTask]
        }));
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

    loadOrchestratorState: async () => {
        // Try to load state from backend
        try {
            const tasks = await invoke<Task[]>('get_all_tasks');
            set({ tasks });
        } catch (error) {
            console.log('Could not load orchestrator state from backend');
        }
    },
}));
