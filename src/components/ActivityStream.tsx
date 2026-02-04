import { useMemo } from 'react';
import { Message } from '../types';
import { ActionCard, ThinkingBlock, MessageCard } from './ActivityCards';
import clsx from 'clsx';

interface ActivityItem {
  id: string;
  type: 'message' | 'thinking' | 'action' | 'tool' | 'loading';
  role?: 'user' | 'assistant';
  content: string;
  actionType?: 'read' | 'write' | 'execute' | 'search' | 'edit' | 'generic';
  actionTitle?: string;
  actionDescription?: string;
  actionContent?: string;
  actionStatus?: 'pending' | 'running' | 'success' | 'error';
  isThinking?: boolean;
  timestamp?: string;
}

interface ActivityGroup {
  id: string;
  role: 'user' | 'assistant';
  items: ActivityItem[];
}

interface ActivityStreamProps {
  messages: Message[];
  isLoading?: boolean;
  view?: 'stream' | 'timeline';
}

function LoadingBlock() {
  return (
    <div data-testid="activity-loading" className="rounded-lg border border-white/5 bg-[var(--bg-base)]/40 px-4 py-3">
      <div className="space-y-2 animate-pulse">
        <div className="h-3 w-40 rounded bg-white/10" />
        <div className="h-3 w-64 rounded bg-white/5" />
        <div className="h-3 w-24 rounded bg-white/10" />
      </div>
    </div>
  );
}

