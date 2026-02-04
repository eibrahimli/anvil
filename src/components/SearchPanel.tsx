import { useState } from "react";
import type { ReactNode } from "react";
import { Search, Loader2, FileCode, ChevronRight, ChevronDown, Copy, ArrowUpRight } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store";

interface SearchMatch {
    path: string;
    line_number: number;
    content: string;
}

interface SearchResult {
    matches: SearchMatch[];
    count: number;
}

export function SearchPanel() {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<SearchResult | null>(null);
    const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    
    const { workspacePath, openFile, setActiveFileContent } = useStore();

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!query.trim()) return;
        if (!workspacePath) {
            setErrorMessage("Select a workspace to search.");
            return;
        }

        setLoading(true);
        setErrorMessage(null);
        try {
            const data = await invoke<SearchResult>("search", {
                workspacePath,
                pattern: query
            });
            setResults(data);
            
            // Auto-expand first few files if there are results
            const initialExpanded: Record<string, boolean> = {};
            const uniqueFiles = Array.from(new Set(data.matches.map(m => m.path)));
            uniqueFiles.slice(0, 5).forEach(path => {
                initialExpanded[path] = true;
            });
            setExpandedFiles(initialExpanded);
        } catch (error) {
            console.error("Search failed:", error);
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("Invalid regex")) {
                setErrorMessage(`Invalid regex: ${message.replace("Invalid regex:", "").trim()}`);
            } else {
                setErrorMessage(message || "Search failed. Check your pattern and try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    const loadFile = async (path: string) => {
        if (!workspacePath) {
            setErrorMessage("Select a workspace to open files.");
            return;
        }
        try {
            const basePath = workspacePath.replace(/\/$/, "");
            const absolutePath = `${basePath}/${path}`;
            const content = await invoke<string>("read_file", { path: absolutePath });
            openFile(absolutePath);
            setActiveFileContent(content);
        } catch (e) {
            console.error(e);
        }
    };

    const toggleFile = (path: string) => {
        setExpandedFiles(prev => ({ ...prev, [path]: !prev[path] }));
    };

    const handleCopyPath = async (path: string) => {
        if (!workspacePath) {
            setErrorMessage("Select a workspace to copy paths.");
            return;
        }
        try {
            const basePath = workspacePath.replace(/\/$/, "");
            await navigator.clipboard.writeText(`${basePath}/${path}`);
        } catch (error) {
            console.error("Failed to copy path:", error);
            setErrorMessage("Failed to copy path.");
        }
    };

    const renderHighlightedContent = (text: string) => {
        const trimmed = text.trim();
        if (!query.trim()) return trimmed;
        try {
            const regex = new RegExp(query, "gi");
            const segments: Array<string | ReactNode> = [];
            let lastIndex = 0;
            let match: RegExpExecArray | null;

            while ((match = regex.exec(trimmed)) !== null) {
                if (match.index > lastIndex) {
                    segments.push(trimmed.slice(lastIndex, match.index));
                }
                segments.push(
                    <mark
                        key={`${match.index}-${match[0]}`}
                        className="rounded-sm bg-[var(--accent)]/20 px-0.5 text-[var(--accent)]"
                    >
                        {match[0]}
                    </mark>
                );
                lastIndex = match.index + match[0].length;
                if (match.index === regex.lastIndex) {
                    regex.lastIndex++;
                }
            }

            if (lastIndex < trimmed.length) {
                segments.push(trimmed.slice(lastIndex));
            }

            return segments.length > 0 ? segments : trimmed;
        } catch (error) {
            return trimmed;
        }
    };

    // Group matches by file
    const fileGroups = results?.matches.reduce((acc, match) => {
        if (!acc[match.path]) acc[match.path] = [];
        acc[match.path].push(match);
        return acc;
    }, {} as Record<string, SearchMatch[]>) || {};

    return (
        <div className="flex flex-col h-full bg-[var(--bg-surface)]">
            <div className="p-4 border-b border-[var(--border)]">
                <form onSubmit={handleSearch} className="relative">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setErrorMessage(null);
                        }}
                        placeholder="Search in project..."
                        className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-md py-2 pl-9 pr-4 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] transition-all"
                    />
                    <Search className="absolute left-3 top-2.5 text-zinc-500" size={16} />
                    {loading && (
                        <Loader2 className="absolute right-3 top-2.5 text-[var(--accent)] animate-spin" size={16} />
                    )}
                </form>
                {results && (
                    <div className="mt-2 text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
                        {results.count} matches in {Object.keys(fileGroups).length} files
                    </div>
                )}
                {errorMessage && (
                    <div className="mt-2 text-xs text-red-400">
                        {errorMessage}
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto">
                {Object.entries(fileGroups).map(([path, matches]) => (
                    <div key={path} className="border-b border-[var(--border)]/30">
                        <div className="flex items-center justify-between px-4 py-2">
                            <button
                                onClick={() => toggleFile(path)}
                                className="flex items-center gap-2 hover:bg-[var(--bg-elevated)] transition-colors text-left flex-1 rounded-md px-1.5 py-1"
                            >
                                {expandedFiles[path] ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
                                <FileCode size={14} className="text-[var(--accent)] opacity-70" />
                                <span className="text-xs font-mono text-zinc-300 truncate flex-1">{path}</span>
                                <span className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 rounded">{matches.length}</span>
                            </button>
                            <div className="flex items-center gap-2 pl-2">
                                <button
                                    onClick={() => loadFile(path)}
                                    className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
                                    title="Open file"
                                >
                                    <ArrowUpRight size={14} />
                                </button>
                                <button
                                    onClick={() => handleCopyPath(path)}
                                    className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
                                    title="Copy full path"
                                >
                                    <Copy size={14} />
                                </button>
                            </div>
                        </div>

                        {expandedFiles[path] && (
                            <div className="bg-[#09090b]">
                                {matches.map((match, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => loadFile(path)}
                                        className="w-full flex border-b border-zinc-800/30 last:border-0 hover:bg-zinc-800/50 transition-colors text-left group"
                                    >
                                        <div className="w-10 flex-shrink-0 text-[10px] font-mono text-zinc-600 text-right pr-2 py-1 select-none border-r border-zinc-800/50">
                                            {match.line_number}
                                        </div>
                                        <pre className="px-3 py-1 text-[11px] font-mono text-zinc-400 overflow-x-hidden whitespace-pre truncate flex-1">
                                            <code>{renderHighlightedContent(match.content)}</code>
                                        </pre>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
                
                {results && results.count === 0 && (
                    <div className="p-8 text-center text-zinc-500 text-sm italic">
                        No results found
                    </div>
                )}
                
                {!results && !loading && (
                    <div className="p-8 text-center text-zinc-600 text-sm">
                        {workspacePath ? "Enter a pattern to search across your workspace" : "Select a workspace to enable search"}
                    </div>
                )}
            </div>
        </div>
    );
}
