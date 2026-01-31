import { Wrench } from "lucide-react";
import { useState } from "react";

interface GenericToolData {
  [key: string]: unknown;
}

interface GenericToolCardProps {
  toolName: string;
  data: GenericToolData;
}

export function GenericToolCard({ toolName, data }: GenericToolCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const formatValue = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === 'object') return '{...}';
    return String(value);
  };

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-zinc-700/50 text-zinc-400">
              <Wrench size={16} />
            </div>
            <div>
              <span className="text-sm font-bold text-zinc-100">Tool Result</span>
              <span className="text-[10px] text-zinc-500 font-mono ml-2">
                {toolName}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        {!isExpanded ? (
          <div className="bg-[var(--bg-base)] border border-[var(--border)] rounded-md p-3">
            <div className="space-y-2">
              {Object.entries(data).slice(0, 3).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 font-mono">{key}:</span>
                  <span className="text-zinc-300 font-mono truncate max-w-[200px]">
                    {formatValue(value)}
                  </span>
                </div>
              ))}
              {Object.keys(data).length > 3 && (
                <p className="text-[10px] text-zinc-600 text-center italic">
                  +{Object.keys(data).length - 3} more fields
                </p>
              )}
            </div>
          </div>
        ) : (
          <pre className="bg-[var(--bg-base)] border border-[var(--border)] rounded-md p-3 text-xs font-mono text-zinc-400 overflow-x-auto max-h-[300px] overflow-y-auto">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-2 w-full py-1.5 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {isExpanded ? 'Show less' : 'View full JSON'}
        </button>
      </div>
    </div>
  );
}
