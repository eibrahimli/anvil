import { FileText, Copy, Check } from "lucide-react";
import { useState } from "react";

interface FileReadData {
  content: string;
  path?: string;
}

interface FileReadCardProps {
  data: FileReadData;
}

export function FileReadCard({ data }: FileReadCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(data.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lineCount = data.content.split('\n').length;
  const charCount = data.content.length;
  const fileSize = charCount > 1024 ? `${(charCount / 1024).toFixed(1)} KB` : `${charCount} B`;

  // Detect language from file extension
  const getLanguage = (path?: string) => {
    if (!path) return 'text';
    const ext = path.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      'ts': 'typescript', 'tsx': 'typescript',
      'js': 'javascript', 'jsx': 'javascript',
      'rs': 'rust', 'py': 'python',
      'go': 'go', 'java': 'java',
      'cpp': 'cpp', 'c': 'c',
      'json': 'json', 'yaml': 'yaml', 'yml': 'yaml',
      'md': 'markdown', 'html': 'html', 'css': 'css',
      'sql': 'sql', 'sh': 'bash', 'bash': 'bash'
    };
    return langMap[ext || ''] || 'text';
  };

  const language = getLanguage(data.path);
  const languageColors: Record<string, string> = {
    'typescript': 'bg-blue-500/20 text-blue-400',
    'javascript': 'bg-yellow-500/20 text-yellow-400',
    'rust': 'bg-orange-500/20 text-orange-400',
    'python': 'bg-green-500/20 text-green-400',
    'go': 'bg-cyan-500/20 text-cyan-400',
    'json': 'bg-gray-500/20 text-gray-400',
    'default': 'bg-zinc-500/20 text-zinc-400'
  };

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-blue-500/10 text-blue-400">
              <FileText size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-100 font-mono">
                  {data.path ? data.path.split('/').pop() : 'File Content'}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase ${languageColors[language] || languageColors.default}`}>
                  {language}
                </span>
              </div>
              {data.path && (
                <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[250px] block">
                  {data.path}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-md hover:bg-[var(--bg-elevated)] text-zinc-400 transition-colors"
            title="Copy content"
          >
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="bg-[#1e1e1e]">
        <pre className="p-4 text-xs font-mono text-zinc-300 overflow-x-auto max-h-[400px] overflow-y-auto">
          <code>{data.content}</code>
        </pre>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <div className="flex items-center gap-3">
            <span>{lineCount} lines</span>
            <span className="w-1 h-1 bg-zinc-700 rounded-full" />
            <span>{fileSize}</span>
          </div>
          <span className="text-[10px] text-zinc-600 uppercase tracking-tight">read_file</span>
        </div>
      </div>
    </div>
  );
}
