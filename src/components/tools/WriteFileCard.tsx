import { FileCheck, FilePlus, Check } from "lucide-react";

interface WriteFileData {
  status: string;
  path?: string;
}

interface WriteFileCardProps {
  data: WriteFileData;
}

export function WriteFileCard({ data }: WriteFileCardProps) {
  const isSuccess = data.status === "success";
  const fileName = data.path ? data.path.split('/').pop() : 'file';

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-md ${
              isSuccess ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
            }`}>
              {isSuccess ? <FileCheck size={16} /> : <FilePlus size={16} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-100">
                  {isSuccess ? 'File Written' : 'Write Failed'}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  isSuccess ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                }`}>
                  {data.status}
                </span>
              </div>
              {data.path && (
                <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[300px] block">
                  {data.path}
                </span>
              )}
            </div>
          </div>
          {isSuccess && (
            <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check size={14} className="text-green-400" />
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        {isSuccess ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-green-500/5 border border-green-500/20 rounded-md p-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs text-green-400">
                  Successfully wrote <span className="font-mono font-bold">{fileName}</span>
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-red-500/5 border border-red-500/20 rounded-md p-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-xs text-red-400">
                  Failed to write file
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span className="text-[10px] text-zinc-600 uppercase tracking-tight">write_file</span>
        </div>
      </div>
    </div>
  );
}
