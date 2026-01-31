import { Files, Settings, TerminalSquare, Plus, Clock, Users, Search } from 'lucide-react';
import { useUIStore } from '../../stores/ui';
import { useStore } from '../../store';
import { useProviderStore } from '../../stores/provider';
import { useWorkspaceStore } from '../../stores/workspace';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import clsx from 'clsx';

export function ActivityBar() {
    const { activeSidebarTab, setActiveSidebarTab, isTerminalOpen, toggleTerminal, setSettingsOpen, isHistoryOpen, setHistoryOpen, isOrchestratorOpen, setOrchestratorOpen } = useUIStore();
    const { setWorkspacePath, setSessionId, workspacePath } = useStore();
    const { apiKeys, activeProviderId, activeModelId } = useProviderStore();
    const { workspaces, addWorkspace } = useWorkspaceStore();

    const handleAddWorkspace = async () => {
        const selected = await open({
            directory: true,
            multiple: false,
            defaultPath: workspacePath || undefined,
        });

        if (selected && typeof selected === 'string') {
            const name = selected.split('/').pop() || 'W';
            const initial = name.charAt(0).toUpperCase();
            
            // Random color
            const colors = ['bg-red-600', 'bg-blue-600', 'bg-green-600', 'bg-purple-600', 'bg-orange-600', 'bg-pink-600'];
            const color = colors[Math.floor(Math.random() * colors.length)];

            const newWs = { 
                initial, 
                path: selected, 
                color,
                id: Math.random().toString(36).substring(7)
            };
            addWorkspace(newWs);
            switchWorkspace(selected);
        }
    };

    const switchWorkspace = async (path: string) => {
        setWorkspacePath(path);
        
        // Reset session on workspace switch to avoid context bleed
        setSessionId(""); 
        
        // Try to auto-create session if we have an API key for active provider (Ollama doesn't need one)
        const key = apiKeys[activeProviderId];
        if (key || activeProviderId === 'ollama') {
            try {
                const sid = await invoke<string>("create_session", {
                    workspacePath: path,
                    apiKey: key || '',  // Empty string for Ollama
                    provider: activeProviderId,
                    modelId: activeModelId
                });
                setSessionId(sid);
            } catch (e) {
                console.error("Failed to create session on switch:", e);
            }
        }
    };

    const IconWrapper = ({ 
        active, 
        onClick, 
        children,
        bottom = false,
        className,
        title
    }: { 
        active?: boolean; 
        onClick: () => void; 
        children: React.ReactNode;
        bottom?: boolean;
        className?: string;
        title?: string;
    }) => (
        <button
            onClick={onClick}
            title={title}
            className={clsx(
                "p-3 rounded-lg transition-colors mb-2 relative group",
                active ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "text-zinc-500 hover:text-white hover:bg-[#27272A]",
                bottom && "mt-auto",
                className
            )}
        >
            {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-[var(--accent)] rounded-r-full" />}
            {children}
        </button>
    );

    return (
        <div className="w-14 bg-[var(--bg-base)] border-r border-[var(--border)] flex flex-col items-center py-4 h-full flex-shrink-0 z-50">
            {/* Workspace Initials */}
            <div className="flex flex-col items-center mb-4 gap-2">
                {workspaces.map((ws) => (
                    <button 
                        key={ws.id}
                        onClick={() => switchWorkspace(ws.path)}
                        title={ws.path}
                        className={clsx(
                            "w-10 h-10 rounded-lg flex items-center justify-center font-bold text-white text-sm transition-all hover:scale-105 active:scale-95 shadow-lg relative",
                            ws.color,
                            workspacePath === ws.path ? "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-base)]" : "opacity-50 hover:opacity-100"
                        )}
                    >
                        {ws.initial}
                    </button>
                ))}
                <button 
                    onClick={handleAddWorkspace}
                    className="w-10 h-10 rounded-lg border border-dashed border-[#27272A] flex items-center justify-center text-zinc-600 hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all hover:bg-[var(--accent)]/5"
                    title="Add Workspace"
                >
                    <Plus size={18} />
                </button>
            </div>

            <div className="w-8 h-[1px] bg-[#27272A] mb-4" />

            <IconWrapper 
                active={activeSidebarTab === 'explorer'} 
                onClick={() => setActiveSidebarTab(activeSidebarTab === 'explorer' ? null : 'explorer')}
                title="File Explorer"
            >
                <Files size={22} strokeWidth={1.5} />
            </IconWrapper>

            <IconWrapper 
                active={activeSidebarTab === 'search'} 
                onClick={() => setActiveSidebarTab(activeSidebarTab === 'search' ? null : 'search')}
                title="Global Search"
            >
                <Search size={22} strokeWidth={1.5} />
            </IconWrapper>

            <IconWrapper 
                active={isOrchestratorOpen} 
                onClick={() => setOrchestratorOpen(!isOrchestratorOpen)}
                title="Multi-Agent Orchestration"
            >
                <Users size={22} strokeWidth={1.5} />
            </IconWrapper>

            <IconWrapper 
                active={isHistoryOpen} 
                onClick={() => setHistoryOpen(!isHistoryOpen)}
                title="Session History"
            >
                <Clock size={22} strokeWidth={1.5} />
            </IconWrapper>

            <div className="mt-auto flex flex-col items-center">
                 <IconWrapper 
                    active={isTerminalOpen} 
                    onClick={toggleTerminal}
                    title="Toggle Terminal"
                >
                    <TerminalSquare size={22} strokeWidth={1.5} />
                </IconWrapper>

                <IconWrapper 
                    onClick={() => setSettingsOpen(true)}
                    title="Settings"
                >
                    <Settings size={22} strokeWidth={1.5} />
                </IconWrapper>
            </div>
        </div>
    );
}
