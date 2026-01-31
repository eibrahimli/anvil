import { Code, Hash, Layers } from "lucide-react";

interface Symbol {
  name: string;
  kind: string;
  line: number;
}

interface SymbolData {
  symbols: Symbol[];
  count: number;
  path: string;
}

interface SymbolCardProps {
  data: SymbolData;
}

export function SymbolCard({ data }: SymbolCardProps) {
  const getKindIcon = (kind: string) => {
    switch (kind) {
      case 'function': return <Code size={12} className="text-blue-400" />;
      case 'class': return <Layers size={12} className="text-purple-400" />;
      case 'interface': return <Layers size={12} className="text-green-400" />;
      default: return <Hash size={12} className="text-zinc-500" />;
    }
  };

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-zinc-700/50 text-zinc-400">
              <Code size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-100">File Symbols</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-medium uppercase">
                  {data.count} found
                </span>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[250px] block">
                {data.path}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-h-[300px] overflow-y-auto p-2">
        {data.symbols.length === 0 ? (
          <div className="p-4 text-center text-zinc-500 text-xs italic">
            No recognizable symbols found in this file.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-1">
            {data.symbols.map((symbol, idx) => (
              <div 
                key={idx} 
                className="flex items-center gap-3 px-3 py-1.5 hover:bg-[var(--bg-elevated)] rounded transition-colors group cursor-default"
              >
                <div className="flex-shrink-0">
                  {getKindIcon(symbol.kind)}
                </div>
                <span className="text-xs font-mono text-zinc-300 truncate flex-1">{symbol.name}</span>
                <div className="text-[10px] font-mono text-zinc-600 group-hover:text-zinc-400">
                  L{symbol.line}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between text-[10px] text-zinc-600">
          <span className="uppercase tracking-tight">list_symbols</span>
        </div>
      </div>
    </div>
  );
}
