import { FileEdit, Check } from "lucide-react";

interface EditFileData {
  status: string;
  message?: string;
  path?: string;
}

interface EditFileCardProps {
  data: EditFileData;
}

export function EditFileCard({ data }: EditFileCardProps) {
  const isSuccess = data.status === "success";
  
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-md ${
              isSuccess ? 'bg-blue-500/10 text-blue-400' : 'bg-red-500/10 text-red-400'
            }`}>
              <FileEdit size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-100">
                  {isSuccess ? 'File Edited' : 'Edit Failed'}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  isSuccess ? 'bg-blue-500/10 text-blue-400' : 'bg-red-500/10 text-red-400'
                }`}>
                  {data.status}
                </span>
              </div>
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
        <div className="bg-[var(--bg-base)] border border-[var(--border)] rounded-md p-3">
          <p className="text-xs text-zinc-300 font-mono italic">
            {data.message || 'No message provided'}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--bg-base)]">
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span className="text-[10px] text-zinc-600 uppercase tracking-tight">edit_file</span>
        </div>
      </div>
    </div>
  );
}
