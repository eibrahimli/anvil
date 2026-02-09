import { useEffect, useRef, useState } from "react";
import { Gauge, X } from "lucide-react";
import clsx from "clsx";
import { StatusIndicator } from "./ActivityCards";
import type { UsageEstimate } from "../utils/usage";

export type AgentStatus = "planning" | "researching" | "implementing" | "executing" | "testing" | "waiting" | "done" | "responding";

interface StatusBarProps {
    status: AgentStatus;
    message: string;
    detail?: string;
    usage?: UsageEstimate;
    contextMeta?: {
        sessionLabel?: string;
        sessionId?: string;
        workspace?: string;
        provider?: string;
        model?: string;
        mode?: string;
        sessionStarted?: string;
        lastActivity?: string;
        rawMessages?: { id: string; role: string; time: string }[];
    };
}

const statusMeta: Record<AgentStatus, { dot: string; label: string }> = {
    planning: { dot: "bg-blue-400", label: "Planning" },
    researching: { dot: "bg-yellow-400", label: "Researching" },
    implementing: { dot: "bg-green-400", label: "Implementing" },
    executing: { dot: "bg-cyan-400", label: "Executing" },
    testing: { dot: "bg-purple-400", label: "Testing" },
    waiting: { dot: "bg-orange-400", label: "Waiting" },
    responding: { dot: "bg-sky-400", label: "Responding" },
    done: { dot: "bg-emerald-400", label: "Done" }
};

