import { Code, Hash, Layers, Box, Minus, Wrench } from "lucide-react";

interface Symbol {
  name: string;
  kind: string;
  line: number;
  /** 1-indexed end line (tree-sitter output). */
  line_end?: number;
  /** Enclosing class / impl name when this symbol is nested. */
  parent?: string;
  /** First line of the declaration. */
  signature?: string;
}

interface SymbolData {
  symbols: Symbol[];
  count: number;
  path: string;
  /** Language detected by tree-sitter, e.g. "rust", "typescript". */
  language?: string;
}

interface SymbolCardProps {
  data: SymbolData;
}

const KIND_COLORS: Record<string, string> = {
  function: "text-blue-400",
  method: "text-blue-300",
  class: "text-purple-400",
  struct: "text-purple-300",
  enum: "text-orange-400",
  trait: "text-orange-300",
  interface: "text-green-400",
  constant: "text-yellow-400",
  type_alias: "text-cyan-400",
  module: "text-zinc-400",
};

function KindIcon({ kind }: { kind: string }) {
  const color = KIND_COLORS[kind] ?? "text-zinc-500";
  switch (kind) {
    case "function":
    case "method":
      return <Code size={12} className={color} />;
    case "class":
    case "struct":
    case "module":
      return <Layers size={12} className={color} />;
    case "trait":
    case "interface":
      return <Box size={12} className={color} />;
    case "constant":
    case "type_alias":
      return <Minus size={12} className={color} />;
    default:
      return <Hash size={12} className={color} />;
  }
}

function KindBadge({ kind }: { kind: string }) {
  const color = KIND_COLORS[kind] ?? "text-zinc-500";
  return (
    <span className={`text-[9px] font-mono uppercase ${color} opacity-70`}>
      {kind.replace("_", " ")}
    </span>
  );
}

function LineRange({ line, line_end }: { line: number; line_end?: number }) {
  if (line_end && line_end !== line) {
    return <span>L{line}-{line_end}</span>;
  }
  return <span>L{line}</span>;
}

export function SymbolCard({ data }: SymbolCardProps) {
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
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-100">File Symbols</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-medium uppercase">
                  {data.count} found
                </span>
                {data.language && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-blue-400 font-mono">
                    {data.language}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[250px] block">
                {data.path}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-h-[360px] overflow-y-auto p-2">
        {data.symbols.length === 0 ? (
          <div className="p-4 text-center text-zinc-500 text-xs italic">
            No recognizable symbols found in this file.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-0.5">
            {data.symbols.map((symbol, idx) => {
              const displayName = symbol.parent
                ? `${symbol.parent}::${symbol.name}`
                : symbol.name;
              return (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg-elevated)] rounded transition-colors group cursor-default"
                  title={symbol.signature ?? undefined}
                >
                  <div className="flex-shrink-0">
                    <KindIcon kind={symbol.kind} />
                  </div>
                  <span className="text-xs font-mono text-zinc-300 truncate flex-1">
                    {displayName}
                  </span>
                  <KindBadge kind={symbol.kind} />
                  <div className="text-[10px] font-mono text-zinc-600 group-hover:text-zinc-400 ml-1 tabular-nums">
                    <LineRange line={symbol.line} line_end={symbol.line_end} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between text-[10px] text-zinc-600">
          <span className="uppercase tracking-tight">list_symbols</span>
          {data.language && (
            <span className="text-zinc-600 font-mono">{data.language}</span>
          )}
        </div>
      </div>
    </div>
  );
}
