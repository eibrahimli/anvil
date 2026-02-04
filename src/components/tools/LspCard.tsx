import { Cpu } from "lucide-react";

interface LspCardProps {
    data: Record<string, unknown>;
}

export function LspCard({ data }: LspCardProps) {
    const request = typeof data.request === "string" ? data.request : "lsp";
    const server = typeof data.server === "string" ? data.server : "unknown";
    const result = data.result ?? null;

    return (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-base)]">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-md bg-blue-500/10 text-blue-400">
                        <Cpu size={16} />
                    </div>
                    <div>
                        <div className="text-sm font-bold text-zinc-100">LSP Result</div>
                        <div className="text-[10px] text-zinc-500 font-mono">
                            {request} • {server}
                        </div>
                    </div>
                </div>
            </div>
            <div className="max-h-[360px] overflow-y-auto">
                <pre className="text-[11px] font-mono text-zinc-300 bg-[#09090b] px-4 py-3 whitespace-pre-wrap">
                    {JSON.stringify(result, null, 2)}
                </pre>
            </div>
        </div>
    );
}
