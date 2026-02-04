import { useState } from 'react';
import { ChevronDown, ChevronUp, FileText, Terminal, Search, Edit, CheckCircle, XCircle, Loader2, Sparkles, Brain } from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ActionCardProps {
  type: 'read' | 'write' | 'execute' | 'search' | 'edit' | 'generic';
  title: string;
  description?: string;
  content?: string;
  status: 'pending' | 'running' | 'success' | 'error';
  isCollapsible?: boolean;
  defaultCollapsed?: boolean;
}

export function ActionCard({
  type,
  title,
  description,
  content,
  status,
  isCollapsible = true,
  defaultCollapsed = true
}: ActionCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const icons = {
    read: FileText,
    write: FileText,
    execute: Terminal,
    search: Search,
    edit: Edit,
    generic: Terminal
  };

  const statusIcons = {
    pending: Loader2,
    running: Loader2,
    success: CheckCircle,
    error: XCircle
  };

  const statusColors = {
    pending: 'text-zinc-400',
    running: 'text-blue-400',
    success: 'text-green-400',
    error: 'text-red-400'
  };

  const statusBgColors = {
    pending: 'bg-zinc-800/50 border-zinc-700',
    running: 'bg-blue-900/20 border-blue-800/50',
    success: 'bg-green-900/20 border-green-800/50',
    error: 'bg-red-900/20 border-red-800/50'
  };

  const Icon = icons[type];
  const StatusIcon = statusIcons[status];

  return (
    <div className={clsx(
      "rounded-lg border overflow-hidden transition-all duration-200",
      statusBgColors[status]
    )}>
      {/* Header */}
      <div 
        className={clsx(
          "flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-black/20 transition-colors",
          !isCollapsible && "cursor-default"
        )}
        onClick={() => isCollapsible && setIsCollapsed(!isCollapsed)}
      >
        <Icon size={16} className="text-zinc-400 flex-shrink-0" />
        
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-zinc-200 truncate">
            {title}
          </div>
          {description && (
            <div className="text-[10px] text-zinc-500 truncate">
              {description}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <StatusIcon 
            size={14} 
            className={clsx(
              statusColors[status],
              status === 'running' && "animate-spin"
            )} 
          />
          
          {isCollapsible && (
            <button className="p-1 hover:bg-white/10 rounded transition-colors">
              {isCollapsed ? (
                <ChevronDown size={14} className="text-zinc-500" />
              ) : (
                <ChevronUp size={14} className="text-zinc-500" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {!isCollapsed && content && (
        <div className="px-4 py-3 border-t border-zinc-800/50 bg-black/20">
          <pre className="text-xs font-mono text-zinc-400 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

interface ThinkingBlockProps {
  content: string;
  isThinking?: boolean;
}

export function ThinkingBlock({ content, isThinking = false }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const previewLength = 100;
  const hasMore = content.length > previewLength;
  const preview = hasMore && !isExpanded 
    ? content.slice(0, previewLength) + '...' 
    : content;

  return (
    <div className="rounded-lg border border-zinc-800/50 bg-zinc-900/30 overflow-hidden">
      <div 
        className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => hasMore && setIsExpanded(!isExpanded)}
      >
        {isThinking ? (
          <Loader2 size={14} className="text-zinc-400 animate-spin" />
        ) : (
          <Brain size={14} className="text-zinc-500" />
        )}
        <span className="text-xs font-medium text-zinc-400">
          {isThinking ? 'Agent is thinking...' : 'Thinking'}
        </span>
        {hasMore && (
          <button className="p-1 hover:bg-white/10 rounded transition-colors ml-auto">
            {isExpanded ? (
              <ChevronUp size={12} className="text-zinc-500" />
            ) : (
              <ChevronDown size={12} className="text-zinc-500" />
            )}
          </button>
        )}
      </div>
      
      <div className={clsx(
        "px-4 py-2 text-xs text-zinc-500 italic",
        !isExpanded && hasMore && "line-clamp-2"
      )}>
        {preview}
      </div>
    </div>
  );
}

interface MessageCardProps {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export function MessageCard({ role, content, timestamp }: MessageCardProps) {
  const isUser = role === 'user';

  return (
    <div className={clsx(
      "flex gap-3",
      isUser ? "flex-row-reverse" : "flex-row"
    )}>
      <div className={clsx(
        "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0",
        isUser ? "bg-zinc-800 text-zinc-400" : "bg-[var(--accent)]/20 text-[var(--accent)]"
      )}>
        {isUser ? (
          <span className="text-xs font-bold">U</span>
        ) : (
          <Sparkles size={14} />
        )}
      </div>

      <div className={clsx(
        "flex flex-col max-w-[85%]",
        isUser ? "items-end" : "items-start"
      )}>
        <div className={clsx(
          "rounded-xl px-4 py-3 text-sm prose prose-invert prose-sm max-w-none",
          isUser 
            ? "bg-zinc-800 text-zinc-200 rounded-tr-none" 
            : "bg-transparent text-zinc-300"
        )}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        </div>
        {timestamp && (
          <span className="text-[10px] text-zinc-600 mt-1">
            {timestamp}
          </span>
        )}
      </div>
    </div>
  );
}

interface StatusIndicatorProps {
  status: 'planning' | 'researching' | 'implementing' | 'testing' | 'waiting' | 'done' | 'executing';
  message?: string;
}

export function StatusIndicator({ status, message }: StatusIndicatorProps) {
  const statusConfig = {
    planning: { icon: Brain, color: 'text-blue-400', bg: 'bg-blue-900/20', label: 'Planning' },
    researching: { icon: Search, color: 'text-yellow-400', bg: 'bg-yellow-900/20', label: 'Researching' },
    implementing: { icon: Edit, color: 'text-green-400', bg: 'bg-green-900/20', label: 'Implementing' },
    executing: { icon: Terminal, color: 'text-cyan-400', bg: 'bg-cyan-900/20', label: 'Executing' },
    testing: { icon: Terminal, color: 'text-purple-400', bg: 'bg-purple-900/20', label: 'Testing' },
    waiting: { icon: CheckCircle, color: 'text-orange-400', bg: 'bg-orange-900/20', label: 'Waiting' },
    done: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-900/20', label: 'Done' }
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={clsx(
      "flex items-center gap-2 px-3 py-2 rounded-lg border",
      config.bg,
      "border-zinc-800"
    )}>
      <Icon size={14} className={config.color} />
      <span className={clsx("text-xs font-medium", config.color)}>
        {message || config.label}
      </span>
    </div>
  );
}
