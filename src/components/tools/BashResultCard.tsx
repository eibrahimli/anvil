import { Terminal, AlertTriangle, CheckCircle } from "lucide-react";
import { useState } from "react";

interface BashResultData {
  stdout: string;
  stderr?: string;
  exit_code?: number;
  command?: string;
}

interface BashResultCardProps {
  data: BashResultData;
}

export function BashResultCard({ data }: BashResultCardProps) {
  const [activeTab, setActiveTab] = useState<'stdout' | 'stderr'>('stdout');

  const hasStderr = data.stderr && data.stderr.trim().length > 0;
  const hasStdout = data.stdout && data.stdout.trim().length > 0;
  const isSuccess = data.exit_code === 0 || data.exit_code === undefined;

  // If no stdout but has stderr, show stderr by default
  useState(() => {
    if (!hasStdout && hasStderr) {
      setActiveTab('stderr');
    }
  });

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-zinc-700/50 text-zinc-400">
              <Terminal size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-100">Shell Command</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  isSuccess ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                }`}>
                  Exit {data.exit_code ?? 0}
                </span>
              </div>
              {data.command && (
                <code className="text-[10px] text-zinc-500 font-mono truncate max-w-[300px] block">
                  $ {data.command}
                </code>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isSuccess ? (
              <CheckCircle size={16} className="text-green-400" />
            ) : (
              <AlertTriangle size={16} className="text-red-400" />
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      {(hasStdout || hasStderr) && (
        <div className="flex border-b border-[var(--border)]">
          {hasStdout && (
            <button
              onClick={() => setActiveTab('stdout')}
              className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === 'stdout'
                  ? 'bg-[var(--bg-elevated)] text-zinc-200 border-b-2 border-green-500'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Output
              {data.stdout.split('\n').length > 1 && (
                <span className="ml-2 text-[10px] text-zinc-600">
                  ({data.stdout.split('\n').length} lines)
                </span>
              )}
            </button>
          )}
          {hasStderr && (
            <button
              onClick={() => setActiveTab('stderr')}
              className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === 'stderr'
                  ? 'bg-[var(--bg-elevated)] text-zinc-200 border-b-2 border-red-500'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <span className="flex items-center gap-1.5">
                Errors
                <span className="w-2 h-2 rounded-full bg-red-500" />
              </span>
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="bg-[#09090b]">
        {activeTab === 'stdout' && hasStdout && (
          <pre className="p-4 text-xs font-mono text-green-400 overflow-x-auto max-h-[300px] overflow-y-auto">
            <code>{data.stdout}</code>
          </pre>
        )}
        {activeTab === 'stderr' && hasStderr && (
          <pre className="p-4 text-xs font-mono text-red-400 overflow-x-auto max-h-[300px] overflow-y-auto">
            <code>{data.stderr}</code>
          </pre>
        )}
        {!hasStdout && !hasStderr && (
          <div className="p-4 text-xs text-zinc-500 text-center italic">
            Command executed successfully with no output
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span className="text-[10px] text-zinc-600 uppercase tracking-tight">bash</span>
          <div className="flex items-center gap-2">
            {hasStdout && <span className="text-green-400">{data.stdout.length} chars stdout</span>}
            {hasStderr && <span className="text-red-400">{data.stderr!.length} chars stderr</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