export function ActivityStream({ messages, isLoading, view = 'stream' }: ActivityStreamProps) {
  // Parse messages into activity items
  const groups = useMemo(() => {
    const grouped: ActivityGroup[] = [];
    
    messages.forEach((msg, idx) => {
      const id = `activity-${idx}`;
      const items: ActivityItem[] = [];
      
      if (msg.role === 'User') {
        items.push({
          id,
          type: 'message',
          role: 'user',
          content: msg.content || '',
          timestamp: new Date().toLocaleTimeString()
        });
      } else if (msg.role === 'Assistant') {
        const content = msg.content || '';
        const isLastMessage = idx === messages.length - 1;
        const isEmptyAssistant = content.trim().length === 0;

        // Check if this is a thinking block by looking for thinking keywords or patterns
        const thinkingPatterns = [
          /^(?:thinking|analyzing|considering|pondering|reflecting)/i,
          /(?:let me think|i'll analyze|considering options)/i,
          /(?:step by step|breaking down|evaluating)/i
        ];
        
        const isThinkingContent = thinkingPatterns.some(pattern => pattern.test(content));
        
        if (isThinkingContent) {
          items.push({
            id,
            type: 'thinking',
            content: content,
            isThinking: false
          });
        }
        
        // Parse tool executions
        const toolPattern = /> Executing tool: `([^`]+)`[\s\S]*?(?:> Result:\s*)?```\n?([\s\S]*?)```/g;
        let match;
        
        while ((match = toolPattern.exec(content)) !== null) {
          const toolName = match[1];
          const result = match[2];
          
          // Determine action type and status
          let actionType: ActivityItem['actionType'] = 'generic';
          let actionStatus: ActivityItem['actionStatus'] = 'success';
          
          if (toolName.includes('read')) {
            actionType = 'read';
          } else if (toolName.includes('write')) {
            actionType = 'write';
          } else if (toolName.includes('edit') || toolName.includes('patch')) {
            actionType = 'edit';
          } else if (toolName.includes('bash') || toolName.includes('git') || toolName.includes('exec')) {
            actionType = 'execute';
          } else if (
            toolName.includes('search') ||
            toolName.includes('glob') ||
            toolName.includes('list') ||
            toolName.includes('symbol') ||
            toolName.includes('web')
          ) {
            actionType = 'search';
          }
          
          if (result.toLowerCase().includes('error') || result.toLowerCase().includes('denied')) {
            actionStatus = 'error';
          }
          
          items.push({
            id: `${id}-tool-${match.index}`,
            type: 'action',
            actionType,
            actionTitle: `${toolName}`,
            actionDescription: `Executing ${toolName}`,
            actionContent: result,
            actionStatus,
            content: ''
          });
        }
        
        // Add remaining content as message (excluding tool patterns)
        const cleanContent = content.replace(toolPattern, '').trim();
        if (cleanContent) {
          items.push({
            id: `${id}-msg`,
            type: 'message',
            role: 'assistant',
            content: cleanContent,
            timestamp: new Date().toLocaleTimeString()
          });
        }

        if (isLoading && isLastMessage && isEmptyAssistant) {
          items.push({
            id: `${id}-loading`,
            type: 'loading',
            content: ''
          });
        }
      }
      
      if (items.length > 0) {
        grouped.push({
          id: `group-${idx}`,
          role: msg.role === 'User' ? 'user' : 'assistant',
          items
        });
      }
    });
    
    return grouped;
  }, [messages, isLoading]);

  if (groups.length === 0 && !isLoading) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Activity Items */}
      <div className={clsx(view === 'timeline' && "relative")}
        data-testid={view === 'timeline' ? 'timeline-view' : undefined}
      >
        {view === 'timeline' && (
          <div
            data-testid="timeline-rail"
            className="absolute left-3 top-2 bottom-2 w-px bg-[var(--border)]"
          />
        )}
        <div className="space-y-3">
          {groups.map((group) => {
            const groupContainer = (
              <div
                className={clsx(
                  "relative overflow-hidden rounded-xl border px-4 py-3",
                  group.role === 'user'
                    ? "max-w-[85%] bg-transparent border-zinc-800/30"
                    : "w-full border-white/5 bg-[linear-gradient(180deg,rgba(139,92,246,0.08),rgba(24,24,27,0.55))] shadow-[0_10px_30px_rgba(0,0,0,0.2)]"
                )}
              >
                {group.role === 'assistant' && (
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(139,92,246,0.12),_transparent_60%)]" />
                )}
                <div className="relative z-10 space-y-3">
              {group.items.map((activity) => {
                switch (activity.type) {
                  case 'message':
                        return (
                          <MessageCard
                            key={activity.id}
                            role={activity.role!}
                            content={activity.content}
                            timestamp={activity.timestamp}
                          />
                        );
                        
                      case 'thinking':
                        return (
                          <ThinkingBlock
                            key={activity.id}
                            content={activity.content}
                            isThinking={activity.isThinking}
                          />
                        );
                        
                  case 'action':
                    return (
                          <ActionCard
                            key={activity.id}
                            type={activity.actionType!}
                            title={activity.actionTitle!}
                            description={activity.actionDescription}
                            content={activity.actionContent}
                            status={activity.actionStatus!}
                          />
                    );

                  case 'loading':
                    return (
                      <LoadingBlock key={activity.id} />
                    );
                  
                  default:
                    return null;
                }
              })}
                </div>
              </div>
            );

            if (view === 'timeline') {
              return (
                <div
                  key={group.id}
                  data-testid="activity-group"
                  className="relative flex gap-4 pl-8"
                >
                  <div
                    data-testid="timeline-node"
                    className={clsx(
                      "absolute left-2 top-4 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--bg-base)]",
                      group.role === 'user' ? "bg-zinc-500" : "bg-[var(--accent)]"
                    )}
                  />
                  {groupContainer}
                </div>
              );
            }

            return (
              <div
                key={group.id}
                data-testid="activity-group"
                className={clsx(
                  "flex",
                  group.role === 'user' ? "justify-end" : "justify-start"
                )}
              >
                {groupContainer}
              </div>
            );
          })}
        </div>
      </div>

      {/* Loading / Thinking Indicator - only show if no recent thinking content */}
      {isLoading && !groups.some(group => group.items.some(a => a.type === 'thinking' || a.type === 'loading')) && (
        <ThinkingBlock 
          content="Agent is analyzing your request and preparing a response..." 
          isThinking={true} 
        />
      )}
    </div>
  );
}

export default ActivityStream;
