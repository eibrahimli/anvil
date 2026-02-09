import React, { useState } from 'react';
import { ChevronDown, ChevronUp, FileText, Terminal, Search, Edit, CheckCircle, XCircle, Loader2, Sparkles, Brain, ListChecks, Circle } from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown, { Components } from 'react-markdown';
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
    running: 'text-blue-300',
    success: 'text-emerald-300',
    error: 'text-red-300'
  };

  const statusBgColors = {
    pending: 'bg-[var(--bg-base)]/35 border-[var(--border)]/60',
    running: 'bg-blue-500/5 border-blue-500/20',
    success: 'bg-emerald-500/5 border-emerald-500/20',
    error: 'bg-red-500/5 border-red-500/20'
  };

  const statusLabels = {
    pending: 'Queued',
    running: 'Running',
    success: 'Done',
    error: 'Error'
  };

  const Icon = icons[type];
  const StatusIcon = statusIcons[status];

  return (
    <div className={clsx(
      "rounded-xl border overflow-hidden transition-all duration-200",
      statusBgColors[status]
    )}>
      <div 
        className={clsx(
          "flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-[var(--bg-base)]/40 transition-colors",
          !isCollapsible && "cursor-default"
        )}
        onClick={() => isCollapsible && setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--bg-base)]/40 border border-[var(--border)]/60">
          <Icon size={13} className="text-zinc-400" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-zinc-200 truncate font-mono">
            {title}
            {description && (
              <span className="text-[10px] text-zinc-500 font-mono ml-2">
                {description}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className={clsx(
            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.16em]",
            status === 'error' ? "border-red-500/30 text-red-300" :
            status === 'success' ? "border-emerald-500/30 text-emerald-300" :
            status === 'running' ? "border-blue-500/30 text-blue-300" :
            "border-[var(--border)]/70 text-zinc-400"
          )}>
            <StatusIcon 
              size={10} 
              className={clsx(
                statusColors[status],
                status === 'running' && "animate-spin"
              )} 
            />
            <span>{statusLabels[status]}</span>
          </div>
          
          {isCollapsible && (
            <button className="p-1 hover:bg-white/10 rounded transition-colors">
              {isCollapsed ? (
                <ChevronDown size={12} className="text-zinc-500" />
              ) : (
                <ChevronUp size={12} className="text-zinc-500" />
              )}
            </button>
          )}
        </div>
      </div>

      {!isCollapsed && content && (
        <div className="px-3 py-2 border-t border-[var(--border)]/60 bg-[var(--bg-base)]/30">
          <div className="mb-1 text-[9px] uppercase tracking-[0.2em] text-zinc-500">Output</div>
          <pre className="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap break-all max-h-56 overflow-y-auto">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

interface PlanStep {
  text: string;
  status: 'pending' | 'completed';
}

interface PlanCardProps {
  title?: string;
  steps: PlanStep[];
}

export function PlanCard({ title = 'Tasks', steps }: PlanCardProps) {
  const completedCount = steps.filter((step) => step.status === 'completed').length;
  const totalCount = steps.length;

  return (
    <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--bg-base)]/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]/60">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--bg-base)]/40 border border-[var(--border)]/60">
            <ListChecks size={13} className="text-[var(--accent)]" />
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
            {title}
          </div>
        </div>
        <div className="text-[10px] text-zinc-500 font-mono">
          {completedCount}/{totalCount} done
        </div>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {steps.map((step, index) => (
          <div key={`${step.text}-${index}`} className="flex items-start gap-2 text-[12px]">
            {step.status === 'completed' ? (
              <CheckCircle size={12} className="mt-0.5 text-emerald-400" />
            ) : (
              <Circle size={12} className="mt-0.5 text-zinc-500" />
            )}
            <span className={clsx(
              "leading-relaxed",
              step.status === 'completed' ? "text-zinc-500 line-through" : "text-zinc-300"
            )}>
              <span className="mr-2 text-zinc-500 font-mono text-[11px]">{index + 1}.</span>
              {step.text}
            </span>
          </div>
        ))}
      </div>
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
    <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/20 overflow-hidden">
      <div 
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => hasMore && setIsExpanded(!isExpanded)}
      >
        {isThinking ? (
          <Loader2 size={12} className="text-zinc-400 animate-spin" />
        ) : (
          <Brain size={12} className="text-zinc-500" />
        )}
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          {isThinking ? 'Thinking' : 'Reasoning'}
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
        "px-3 py-2 text-[11px] text-zinc-500 italic",
        !isExpanded && hasMore && "line-clamp-2"
      )}>
        {preview}
      </div>
    </div>
  );
}

interface MessageCardProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: { name: string; mime_type: string; data: string }[];
  meta?: string;
}

