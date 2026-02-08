import { useMemo } from 'react';
import { Message } from '../types';
import { ActionCard, ThinkingBlock, MessageCard, PlanCard } from './ActivityCards';
import clsx from 'clsx';

interface ActivityItem {
  id: string;
  type: 'user' | 'assistant' | 'tool' | 'loading' | 'plan';
  content?: string;
  toolCallId?: string;
  toolName?: string;
  actionType?: 'read' | 'write' | 'execute' | 'search' | 'edit' | 'generic';
  actionTitle?: string;
  actionDescription?: string;
  actionContent?: string;
  actionStatus?: 'pending' | 'running' | 'success' | 'error';
  planSteps?: { text: string; status: 'pending' | 'completed' }[];
}

interface ActivityTurn {
  id: string;
  items: ActivityItem[];
}

interface ActivityStreamProps {
  messages: Message[];
  isLoading?: boolean;
  view?: 'stream' | 'timeline';
}

function LoadingBlock() {
  return (
    <div data-testid="activity-loading" className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/30 px-3 py-2">
      <div className="space-y-2 animate-pulse">
        <div className="h-2.5 w-40 rounded bg-white/10" />
        <div className="h-2.5 w-64 rounded bg-white/5" />
        <div className="h-2.5 w-24 rounded bg-white/10" />
      </div>
    </div>
  );
}

function truncateOutput(content: string, maxChars = 1400) {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n...`;
}

function stripLegacyToolLog(content: string) {
  return content
    .replace(/> Executing tool: `[^`]+`[^\n]*\n?/g, "")
    .replace(/> Result:\s*```[\s\S]*?```/g, "")
    .replace(/> Result:[^\n]*\n?/g, "")
    .trim();
}

function extractPlanSteps(content: string) {
  const lines = content.split('\n');
  const steps: { text: string; status: 'pending' | 'completed' }[] = [];
  const remaining: string[] = [];
  let inPlanBlock = false;

  lines.forEach((line) => {
    const trimmed = line.trim();
    const numbered = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    const checkbox = trimmed.match(/^[\-*]\s+\[( |x|X)\]\s+(.*)$/);
    const bullet = trimmed.match(/^[\-*]\s+(.*)$/);

    if (numbered || checkbox) {
      inPlanBlock = true;
      if (checkbox) {
        steps.push({
          text: checkbox[2].trim(),
          status: checkbox[1].toLowerCase() === 'x' ? 'completed' : 'pending'
        });
      } else {
        steps.push({
          text: (numbered?.[2] || '').trim(),
          status: 'pending'
        });
      }
      return;
    }

    if (inPlanBlock && bullet) {
      steps.push({ text: bullet[1].trim(), status: 'pending' });
      return;
    }

    if (inPlanBlock && trimmed === '') {
      return;
    }

    if (inPlanBlock && trimmed !== '' && !numbered && !checkbox && !bullet) {
      inPlanBlock = false;
    }

    remaining.push(line);
  });

  return {
    steps: steps.filter((step) => step.text.length > 0),
    remaining: remaining.join('\n').trim()
  };
}

function parseArguments(rawArgs: string) {
  if (!rawArgs) return null;
  try {
    return JSON.parse(rawArgs);
  } catch {
    return null;
  }
}

function summarizeToolCall(toolName: string, rawArgs: string) {
  const args = parseArguments(rawArgs) ?? {};
  const normalize = (value: unknown) => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) return value.join(', ');
    return '';
  };

  const mappings: Record<string, { type: ActivityItem['actionType']; desc: string | null }> = {
    read_file: { type: 'read', desc: normalize(args.path) },
    write_file: { type: 'write', desc: normalize(args.path) },
    edit_file: { type: 'edit', desc: normalize(args.path) },
    patch: { type: 'edit', desc: normalize(args.path) },
    list: { type: 'search', desc: normalize(args.path ?? '.') },
    glob: { type: 'search', desc: normalize(args.pattern) },
    search: { type: 'search', desc: normalize(args.pattern) },
    grep: { type: 'search', desc: normalize(args.pattern) },
    webfetch: { type: 'search', desc: normalize(args.url) },
    lsp: { type: 'search', desc: normalize(args.request) },
    bash: { type: 'execute', desc: normalize(args.command) },
    task: { type: 'generic', desc: normalize(args.subagent_type) },
    todoread: { type: 'generic', desc: normalize(args.filter) },
    todowrite: { type: 'generic', desc: normalize(args.action) },
    skill: { type: 'generic', desc: normalize(args.skill_name) }
  };

  const normalizedName = toolName.toLowerCase();
  if (normalizedName in mappings) {
    const entry = mappings[normalizedName];
    return {
      actionType: entry.type,
      title: toolName,
      description: entry.desc || undefined
    };
  }

  const trimmedArgs = rawArgs.length > 160 ? `${rawArgs.slice(0, 160)}...` : rawArgs;
  return {
    actionType: 'generic' as const,
    title: toolName,
    description: trimmedArgs || undefined
  };
}

function isErrorContent(content: string) {
  const lowered = content.toLowerCase();
  return lowered.includes('error') || lowered.includes('denied') || lowered.startsWith('err');
}

