import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { CheckCircle2, Circle, Clock, XCircle, AlertCircle, Trash2, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from "../store";

interface Task {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
}

interface TodoStats {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  cancelled: number;
}

interface TodoData {
  tasks: Task[];
  count: number;
  filter: string;
  stats: TodoStats;
  message?: string;
}

export function TodoPanel() {
  const { workspacePath } = useStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<TodoStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  // Fetch tasks on mount and when file changes
  const fetchTasks = async () => {
    if (!workspacePath) {
      setError('No workspace selected');
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      
      const result = await invoke<TodoData>('read_todos', {
        filter: 'all',
        workspacePath: workspacePath || ''
      });
      
      if (result.tasks) {
        setTasks(result.tasks);
      }
      if (result.stats) {
        setStats(result.stats);
      }
    } catch (err) {
      setError('Failed to load tasks');
      console.error('Error fetching tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();

    // Listen for task updates
    const unlisten = listen('tasks-updated', () => {
      fetchTasks();
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // Update task status
  const updateTaskStatus = async (taskId: string, newStatus: Task['status']) => {
    try {
      await invoke('write_todo', {
        action: 'update',
        id: taskId,
        status: newStatus,
        workspacePath: workspacePath || ''
      });
      
      // Refresh tasks
      fetchTasks();
    } catch (err) {
      console.error('Error updating task:', err);
    }
  };

  // Delete task
  const deleteTask = async (taskId: string) => {
    try {
      await invoke('write_todo', {
        action: 'delete',
        id: taskId,
        workspacePath: workspacePath || ''
      });
      
      // Refresh tasks
      fetchTasks();
    } catch (err) {
      console.error('Error deleting task:', err);
    }
  };

  // Get status icon
  const getStatusIcon = (status: Task['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 size={16} className="text-green-500" />;
      case 'in_progress':
        return <Clock size={16} className="text-blue-500" />;
      case 'cancelled':
        return <XCircle size={16} className="text-red-500" />;
      default:
        return <Circle size={16} className="text-gray-400" />;
    }
  };

  // Get priority badge
  const getPriorityBadge = (priority: Task['priority']) => {
    const colors = {
      high: 'bg-red-500/20 text-red-400 border-red-500/30',
      medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      low: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
    };

    return (
      <span className={clsx(
        'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border',
        colors[priority]
      )}>
        {priority}
      </span>
    );
  };

  // Group tasks by status
  const groupedTasks = {
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    pending: tasks.filter(t => t.status === 'pending'),
    completed: tasks.filter(t => t.status === 'completed'),
    cancelled: tasks.filter(t => t.status === 'cancelled')
  };

  if (!isExpanded) {
    return (
      <div className="w-12 bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col items-center py-4">
        <button
          onClick={() => setIsExpanded(true)}
          className="p-2 hover:bg-[var(--bg-elevated)] rounded-lg transition-colors"
          title="Show Tasks"
        >
          <AlertCircle size={20} className="text-[var(--accent)]" />
          {stats && stats.pending > 0 && (
            <span className="absolute top-2 right-2 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {stats.pending}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="w-72 bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center gap-2">
          <AlertCircle size={18} className="text-[var(--accent)]" />
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">Tasks</h3>
          {stats && (
            <span className="text-xs text-[var(--text-secondary)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded-full">
              {stats.total}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchTasks}
            disabled={loading}
            className="p-1.5 hover:bg-[var(--bg-elevated)] rounded-lg transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RotateCcw size={14} className={clsx("text-[var(--text-secondary)]", loading && "animate-spin")} />
          </button>
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1.5 hover:bg-[var(--bg-elevated)] rounded-lg transition-colors"
            title="Collapse"
          >
            <span className="text-[var(--text-secondary)] text-lg">›</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-1 p-3 border-b border-[var(--border)]">
          <div className="text-center">
            <div className="text-xs font-bold text-blue-400">{stats.in_progress}</div>
            <div className="text-[9px] text-[var(--text-secondary)] uppercase">Doing</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-bold text-yellow-400">{stats.pending}</div>
            <div className="text-[9px] text-[var(--text-secondary)] uppercase">Todo</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-bold text-green-400">{stats.completed}</div>
            <div className="text-[9px] text-[var(--text-secondary)] uppercase">Done</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-bold text-gray-400">{stats.cancelled}</div>
            <div className="text-[9px] text-[var(--text-secondary)] uppercase">Cancelled</div>
          </div>
        </div>
      )}

      {/* Tasks List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {error ? (
          <div className="text-center py-8">
            <AlertCircle size={24} className="text-red-500 mx-auto mb-2" />
            <p className="text-xs text-[var(--text-secondary)]">{error}</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-8">
            <Circle size={24} className="text-[var(--text-secondary)] mx-auto mb-2" />
            <p className="text-xs text-[var(--text-secondary)]">No tasks yet</p>
            <p className="text-[10px] text-[var(--text-secondary)] mt-1">
              Use todowrite tool to add tasks
            </p>
          </div>
        ) : (
          <>
            {/* In Progress */}
            {groupedTasks.in_progress.length > 0 && (
              <div>
                <h4 className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Clock size={10} /> In Progress ({groupedTasks.in_progress.length})
                </h4>
                <div className="space-y-2">
                  {groupedTasks.in_progress.map(task => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      onStatusChange={updateTaskStatus}
                      onDelete={deleteTask}
                      getStatusIcon={getStatusIcon}
                      getPriorityBadge={getPriorityBadge}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Pending */}
            {groupedTasks.pending.length > 0 && (
              <div>
                <h4 className="text-[10px] font-bold text-yellow-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Circle size={10} /> Pending ({groupedTasks.pending.length})
                </h4>
                <div className="space-y-2">
                  {groupedTasks.pending.map(task => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      onStatusChange={updateTaskStatus}
                      onDelete={deleteTask}
                      getStatusIcon={getStatusIcon}
                      getPriorityBadge={getPriorityBadge}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Completed */}
            {groupedTasks.completed.length > 0 && (
              <div>
                <h4 className="text-[10px] font-bold text-green-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <CheckCircle2 size={10} /> Completed ({groupedTasks.completed.length})
                </h4>
                <div className="space-y-2">
                  {groupedTasks.completed.map(task => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      onStatusChange={updateTaskStatus}
                      onDelete={deleteTask}
                      getStatusIcon={getStatusIcon}
                      getPriorityBadge={getPriorityBadge}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Cancelled */}
            {groupedTasks.cancelled.length > 0 && (
              <div>
                <h4 className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <XCircle size={10} /> Cancelled ({groupedTasks.cancelled.length})
                </h4>
                <div className="space-y-2">
                  {groupedTasks.cancelled.map(task => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      onStatusChange={updateTaskStatus}
                      onDelete={deleteTask}
                      getStatusIcon={getStatusIcon}
                      getPriorityBadge={getPriorityBadge}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Task Item Component
interface TaskItemProps {
  task: Task;
  onStatusChange: (id: string, status: Task['status']) => void;
  onDelete: (id: string) => void;
  getStatusIcon: (status: Task['status']) => React.ReactNode;
  getPriorityBadge: (priority: Task['priority']) => React.ReactNode;
}

function TaskItem({ task, onStatusChange, onDelete, getStatusIcon, getPriorityBadge }: TaskItemProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="group bg-[var(--bg-base)] border border-[var(--border)] rounded-lg p-2.5 hover:border-[var(--accent)]/30 transition-all"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-start gap-2">
        <button
          onClick={() => {
            const nextStatus = task.status === 'completed' ? 'pending' : 'completed';
            onStatusChange(task.id, nextStatus);
          }}
          className="mt-0.5 flex-shrink-0 hover:opacity-70 transition-opacity"
        >
          {getStatusIcon(task.status)}
        </button>
        
        <div className="flex-1 min-w-0">
          <p className={clsx(
            "text-xs text-[var(--text-primary)] leading-relaxed",
            task.status === 'completed' && "line-through text-[var(--text-secondary)]"
          )}>
            {task.content}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            {getPriorityBadge(task.priority)}
            <span className="text-[9px] text-[var(--text-secondary)]">ID: {task.id}</span>
          </div>
        </div>

        {/* Actions */}
        {isHovered && (
          <div className="flex items-center gap-1">
            {task.status !== 'in_progress' && task.status !== 'completed' && (
              <button
                onClick={() => onStatusChange(task.id, 'in_progress')}
                className="p-1 hover:bg-blue-500/20 rounded transition-colors"
                title="Start"
              >
                <Clock size={12} className="text-blue-400" />
              </button>
            )}
            <button
              onClick={() => onDelete(task.id)}
              className="p-1 hover:bg-red-500/20 rounded transition-colors"
              title="Delete"
            >
              <Trash2 size={12} className="text-red-400" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
