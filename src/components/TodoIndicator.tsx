import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, Circle, Clock } from 'lucide-react';
import { useStore } from '../store';
import clsx from 'clsx';

interface TodoStats {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
}

export function TodoIndicator() {
  const [stats, setStats] = useState<TodoStats | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const { workspacePath } = useStore();

  useEffect(() => {
    if (!workspacePath) return;

    const fetchStats = async () => {
      try {
        const result = await invoke<any>('read_todos', {
          workspacePath,
          filter: 'all'
        });
        
        if (result.stats) {
          setStats(result.stats);
        }
      } catch (err) {
        // Silent fail - no tasks yet is OK
      }
    };

    fetchStats();
    
    // Refresh every 5 seconds
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [workspacePath]);

  if (!stats || stats.total === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={clsx(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all",
          stats.in_progress > 0 
            ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
            : stats.pending > 0
              ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
              : "bg-green-500/20 text-green-400 hover:bg-green-500/30"
        )}
      >
        {stats.in_progress > 0 ? (
          <Clock size={12} className="animate-pulse" />
        ) : stats.pending > 0 ? (
          <Circle size={12} />
        ) : (
          <CheckCircle2 size={12} />
        )}
        <span>
          {stats.in_progress > 0 
            ? `${stats.in_progress} in progress`
            : stats.pending > 0 
              ? `${stats.pending} pending`
              : `${stats.completed} done`
          }
        </span>
        {stats.total > 0 && (
          <span className="text-[10px] opacity-60">
            ({stats.completed}/{stats.total})
          </span>
        )}
      </button>

      {/* Mini popup when expanded */}
      {isExpanded && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-xl z-50 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--text-primary)]">Agent Tasks</span>
            <button 
              onClick={() => setIsExpanded(false)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              ×
            </button>
          </div>
          <div className="space-y-1.5">
            {stats.in_progress > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-blue-400 flex items-center gap-1">
                  <Clock size={10} /> In Progress
                </span>
                <span className="font-medium">{stats.in_progress}</span>
              </div>
            )}
            {stats.pending > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-yellow-400 flex items-center gap-1">
                  <Circle size={10} /> Pending
                </span>
                <span className="font-medium">{stats.pending}</span>
              </div>
            )}
            {stats.completed > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-green-400 flex items-center gap-1">
                  <CheckCircle2 size={10} /> Completed
                </span>
                <span className="font-medium">{stats.completed}</span>
              </div>
            )}
          </div>
          <div className="mt-2 pt-2 border-t border-[var(--border)] text-[10px] text-[var(--text-secondary)]">
            Agent tracks tasks in .anvil/TODO.md
          </div>
        </div>
      )}
    </div>
  );
}
