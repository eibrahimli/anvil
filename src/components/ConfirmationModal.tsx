import { useState, useEffect } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Check, X, FileDiff, Terminal as TermIcon, ShieldCheck, Zap } from "lucide-react";
import { useConfirmationStore } from "../stores/confirmation";
import { useSettingsStore } from "../stores/settings";

export function ConfirmationModal() {
    const { pendingRequest, resolveConfirmation } = useConfirmationStore();
    const { theme } = useSettingsStore();
    const [pattern, setPattern] = useState("");

    useEffect(() => {
        if (pendingRequest?.suggested_pattern) {
            setPattern(pendingRequest.suggested_pattern);
        }
    }, [pendingRequest]);

    if (!pendingRequest) return null;

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
                <div className="flex-1 relative flex flex-col overflow-hidden">
                    {isDiff ? (
                        <>
                            <div className="flex-1 bg-[#1e1e1e] overflow-hidden">
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
                            <div className="p-4 bg-[var(--bg-base)] border-t border-[var(--border)]">
                                <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/10 flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded bg-blue-500/10">
                                            <ShieldCheck size={16} className="text-blue-400" />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Rule Suggestion</p>
                                            <p className="text-[10px] text-zinc-500">Allow similar files by defining a pattern.</p>
                                        </div>
                                    </div>
                                    <input 
                                        type="text" 
                                        value={pattern}
                                        onChange={(e) => setPattern(e.target.value)}
                                        className="w-[300px] bg-black/40 border border-[var(--border)] rounded px-3 py-1.5 text-xs font-mono text-zinc-300 focus:outline-none focus:border-blue-500/50"
                                        placeholder="Pattern (e.g. src/**/*.ts)"
                                    />
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="p-6">
                            <p className="text-xs text-zinc-400 mb-3 uppercase font-bold tracking-widest">COMMAND TO EXECUTE:</p>
                            <div className="bg-[#09090b] border border-[var(--border)] rounded-lg p-4 font-mono text-sm text-green-400 break-all mb-6">
                                <span className="text-zinc-500 mr-2">$</span>
                                {pendingRequest.command}
                            </div>
                            
                            <div className="space-y-4">
                                <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/10">
                                    <div className="flex items-center gap-2 mb-2">
                                        <ShieldCheck size={14} className="text-blue-400" />
                                        <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Rule Suggestion</p>
                                    </div>
                                    <p className="text-xs text-zinc-400 mb-3 leading-relaxed">
                                        You can allow similar commands automatically by defining a pattern.
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="text" 
                                            value={pattern}
                                            onChange={(e) => setPattern(e.target.value)}
                                            className="flex-1 bg-black/40 border border-[var(--border)] rounded px-3 py-1.5 text-xs font-mono text-zinc-300 focus:outline-none focus:border-blue-500/50"
                                            placeholder="Pattern (e.g. git status*)"
                                        />
                                    </div>
                                </div>
                            </div>

                            <p className="mt-6 text-[10px] text-zinc-500 leading-relaxed italic border-l-2 border-[var(--border)] pl-4">
                                Shell commands can be destructive. "Allow Once" executes this command once. "Allow Always" creates a session rule using the pattern above.
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-base)] flex justify-between items-center px-6">
                    <button 
                        onClick={() => resolveConfirmation(false)}
                        className="px-4 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 font-medium text-xs flex items-center gap-2 transition-colors"
                    >
                        <X size={16} />
                        Deny
                    </button>

                    <div className="flex gap-3">
                        <button 
                            onClick={() => resolveConfirmation(true, true, pattern)}
                            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-[var(--border)] font-medium text-xs flex items-center gap-2 transition-colors"
                        >
                            <Zap size={16} className="text-yellow-400" />
                            Allow Always
                        </button>
                        <button 
                            onClick={() => resolveConfirmation(true)}
                            className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white font-bold text-xs flex items-center gap-2 transition-colors shadow-lg shadow-green-500/20"
                        >
                            <Check size={16} />
                            {isDiff ? 'Approve & Write' : 'Allow Once'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
