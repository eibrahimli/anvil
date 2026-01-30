import { X, Clock, Trash2, RefreshCw, Search } from 'lucide-react';
import { useHistoryStore } from '../../stores/history';
import clsx from 'clsx';
import { useState, useEffect } from 'react';

interface HistoryModalProps {
    onClose: () => void;
    onReplay: (sessionId: string) => void;
}

export function HistoryModal({ onClose, onReplay }: HistoryModalProps) {
    const { sessions, deleteSession, loadSessions } = useHistoryStore();
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadSessions();
    }, [loadSessions]);

    const filtered = sessions.filter(s => 
        s.workspace_path.toLowerCase().includes(search.toLowerCase()) || 
        s.model.toLowerCase().includes(search.toLowerCase())
    );

    const handleDelete = async (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this session?')) {
            await deleteSession(sessionId);
        }
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        }).format(date);
    };

    const getModeIcon = (mode: string) => {
        switch (mode) {
            case 'Plan': return '📋';
            case 'Research': return '🔍';
            case 'Build': return '🔨';
            default: return '💬';
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center animate-in fade-in duration-300">
            <div className="w-[900px] h-[700px] bg-[var(--bg-surface)] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-[var(--border)] flex overflow-hidden scale-in-center animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="h-16 border-b border-[var(--border)] flex items-center justify-between px-8 bg-[var(--bg-surface)]/50">
                    <div className="flex items-center gap-3">
                        <Clock size={20} className="text-[var(--accent)]" />
                        <h2 className="font-bold text-lg tracking-tight text-zinc-100">Session History</h2>
                    </div>
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={() => {
                                setLoading(true);
                                loadSessions().then(() => setLoading(false));
                            }}
                            disabled={loading}
                            className="p-2 hover:bg-[var(--bg-elevated)] rounded-lg transition-all text-zinc-400 hover:text-white disabled:opacity-50"
                            title="Refresh"
                        >
                            <RefreshCw size={18} className={clsx(loading && 'animate-spin')} />
                        </button>
                        <button 
                            onClick={onClose}
                            className="p-2 hover:bg-[var(--bg-elevated)] rounded-lg transition-all text-zinc-400 hover:text-white"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>
                
                {/* Search */}
                <div className="px-8 py-4 border-b border-[var(--border)]">
                    <div className="relative">
                        <Search size={16} className="absolute left-4 top-3.5 text-zinc-600" />
                        <input 
                            className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-xl pl-12 pr-4 py-3 text-sm focus:border-[var(--accent)] outline-none text-[var(--text-primary)] transition-all"
                            placeholder="Search sessions by path or model..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                </div>

                {/* Sessions List */}
                <div className="flex-1 overflow-auto p-8">
                    {filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-zinc-500">
                            <Clock size={48} className="mb-4 opacity-20" />
                            <p className="text-sm">
                                {search ? 'No sessions found matching your search.' : 'No session history yet. Start chatting to create sessions.'}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {filtered.map((session) => (
                                <div
                                    key={session.id}
                                    onClick={() => onReplay(session.id)}
                                    className="group flex items-center gap-4 p-4 rounded-xl hover:bg-[var(--bg-elevated)]/80 border border-transparent hover:border-[var(--border)] transition-all cursor-pointer"
                                >
                                    <div className="text-2xl">
                                        {getModeIcon(session.mode)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-bold text-sm text-zinc-100 truncate">{session.workspace_path}</span>
                                            <span className={clsx(
                                                "text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded",
                                                session.mode === 'Build' && "bg-blue-500/10 text-blue-400",
                                                session.mode === 'Plan' && "bg-purple-500/10 text-purple-400",
                                                session.mode === 'Research' && "bg-green-500/10 text-green-400"
                                            )}>
                                                {session.mode}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 text-xs text-zinc-500">
                                            <span className="font-mono">{session.model}</span>
                                            <span>•</span>
                                            <span>{formatDate(session.created_at)}</span>
                                            <span>•</span>
                                            <span>{session.message_count} messages</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleDelete.bind(null, session.id)}
                                        className="p-2 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-500 rounded-lg transition-all text-zinc-500"
                                        title="Delete session"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
