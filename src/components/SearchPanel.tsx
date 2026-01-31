import { useState } from "react";
import { Search, Loader2, FileCode, ChevronRight, ChevronDown } from "lucide-react";
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
    
    const { workspacePath, openFile, setActiveFileContent } = useStore();

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!query.trim()) return;

        setLoading(true);
        try {
            const data = await invoke<SearchResult>("search", { pattern: query });
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
        } finally {
            setLoading(false);
        }
    };

    const loadFile = async (path: string) => {
        try {
            const absolutePath = `${workspacePath}/${path}`;
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
                        onChange={(e) => setQuery(e.target.value)}
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
            </div>

            <div className="flex-1 overflow-y-auto">
                {Object.entries(fileGroups).map(([path, matches]) => (
                    <div key={path} className="border-b border-[var(--border)]/30">
                        <button
                            onClick={() => toggleFile(path)}
                            className="w-full flex items-center gap-2 px-4 py-2 hover:bg-[var(--bg-elevated)] transition-colors text-left"
                        >
                            {expandedFiles[path] ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
                            <FileCode size={14} className="text-[var(--accent)] opacity-70" />
                            <span className="text-xs font-mono text-zinc-300 truncate flex-1">{path}</span>
                            <span className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 rounded">{matches.length}</span>
                        </button>

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
                                            <code>{match.content.trim()}</code>
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
                        Enter a pattern to search across your workspace
                    </div>
                )}
            </div>
        </div>
    );
}
