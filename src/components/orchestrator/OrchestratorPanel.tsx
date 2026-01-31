import { X, Plus, Users, Play, Trash2, RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useOrchestratorStore, Agent, Task } from '../../stores/orchestrator';
import { useUIStore } from '../../stores/ui';
import { useProviderStore } from '../../stores/provider';
import clsx from 'clsx';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { useStore } from '../../store';

interface OrchestratorPanelProps {
    onClose?: () => void;
}

export function OrchestratorPanel({ onClose }: OrchestratorPanelProps) {
    const storeAgents = useOrchestratorStore(state => state.agents);
    const storeTasks = useOrchestratorStore(state => state.tasks);
    const activeTaskId = useOrchestratorStore(state => state.activeTask);
    const { addAgent, addTask, clearAgents, clearTasks, initOrchestrator } = useOrchestratorStore();
    const { setOrchestratorOpen } = useUIStore();
    const { activeModelId, activeProviderId, apiKeys } = useProviderStore();
    const { workspacePath } = useStore();
    const [processing, setProcessing] = useState(false);

    // Initialize backend orchestrator on mount
    useState(() => {
        if (workspacePath) {
            initOrchestrator(workspacePath);
        }
    });

    const handleAddAgent = async () => {
        const role = prompt('Select agent role:', 'Coder\nReviewer\nPlanner\nDebugger\nGeneric');
        if (!role) return;

        const normalizedRole = role.toLowerCase();
        const validRoles = ['coder', 'reviewer', 'planner', 'debugger', 'generic'];

        if (!validRoles.includes(normalizedRole)) {
            alert('Invalid role. Please select one of: Coder, Reviewer, Planner, Debugger, Generic');
            return;
        }

        const apiKey = apiKeys[activeProviderId] || '';

        await addAgent({
            id: crypto.randomUUID(), // Valid UUID for backend
            role: normalizedRole.charAt(0).toUpperCase() + normalizedRole.slice(1) as Agent['role'],
            modelId: activeModelId,
            providerId: activeProviderId
        }, apiKey, workspacePath || '.');
    };

    const handleProcessTasks = async () => {
        setProcessing(true);
        try {
            const results = await invoke<string[]>('process_tasks');
            console.log('Task processing results:', results);
            await invoke('get_all_tasks');
        } catch (error) {
            console.error('Failed to process tasks:', error);
            alert('Failed to process tasks');
        } finally {
            setProcessing(false);
        }
    };

    const handleCreateTask = async () => {
        const description = prompt('Enter task description:');
        if (!description) return;

        await addTask(description);
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

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center animate-in fade-in duration-300">
            <div className="w-[1200px] h-[700px] bg-[var(--bg-surface)] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-[var(--border)] flex overflow-hidden scale-in-center animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="h-12 border-b border-[var(--border)] flex items-center justify-between px-4 bg-[var(--bg-surface)]/50">
                    <div className="flex items-center gap-2">
                        <Users size={18} className="text-[var(--accent)]" />
                        <span className="font-bold text-sm text-zinc-100">Multi-Agent Orchestration</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleProcessTasks}
                            disabled={processing || storeTasks.length === 0}
                            className={clsx(
                                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-tighter transition-all",
                                processing ? "bg-[var(--accent)]/50 text-zinc-400" : "bg-[var(--accent)] text-white hover:bg-[var(--accent)]/80 disabled:opacity-50"
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
                            onClick={() => {
                                if (confirm('Clear all agents and tasks?')) {
                                    clearAgents();
                                    clearTasks();
                                }
                            }}
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

                {/* Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Agents Panel */}
                    <div className="w-64 border-r border-[var(--border)] flex flex-col bg-[var(--bg-base)]">
                        <div className="p-3 border-b border-[var(--border)]">
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-bold text-xs text-zinc-400 uppercase tracking-widest">Agents</span>
                                <button
                                    onClick={handleAddAgent}
                                    className="p-1 hover:bg-[var(--bg-elevated)] rounded-md text-zinc-400 hover:text-[var(--accent)] transition-all"
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
                                            <div className="flex items-center justify-between">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-xs text-zinc-100">{agent.role}</span>
                                                    <span className="text-[10px] text-zinc-500 font-mono">{agent.modelId}</span>
                                                </div>
                                                <div className={clsx(
                                                    "text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full",
                                                    agent.status === 'idle' && "bg-zinc-600 text-zinc-400",
                                                    agent.status === 'working' && "bg-green-500/10 text-green-400",
                                                    agent.status === 'completed' && "bg-blue-500/10 text-blue-400",
                                                    agent.status === 'error' && "bg-red-500/10 text-red-400"
                                                )}>
                                                    {agent.status}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Tasks Panel */}
                    <div className="flex-1 flex flex-col bg-[var(--bg-base)]">
                        <div className="p-3 border-b border-[var(--border)]">
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-bold text-xs text-zinc-400 uppercase tracking-widest">Task Queue</span>
                                <button
                                    onClick={handleCreateTask}
                                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--accent)] text-white text-xs font-bold uppercase tracking-tighter hover:bg-[var(--accent)]/80 transition-all"
                                >
                                    <Plus size={12} />
                                    Add Task
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto p-3">
                            {storeTasks.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-48 text-zinc-500">
                                    <Play size={32} className="mb-2 opacity-20" />
                                    <p className="text-xs text-center">No tasks yet. Create a task to begin orchestration.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {storeTasks.map((task) => (
                                        <div
                                            key={task.id}
                                            className={clsx(
                                                "p-3 rounded-xl border transition-all",
                                                activeTaskId === task.id ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--border)] bg-[var(--bg-elevated)]/50"
                                            )}
                                        >
                                            <div className="flex items-start gap-2">
                                                <div className="mt-0.5">
                                                    {getTaskStatusIcon(task.status)}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <p className="font-bold text-sm text-zinc-100">{task.description}</p>
                                                        {activeTaskId === task.id && (
                                                            <RefreshCw size={14} className="text-[var(--accent)] animate-spin" />
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                                                        <span>{formatDate(task.createdAt)}</span>
                                                        {task.assignedTo && (
                                                            <>
                                                                <span>•</span>
                                                                <span>Agent: {task.assignedTo.substring(0, 8)}...</span>
                                                            </>
                                                        )}
                                                    </div>
                                                    {task.result && (
                                                        <div className="mt-2 p-2 rounded bg-[var(--bg-base)] text-xs font-mono text-zinc-400 border-l-2 border-[var(--accent)]">
                                                            {task.result}
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
        </div>
    );
}
