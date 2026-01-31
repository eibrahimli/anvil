import { GitBranch, GitCommit, AlertCircle } from "lucide-react";
import { useState } from "react";

interface GitStatusData {
  branch: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  conflicted: string[];
  latest_commit?: string;
}

interface GitStatusCardProps {
  data: GitStatusData;
}

export function GitStatusCard({ data }: GitStatusCardProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const hasChanges = data.staged.length > 0 || data.unstaged.length > 0 || data.untracked.length > 0 || data.conflicted.length > 0;

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const renderFileList = (files: string[], colorClass: string) => {
    if (files.length === 0) return null;
    return (
      <div className="mt-2 space-y-1">
        {files.map((file, idx) => (
          <div key={idx} className="flex items-center gap-2 text-xs font-mono">
            <div className={`w-2 h-2 rounded-full ${colorClass}`} />
            <span className="text-zinc-400 truncate">{file}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-orange-500/10 text-orange-400">
              <GitBranch size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-100">{data.branch}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 font-medium">
                  git status
                </span>
              </div>
              {data.latest_commit && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <GitCommit size={10} className="text-zinc-500" />
                  <span className="text-[10px] text-zinc-500 truncate max-w-[200px]">
                    {data.latest_commit.trim()}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Summary Badges */}
      <div className="px-4 py-3 grid grid-cols-4 gap-2">
        <button
          onClick={() => data.staged.length > 0 && toggleSection('staged')}
          className={`flex flex-col items-center p-2 rounded-md transition-colors ${
            data.staged.length > 0 ? 'hover:bg-green-500/10 cursor-pointer' : 'opacity-50'
          }`}
        >
          <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center mb-1">
            <span className="text-sm font-bold text-green-400">{data.staged.length}</span>
          </div>
          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-tight">Staged</span>
        </button>

        <button
          onClick={() => data.unstaged.length > 0 && toggleSection('unstaged')}
          className={`flex flex-col items-center p-2 rounded-md transition-colors ${
            data.unstaged.length > 0 ? 'hover:bg-yellow-500/10 cursor-pointer' : 'opacity-50'
          }`}
        >
          <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center mb-1">
            <span className="text-sm font-bold text-yellow-400">{data.unstaged.length}</span>
          </div>
          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-tight">Unstaged</span>
        </button>

        <button
          onClick={() => data.untracked.length > 0 && toggleSection('untracked')}
          className={`flex flex-col items-center p-2 rounded-md transition-colors ${
            data.untracked.length > 0 ? 'hover:bg-blue-500/10 cursor-pointer' : 'opacity-50'
          }`}
        >
          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center mb-1">
            <span className="text-sm font-bold text-blue-400">{data.untracked.length}</span>
          </div>
          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-tight">Untracked</span>
        </button>

        <button
          onClick={() => data.conflicted.length > 0 && toggleSection('conflicted')}
          className={`flex flex-col items-center p-2 rounded-md transition-colors ${
            data.conflicted.length > 0 ? 'hover:bg-red-500/10 cursor-pointer' : 'opacity-50'
          }`}
        >
          <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center mb-1">
            <span className="text-sm font-bold text-red-400">{data.conflicted.length}</span>
          </div>
          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-tight">Conflicted</span>
        </button>
      </div>

      {/* File Lists */}
      {hasChanges && (
        <div className="px-4 pb-4 space-y-3">
          {expandedSection === 'staged' && data.staged.length > 0 && (
            <div className="bg-green-500/5 border border-green-500/20 rounded-md p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs font-bold text-green-400 uppercase tracking-tight">Staged Files</span>
              </div>
              {renderFileList(data.staged, 'bg-green-500')}
            </div>
          )}

          {expandedSection === 'unstaged' && data.unstaged.length > 0 && (
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-md p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                <span className="text-xs font-bold text-yellow-400 uppercase tracking-tight">Unstaged Files</span>
              </div>
              {renderFileList(data.unstaged, 'bg-yellow-500')}
            </div>
          )}

          {expandedSection === 'untracked' && data.untracked.length > 0 && (
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-md p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-xs font-bold text-blue-400 uppercase tracking-tight">Untracked Files</span>
              </div>
              {renderFileList(data.untracked, 'bg-blue-500')}
            </div>
          )}

          {expandedSection === 'conflicted' && data.conflicted.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-md p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={12} className="text-red-400" />
                <span className="text-xs font-bold text-red-400 uppercase tracking-tight">Conflicted Files</span>
              </div>
              {renderFileList(data.conflicted, 'bg-red-500')}
            </div>
          )}

          {!expandedSection && (
            <p className="text-[10px] text-zinc-500 text-center italic">
              Click on the badges above to view file details
            </p>
          )}
        </div>
      )}

      {!hasChanges && (
        <div className="px-4 pb-4">
          <div className="bg-green-500/5 border border-green-500/20 rounded-md p-3 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-green-400">Working tree clean</span>
          </div>
        </div>
      )}
    </div>
  );
}
