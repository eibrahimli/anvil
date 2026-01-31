import { Search, FileCode } from "lucide-react";
import { useState } from "react";

interface SearchMatch {
  path: string;
  line_number: number;
  content: string;
}

interface SearchData {
  matches: SearchMatch[];
  count: number;
}

interface SearchCardProps {
  data: SearchData;
}

export function SearchCard({ data }: SearchCardProps) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  // Group matches by file
  const fileGroups = data.matches.reduce((acc, match) => {
    if (!acc[match.path]) {
      acc[match.path] = [];
    }
    acc[match.path].push(match);
    return acc;
  }, {} as Record<string, SearchMatch[]>);

  const filePaths = Object.keys(fileGroups);

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-purple-500/10 text-purple-400">
              <Search size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-100">Code Search</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 font-medium uppercase">
                  {data.count} matches
                </span>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">
                Found in {filePaths.length} files
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-h-[400px] overflow-y-auto">
        {filePaths.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-xs italic">
            No matches found for the given pattern.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filePaths.map((path) => (
              <div key={path} className="group">
                <button
                  onClick={() => setExpandedFile(expandedFile === path ? null : path)}
                  className="w-full px-4 py-2 flex items-center justify-between hover:bg-[var(--bg-elevated)] transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileCode size={14} className="text-zinc-500 flex-shrink-0" />
                    <span className="text-xs font-mono text-zinc-300 truncate">{path}</span>
                  </div>
                  <span className="text-[10px] text-zinc-600 bg-zinc-800/50 px-1.5 rounded ml-2">
                    {fileGroups[path].length}
                  </span>
                </button>

                {expandedFile === path && (
                  <div className="bg-[#09090b] border-t border-[var(--border)]">
                    {fileGroups[path].map((match, idx) => (
                      <div key={idx} className="flex border-b border-zinc-800/30 last:border-0">
                        <div className="w-10 flex-shrink-0 text-[10px] font-mono text-zinc-600 text-right pr-2 py-1 select-none border-r border-zinc-800/50">
                          {match.line_number}
                        </div>
                        <pre className="px-3 py-1 text-[11px] font-mono text-zinc-400 overflow-x-auto whitespace-pre">
                          <code>{match.content}</code>
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between text-[10px] text-zinc-600">
          <span className="uppercase tracking-tight">search</span>
          {data.count > 500 && (
            <span className="text-orange-500/70 font-medium">Result capped at 500 matches</span>
          )}
        </div>
      </div>
    </div>
  );
}