function highlightMentions(text: string) {
  const mentionRegex = /@[\w./-]+/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(text)) !== null) {
    const start = match.index;
    const value = match[0];
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }
    parts.push(
      <span
        key={`mention-${start}-${value}`}
        className="rounded-md bg-[var(--accent)]/15 px-1 py-0.5 font-mono text-[12px] text-[var(--accent)]"
      >
        {value}
      </span>
    );
    lastIndex = start + value.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function renderMentions(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return highlightMentions(child);
    }
    if (!React.isValidElement(child)) {
      return child;
    }
    if (typeof child.type === 'string' && (child.type === 'code' || child.type === 'pre')) {
      return child;
    }
    const childProps = child.props as { children?: React.ReactNode };
    if (childProps?.children) {
      const typedChild = child as React.ReactElement<{ children?: React.ReactNode }>;
      return React.cloneElement(typedChild, {
        children: renderMentions(childProps.children)
      });
    }
    return child;
  });
}

export function MessageCard({ role, content, attachments, meta }: MessageCardProps) {
  const isUser = role === 'user';
  const isSystem = role === 'system';

  const sections = !isUser ? splitResponseSections(content) : [];
  const markdownComponents: Components = {
    p: ({ children }) => <p>{renderMentions(children)}</p>,
    li: ({ children }) => <li>{renderMentions(children)}</li>
  };

  return (
    <div className="flex items-start gap-3">
        <div className={clsx(
        "mt-0.5 w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0",
        isUser
          ? "bg-[var(--bg-base)]/40 text-zinc-400 border border-[var(--border)]/50"
          : isSystem
            ? "bg-yellow-500/15 text-yellow-300 border border-yellow-500/20"
            : "bg-[var(--accent)]/15 text-[var(--accent)]"
      )}>
        {isUser ? (
          <span className="text-[10px] font-bold">U</span>
        ) : isSystem ? (
          <span className="text-[10px] font-bold">S</span>
        ) : (
          <Sparkles size={12} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-4 text-[10px] uppercase tracking-[0.22em] text-zinc-500 font-bold">
          <span>{isUser ? 'You' : isSystem ? 'System' : 'Agent'}</span>
          {!isUser && meta && (
            <span className="text-[9px] tracking-[0.18em] text-zinc-600 font-semibold">{meta}</span>
          )}
        </div>
        {isUser || isSystem ? (
          <div className="mt-1 text-[13px] leading-relaxed text-zinc-300 prose prose-invert prose-sm max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-strong:text-zinc-200">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            {sections.map((section, index) => (
              <div key={`${section.title}-${index}`} className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/20 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-semibold">
                  {section.title}
                </div>
                <div className="mt-1 text-[13px] leading-relaxed text-zinc-300 prose prose-invert prose-sm max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-strong:text-zinc-200">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {section.body}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
        )}
        {isUser && attachments && attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((attachment, index) => (
              <img
                key={`${attachment.name}-${index}`}
                src={`data:${attachment.mime_type};base64,${attachment.data}`}
                alt={attachment.name}
                className="w-20 h-20 rounded-lg object-cover border border-[var(--border)]"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function splitResponseSections(content: string) {
  const lines = content.split('\n');
  const sections: { title: string; body: string }[] = [];
  let currentTitle = 'Response';
  let currentBody: string[] = [];

  lines.forEach((line) => {
    const labelMatch = line.match(/^(Summary|Plan|Changes|Tests|Next(?: Steps)?):\s*(.*)$/i);
    if (labelMatch) {
      if (currentBody.join('\n').trim()) {
        sections.push({ title: currentTitle, body: currentBody.join('\n').trim() });
      }
      currentTitle = labelMatch[1];
      currentBody = [];
      if (labelMatch[2]) {
        currentBody.push(labelMatch[2]);
      }
      return;
    }
    const headingMatch = line.match(/^#{2,3}\s+(.*)$/);
    if (headingMatch) {
      if (currentBody.join('\n').trim()) {
        sections.push({ title: currentTitle, body: currentBody.join('\n').trim() });
      }
      currentTitle = headingMatch[1].trim();
      currentBody = [];
      return;
    }
    currentBody.push(line);
  });

  if (currentBody.join('\n').trim()) {
    sections.push({ title: currentTitle, body: currentBody.join('\n').trim() });
  }

  return sections.length ? sections : [{ title: 'Response', body: content }];
}

interface StatusIndicatorProps {
  status: 'planning' | 'researching' | 'implementing' | 'testing' | 'waiting' | 'done' | 'executing' | 'responding';
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
    responding: { icon: Sparkles, color: 'text-sky-400', bg: 'bg-sky-900/20', label: 'Responding' },
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
