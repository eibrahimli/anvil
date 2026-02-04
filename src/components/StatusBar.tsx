import clsx from "clsx";
import { StatusIndicator } from "./ActivityCards";

export type AgentStatus = "planning" | "researching" | "implementing" | "executing" | "testing" | "waiting" | "done";

interface StatusBarProps {
    status: AgentStatus;
    message: string;
    detail?: string;
}

const statusMeta: Record<AgentStatus, { dot: string; label: string }> = {
    planning: { dot: "bg-blue-400", label: "Planning" },
    researching: { dot: "bg-yellow-400", label: "Researching" },
    implementing: { dot: "bg-green-400", label: "Implementing" },
    executing: { dot: "bg-cyan-400", label: "Executing" },
    testing: { dot: "bg-purple-400", label: "Testing" },
    waiting: { dot: "bg-orange-400", label: "Waiting" },
    done: { dot: "bg-emerald-400", label: "Done" }
};

export function StatusBar({ status, message, detail }: StatusBarProps) {
    const meta = statusMeta[status];

    return (
        <div className="relative overflow-hidden border-b border-[var(--border)] bg-[var(--bg-base)]/75 backdrop-blur-md">
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
            </div>
        </div>
    );
}
