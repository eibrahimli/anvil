import { useMemo, useState } from "react";
import { Cpu, ArrowUpRight, FileCode } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../../store";
import clsx from "clsx";

interface LspCardProps {
    data: Record<string, unknown>;
}

type LspRange = {
    start: { line: number; character: number };
    end: { line: number; character: number };
};

type LspLocation = {
    uri: string;
    range: LspRange;
};

type LspDiagnostic = {
    range?: LspRange;
    message?: string;
    severity?: number;
    source?: string;
};

const severityLabel: Record<number, string> = {
    1: "Error",
    2: "Warning",
    3: "Info",
    4: "Hint"
};

const severityColor: Record<number, string> = {
    1: "text-red-400",
    2: "text-yellow-400",
    3: "text-blue-400",
    4: "text-zinc-400"
};

function decodeFileUri(uri: string) {
    if (!uri.startsWith("file://")) return uri;
    try {
        const decoded = decodeURIComponent(uri.replace("file://", ""));
        return decoded.startsWith("/") ? decoded : `/${decoded}`;
    } catch {
        return uri.replace("file://", "");
    }
}

function toDisplayPath(path: string, workspacePath: string) {
    const basePath = workspacePath.replace(/\/$/, "");
    if (basePath && path.startsWith(basePath)) {
        return path.slice(basePath.length + 1);
    }
    return path;
}

function normalizeLocations(result: unknown): LspLocation[] {
    if (!result) return [];
    if (Array.isArray(result)) {
        return result
            .map((entry) => {
                if (entry && typeof entry === "object") {
                    const record = entry as Record<string, any>;
                    if (record.uri && record.range) {
                        return { uri: record.uri as string, range: record.range as LspRange };
                    }
                    if (record.targetUri && record.targetRange) {
                        return { uri: record.targetUri as string, range: record.targetRange as LspRange };
                    }
                }
                return null;
            })
            .filter((entry): entry is LspLocation => entry !== null);
    }

    if (typeof result === "object") {
        const record = result as Record<string, any>;
        if (record.uri && record.range) {
            return [{ uri: record.uri as string, range: record.range as LspRange }];
        }
        if (record.targetUri && record.targetRange) {
            return [{ uri: record.targetUri as string, range: record.targetRange as LspRange }];
        }
    }

    return [];
}

function normalizeDiagnostics(result: unknown): LspDiagnostic[] {
    if (!Array.isArray(result)) return [];
    return result
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => entry as LspDiagnostic);
}

export function LspCard({ data }: LspCardProps) {
    const request = typeof data.request === "string" ? data.request : "lsp";
    const server = typeof data.server === "string" ? data.server : "unknown";
    const result = data.result ?? null;
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const { workspacePath, openFile, setActiveFileContent } = useStore();

    const locations = useMemo(() => normalizeLocations(result), [result]);
    const diagnostics = useMemo(() => normalizeDiagnostics(result), [result]);

    const handleOpen = async (uri: string) => {
        setErrorMessage(null);
        const decoded = decodeFileUri(uri);
        const basePath = workspacePath.replace(/\/$/, "");
        const targetPath = decoded.startsWith("/") ? decoded : `${basePath}/${decoded}`;

        try {
            const content = await invoke<string>("read_file", { path: targetPath });
            openFile(targetPath);
            setActiveFileContent(content);
        } catch (error) {
            console.error("Failed to open LSP file:", error);
            setErrorMessage("Failed to open file. Check permissions.");
        }
    };

    const renderLocationList = () => {
        if (locations.length === 0) {
            return (
                <div className="p-4 text-xs text-zinc-500">
                    No locations returned for this request.
                </div>
            );
        }

        return (
            <div className="divide-y divide-[var(--border)]">
                {locations.map((location, index) => {
                    const path = decodeFileUri(location.uri);
                    const displayPath = toDisplayPath(path, workspacePath);
                    const line = location.range?.start?.line ?? 0;
                    const character = location.range?.start?.character ?? 0;

                    return (
                        <div key={`${location.uri}-${index}`} className="flex items-center justify-between px-4 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <FileCode size={14} className="text-[var(--accent)] opacity-70" />
                                <div className="min-w-0">
                                    <div className="text-xs font-mono text-zinc-200 truncate">{displayPath}</div>
                                    <div className="text-[10px] text-zinc-500">
                                        Line {line + 1}, Char {character + 1}
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => handleOpen(path)}
                                className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
                                title="Open file"
                            >
                                <ArrowUpRight size={14} />
                            </button>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderDiagnostics = () => {
        if (diagnostics.length === 0) {
            return (
                <div className="p-4 text-xs text-zinc-500">
                    No diagnostics returned.
                </div>
            );
        }

        return (
            <div className="divide-y divide-[var(--border)]">
                {diagnostics.map((diag, index) => {
                    const line = diag.range?.start?.line ?? 0;
                    const character = diag.range?.start?.character ?? 0;
                    const severity = diag.severity ?? 3;
                    const label = severityLabel[severity] || "Info";

                    return (
                        <div key={`${label}-${index}`} className="px-4 py-2">
                            <div className="flex items-center gap-2">
                                <span className={clsx("text-[10px] font-bold uppercase", severityColor[severity])}>{label}</span>
                                <span className="text-[10px] text-zinc-500">Line {line + 1}, Char {character + 1}</span>
                                {diag.source && (
                                    <span className="text-[10px] text-zinc-600">{diag.source}</span>
                                )}
                            </div>
                            <div className="text-xs text-zinc-200 leading-relaxed">
                                {diag.message || "(no message)"}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

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
                {errorMessage && (
                    <div className="px-4 py-2 text-xs text-red-400 border-b border-[var(--border)]">
                        {errorMessage}
                    </div>
                )}
                {request === "diagnostics" ? renderDiagnostics() : renderLocationList()}
            </div>
        </div>
    );
}
