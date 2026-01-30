import { DiffEditor } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { Check, X, FileDiff, Terminal as TermIcon } from "lucide-react";
import { useConfirmationStore } from "../stores/confirmation";
import { useSettingsStore } from "../stores/settings";

export function ConfirmationModal() {
    const { pendingRequest, setPendingRequest } = useConfirmationStore();
    const { theme } = useSettingsStore();

    if (!pendingRequest) return null;

    const handleAction = async (allowed: boolean) => {
        try {
            await invoke("confirm_action", {
                id: pendingRequest.id,
                allowed
            });
        } catch (e) {
            console.error("Failed to confirm action:", e);
        } finally {
            setPendingRequest(null);
        }
    };

    const isDiff = pendingRequest.type === 'diff';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className={`bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${isDiff ? 'w-[90vw] h-[90vh]' : 'w-[600px]'}`}>
                
                {/* Header */}
                <div className="h-14 border-b border-[var(--border)] flex items-center justify-between px-6 bg-[var(--bg-base)]">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${isDiff ? 'bg-blue-500/10 text-blue-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                            {isDiff ? <FileDiff size={20} /> : <TermIcon size={20} />}
                        </div>
                        <div>
                            <h2 className="font-bold text-sm tracking-tight">{isDiff ? 'Review Changes' : 'Confirm Shell Command'}</h2>
                            <p className="text-[10px] text-zinc-500 font-mono truncate max-w-[400px]">
                                {isDiff ? pendingRequest.file_path : 'Security Check'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 relative overflow-auto">
                    {isDiff ? (
                        <div className="h-full bg-[#1e1e1e]">
                             <DiffEditor 
                                height="100%"
                                language="typescript" // Todo: Auto-detect based on extension
                                original={pendingRequest.old_content || ""}
                                modified={pendingRequest.new_content}
                                theme={theme === 'dark' ? "vs-dark" : "light"}
                                options={{
                                    readOnly: true,
                                    minimap: { enabled: false },
                                    scrollBeyondLastLine: false,
                                    fontSize: 14,
                                    renderSideBySide: true
                                }}
                            />
                        </div>
                    ) : (
                        <div className="p-6">
                            <p className="text-xs text-zinc-400 mb-3 uppercase font-bold tracking-widest">COMMAND TO EXECUTE:</p>
                            <div className="bg-[#09090b] border border-[var(--border)] rounded-lg p-4 font-mono text-sm text-green-400 break-all">
                                <span className="text-zinc-500 mr-2">$</span>
                                {pendingRequest.command}
                            </div>
                            <p className="mt-4 text-xs text-zinc-500 leading-relaxed italic">
                                Shell commands can be destructive. Please verify the command before allowing execution.
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-base)] flex justify-end gap-3">
                    <button 
                        onClick={() => handleAction(false)}
                        className="px-4 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 font-medium text-xs flex items-center gap-2 transition-colors"
                    >
                        <X size={16} />
                        {isDiff ? 'Reject Changes' : 'Block Execution'}
                    </button>
                    <button 
                        onClick={() => handleAction(true)}
                        className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white font-bold text-xs flex items-center gap-2 transition-colors shadow-lg shadow-green-500/20"
                    >
                        <Check size={16} />
                        {isDiff ? 'Approve & Write' : 'Allow Execution'}
                    </button>
                </div>
            </div>
        </div>
    );
}