export function ActivityStream({ messages, isLoading, view = 'stream' }: ActivityStreamProps) {
  const turns = useMemo(() => {
    const list: ActivityTurn[] = [];
    let currentTurn: ActivityTurn | null = null;
    const toolIndex = new Map<string, { turn: ActivityTurn; itemIndex: number }>();
    const completedToolCalls = new Set(
      messages
        .filter((msg) => msg.role === 'Tool')
        .map((msg) => msg.tool_call_id)
        .filter((id): id is string => Boolean(id))
    );

    const ensureTurn = () => {
      if (!currentTurn) {
        currentTurn = { id: `turn-${list.length}`, items: [] };
        list.push(currentTurn);
      }
      return currentTurn;
    };

    messages.forEach((msg, idx) => {
      if (msg.role === 'System') {
        return;
      }

      if (msg.role === 'User') {
        currentTurn = { id: `turn-${idx}`, items: [] };
        list.push(currentTurn);
        currentTurn.items.push({
          id: `user-${idx}`,
          type: 'user',
          content: msg.content || ''
        });
        return;
      }

      const turn = ensureTurn();

      if (msg.role === 'Assistant') {
        const content = stripLegacyToolLog((msg.content || '').trim());
        if (content) {
          const extracted = extractPlanSteps(content);
          if (extracted.steps.length > 0) {
            turn.items.push({
              id: `plan-${idx}`,
              type: 'plan',
              planSteps: extracted.steps
            });
          }

          if (extracted.remaining) {
            turn.items.push({
              id: `assistant-${idx}`,
              type: 'assistant',
              content: extracted.remaining
            });
          }
        }

        if (Array.isArray(msg.tool_calls)) {
          msg.tool_calls.forEach((call, callIdx) => {
            const summary = summarizeToolCall(call.name, call.arguments);
            const status: ActivityItem['actionStatus'] = completedToolCalls.has(call.id)
              ? 'success'
              : (isLoading ? 'running' : 'pending');
            const item: ActivityItem = {
              id: `tool-${idx}-${callIdx}`,
              type: 'tool',
              toolCallId: call.id,
              toolName: call.name,
              actionType: summary.actionType,
              actionTitle: summary.title,
              actionDescription: summary.description,
              actionStatus: status
            };
            toolIndex.set(call.id, { turn, itemIndex: turn.items.length });
            turn.items.push(item);
          });
        }
        return;
      }

      if (msg.role === 'Tool') {
        const toolCallId = msg.tool_call_id;
        const resultContent = msg.content || '';
        const status: ActivityItem['actionStatus'] = isErrorContent(resultContent)
          ? 'error'
          : 'success';

        if (toolCallId && toolIndex.has(toolCallId)) {
          const ref = toolIndex.get(toolCallId);
          if (ref) {
            const existing = ref.turn.items[ref.itemIndex];
            ref.turn.items[ref.itemIndex] = {
              ...existing,
              actionContent: truncateOutput(resultContent),
              actionStatus: status
            };
            return;
          }
        }

        turn.items.push({
          id: `tool-result-${idx}`,
          type: 'tool',
          actionType: 'generic',
          actionTitle: 'Tool result',
          actionDescription: toolCallId ? `Call ${toolCallId}` : undefined,
          actionContent: truncateOutput(resultContent),
          actionStatus: status
        });
      }
    });

    return list.filter(turn => turn.items.length > 0);
  }, [messages, isLoading]);

  if (turns.length === 0 && !isLoading) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className={clsx(view === 'timeline' && "relative")}
        data-testid={view === 'timeline' ? 'timeline-view' : undefined}
      >
        {view === 'timeline' && (
          <div
            data-testid="timeline-rail"
            className="absolute left-3 top-2 bottom-2 w-px bg-[var(--border)]"
          />
        )}
        <div className="space-y-2.5">
          {turns.map((turn) => {
            const hasUser = turn.items.some(item => item.type === 'user');
            const turnContainer = (
              <div className="relative overflow-hidden rounded-xl border border-[var(--border)]/55 bg-[var(--bg-base)]/30 px-3 py-2.5">
                <div className="relative z-10 space-y-2">
                  {turn.items.map((activity) => {
                    switch (activity.type) {
                      case 'user':
                        return (
                          <MessageCard
                            key={activity.id}
                            role="user"
                            content={activity.content || ''}
                          />
                        );
                      case 'assistant':
                        return (
                          <MessageCard
                            key={activity.id}
                            role="assistant"
                            content={activity.content || ''}
                          />
                        );
                      case 'tool':
                        return (
                          <ActionCard
                            key={activity.id}
                            type={activity.actionType || 'generic'}
                            title={activity.actionTitle || activity.toolName || 'Tool'}
                            description={activity.actionDescription}
                            content={activity.actionContent}
                            status={activity.actionStatus || 'pending'}
                            defaultCollapsed={activity.actionStatus !== 'error'}
                          />
                        );
                      case 'plan':
                        return (
                          <PlanCard
                            key={activity.id}
                            steps={activity.planSteps || []}
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
                  key={turn.id}
                  data-testid="activity-group"
                  className="relative flex gap-4 pl-8"
                >
                  <div
                    data-testid="timeline-node"
                    className={clsx(
                      "absolute left-2 top-5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--bg-base)]",
                      hasUser ? "bg-zinc-500" : "bg-[var(--accent)]"
                    )}
                  />
                  {turnContainer}
                </div>
              );
            }

            return (
              <div
                key={turn.id}
                data-testid="activity-group"
                className="flex justify-start"
              >
                {turnContainer}
              </div>
            );
          })}
        </div>
      </div>

      {isLoading && turns.length > 0 && !turns.some(turn => turn.items.some(item => item.type === 'tool' && item.actionStatus === 'running')) && (
        <ThinkingBlock 
          content="Agent is preparing the next step..." 
          isThinking={true} 
        />
      )}
    </div>
  );
}

export default ActivityStream;