export function StatusBar({ status, message, detail, usage, contextMeta }: StatusBarProps) {
    const meta = statusMeta[status];
    const [isUsageOpen, setIsUsageOpen] = useState(false);
    const usageRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClick = (event: MouseEvent) => {
            if (!usageRef.current) return;
            if (!usageRef.current.contains(event.target as Node)) {
                setIsUsageOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    const usagePercent = usage?.contextLimit
        ? Math.min(100, Math.round((usage.totalTokens / usage.contextLimit) * 100))
        : null;

    return (
        <div className="relative z-10 overflow-visible border-b border-[var(--border)] bg-[var(--bg-base)]/75 backdrop-blur-md">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(139,92,246,0.08),_transparent_55%)]" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,_transparent,_rgba(148,163,184,0.35),_transparent)]" />

            <div className="relative flex items-center justify-between gap-4 px-6 py-2">
                <div className="flex items-center gap-3">
                    <StatusIndicator status={status} message={message} />
                    {detail && (
                        <span className="text-[11px] font-medium tracking-wide text-[var(--text-secondary)]">
                            {detail}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 rounded-full border border-white/5 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                        <span
                            className={clsx(
                                "w-1.5 h-1.5 rounded-full",
                                meta.dot,
                                status !== "done" && "animate-pulse"
                            )}
                        />
                        <span>{meta.label}</span>
                    </div>
                    <div className="relative" ref={usageRef}>
                        <button
                            type="button"
                            onClick={() => setIsUsageOpen((open) => !open)}
                            className="flex items-center gap-2 rounded-full border border-white/5 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-400 hover:bg-white/10 transition-colors"
                        >
                            <Gauge size={12} className="text-zinc-400" />
                            <span>Context</span>
                        </button>
                        {isUsageOpen && (
                            <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl overflow-hidden z-50">
                                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-base)]">
                                    <div>
                                        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-semibold">Context</div>
                                        <div className="text-xs text-zinc-300">Session overview</div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsUsageOpen(false)}
                                        className="p-1 rounded-md hover:bg-white/10 text-zinc-400"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                                <div className="px-4 py-3 space-y-4">
                                    <div className="grid grid-cols-2 gap-3 text-[11px] text-zinc-500">
                                        <div>
                                            <div className="uppercase tracking-[0.18em]">Session</div>
                                            <div className="text-zinc-200 font-mono text-[11px]">
                                                {contextMeta?.sessionLabel || contextMeta?.sessionId || "N/A"}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="uppercase tracking-[0.18em]">Provider</div>
                                            <div className="text-zinc-200 font-mono text-[11px]">
                                                {contextMeta?.provider || "N/A"}
                                            </div>
                                        </div>
                                        {contextMeta?.sessionId && (
                                            <div>
                                                <div className="uppercase tracking-[0.18em]">Session ID</div>
                                                <div className="text-zinc-200 font-mono text-[11px]">
                                                    {contextMeta.sessionId}
                                                </div>
                                            </div>
                                        )}
                                        <div>
                                            <div className="uppercase tracking-[0.18em]">Model</div>
                                            <div className="text-zinc-200 font-mono text-[11px]">
                                                {contextMeta?.model || "N/A"}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="uppercase tracking-[0.18em]">Mode</div>
                                            <div className="text-zinc-200 font-mono text-[11px]">
                                                {contextMeta?.mode || "N/A"}
                                            </div>
                                        </div>
                                    </div>
                                    {contextMeta?.workspace && (
                                        <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/40 px-3 py-2">
                                            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Workspace</div>
                                            <div className="text-[11px] text-zinc-200 font-mono break-all">{contextMeta.workspace}</div>
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between text-xs text-zinc-400">
                                        <span>Total tokens</span>
                                        <span className="font-mono text-zinc-200">{usage?.totalTokens ?? 0}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
                                        <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/40 px-2 py-1.5">
                                            <div className="uppercase tracking-[0.18em]">Prompt</div>
                                            <div className="text-zinc-200 font-mono">{usage?.promptTokens ?? 0}</div>
                                        </div>
                                        <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/40 px-2 py-1.5">
                                            <div className="uppercase tracking-[0.18em]">Completion</div>
                                            <div className="text-zinc-200 font-mono">{usage?.completionTokens ?? 0}</div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
                                        <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/40 px-2 py-1.5">
                                            <div className="uppercase tracking-[0.18em]">Messages</div>
                                            <div className="text-zinc-200 font-mono">{usage?.messageCount ?? 0}</div>
                                        </div>
                                        <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/40 px-2 py-1.5">
                                            <div className="uppercase tracking-[0.18em]">User</div>
                                            <div className="text-zinc-200 font-mono">{usage?.userCount ?? 0}</div>
                                        </div>
                                    </div>
                                    <div className="text-[10px] text-zinc-500">
                                        Message counts: {usage?.messageCount ?? 0} total, {usage?.userCount ?? 0} user, {usage?.assistantCount ?? 0} assistant.
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
                                        <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/40 px-2 py-1.5">
                                            <div className="uppercase tracking-[0.18em]">Assistant</div>
                                            <div className="text-zinc-200 font-mono">{usage?.assistantCount ?? 0}</div>
                                        </div>
                                        <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/40 px-2 py-1.5">
                                            <div className="uppercase tracking-[0.18em]">Tool calls</div>
                                            <div className="text-zinc-200 font-mono">{usage?.toolCallCount ?? 0}</div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
                                        <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/40 px-2 py-1.5">
                                            <div className="uppercase tracking-[0.18em]">Tool msgs</div>
                                            <div className="text-zinc-200 font-mono">{usage?.toolCount ?? 0}</div>
                                        </div>
                                        <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/40 px-2 py-1.5">
                                            <div className="uppercase tracking-[0.18em]">Completion</div>
                                            <div className="text-zinc-200 font-mono">{usage?.completionTokens ?? 0}</div>
                                        </div>
                                    </div>
                                    <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/40 px-3 py-2">
                                        <div className="flex items-center justify-between text-[11px] text-zinc-500">
                                            <span>Context window</span>
                                            <span className="font-mono text-zinc-200">
                                                {usage?.contextLimit ?? "N/A"}
                                            </span>
                                        </div>
                                        {usagePercent !== null && (
                                            <div className="mt-2 h-1.5 w-full rounded-full bg-black/30">
                                                <div
                                                    className="h-1.5 rounded-full bg-[var(--accent)]"
                                                    style={{ width: `${usagePercent}%` }}
                                                />
                                            </div>
                                        )}
                                        {usage?.remainingTokens !== undefined && (
                                            <div className="mt-1 text-[10px] text-zinc-500 font-mono">
                                                {usage.remainingTokens} tokens remaining
                                            </div>
                                        )}
                                    </div>
                                    <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/40 px-3 py-2">
                                        <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Context breakdown</div>
                                        <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-500">
                                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" />User</span>
                                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400" />Assistant</span>
                                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />Tool</span>
                                        </div>
                                        <div className="mt-2 h-2 w-full rounded-full bg-black/30 overflow-hidden flex">
                                            {usage && usage.totalTokens > 0 && (
                                                <>
                                                    <div
                                                        className="h-2 bg-blue-400"
                                                        style={{ width: `${Math.round((usage.userTokens / usage.totalTokens) * 100)}%` }}
                                                    />
                                                    <div
                                                        className="h-2 bg-purple-400"
                                                        style={{ width: `${Math.round((usage.assistantTokens / usage.totalTokens) * 100)}%` }}
                                                    />
                                                    <div
                                                        className="h-2 bg-amber-400"
                                                        style={{ width: `${Math.round((usage.toolTokens / usage.totalTokens) * 100)}%` }}
                                                    />
                                                </>
                                            )}
                                        </div>
                                        <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-zinc-500">
                                            <div className="text-center">
                                                {usage && usage.totalTokens > 0
                                                    ? Math.round((usage.userTokens / usage.totalTokens) * 100)
                                                    : 0}%
                                            </div>
                                            <div className="text-center">
                                                {usage && usage.totalTokens > 0
                                                    ? Math.round((usage.assistantTokens / usage.totalTokens) * 100)
                                                    : 0}%
                                            </div>
                                            <div className="text-center">
                                                {usage && usage.totalTokens > 0
                                                    ? Math.round((usage.toolTokens / usage.totalTokens) * 100)
                                                    : 0}%
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                                        <span>Images attached</span>
                                        <span className="font-mono text-zinc-200">{usage?.imageCount ?? 0}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                                        <span>Cache tokens (read/write)</span>
                                        <span className="font-mono text-zinc-200">N/A</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                                        <span>Estimated cost</span>
                                        <span className="font-mono text-zinc-200">
                                            {usage?.estimatedCost !== undefined
                                                ? `$${usage.estimatedCost.toFixed(4)}`
                                                : "N/A"}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                                        <span>Session created</span>
                                        <span className="font-mono text-zinc-200">{contextMeta?.sessionStarted || "N/A"}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                                        <span>Last activity</span>
                                        <span className="font-mono text-zinc-200">{contextMeta?.lastActivity || "N/A"}</span>
                                    </div>
                                    {contextMeta?.rawMessages && contextMeta.rawMessages.length > 0 && (
                                        <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--bg-base)]/40 px-3 py-2">
                                            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Raw messages</div>
                                            <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                                                {contextMeta.rawMessages.map((msg) => (
                                                    <div key={msg.id} className="flex items-center justify-between text-[10px] text-zinc-500">
                                                        <span className="font-mono text-zinc-300">{msg.role}</span>
                                                        <span className="font-mono">{msg.id}</span>
                                                        <span className="text-zinc-600">{msg.time}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {usage?.isEstimated && (
                                        <div className="text-[10px] text-zinc-600 italic">
                                            Usage is estimated and may differ from provider billing.
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
