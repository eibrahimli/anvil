import Editor, { DiffEditor } from "@monaco-editor/react";
import { useStore } from "../store";
import { useSettingsStore } from "../stores/settings";
import { useEffect, useState, useCallback } from "react";
import clsx from "clsx";

export function CodeEditor() {
    const { theme, fontFamily, fontSize, isDiffMode, diffContent } = useSettingsStore();
    const { activeFileContent, activeFile, setActiveFileContent } = useStore();
    const [editorKey, setEditorKey] = useState(0); // Key to force remount
    const [isFollowMode, setIsFollowMode] = useState(true); // New state for auto-follow
    
    useEffect(() => {
        setEditorKey(prev => prev + 1);
    }, [theme, fontFamily, fontSize]);
    
    useEffect(() => {
        setEditorKey(prev => prev + 1);
    }, [activeFile]);

    const handleEditorChange = useCallback((value: string | undefined) => {
        if (!isDiffMode && activeFile) {
             setActiveFileContent(value || "");
        }
    }, [isDiffMode, activeFile, setActiveFileContent]);

    if (!activeFile) {
        return (
            <div className="h-full w-full flex items-center justify-center text-zinc-600 text-sm italic bg-[var(--bg-surface)]">
                No file selected in the active editor tab.
            </div>
        );
    }

    const baseLanguage = activeFile?.split('.').pop() || 'text';
    
    if (isDiffMode && diffContent.oldContent) {
        return (
            <div key={editorKey} className="h-full w-full flex flex-col">
                <div className="h-9 border-b border-[var(--border)] bg-[var(--bg-elevated)] shrink-0 flex items-center px-3 gap-3">
                    <span className="text-[10px] font-bold uppercase text-zinc-400">Diff Mode Active</span>
                    <span className="text-xs font-mono text-blue-400 truncate flex-1">{activeFile.split('/').pop()}</span>
                </div>
                <DiffEditor
                    key={editorKey}
                    height="calc(100% - 36px)"
                    original={diffContent.oldContent}
                    modified={activeFileContent}
                    language={baseLanguage}
                    theme={theme === 'light' ? 'light' : 'vs-dark'}
                    options={{
                        minimap: { enabled: false },
                        fontSize: fontSize,
                        fontFamily: fontFamily,
                        readOnly: true,
                        automaticLayout: true,
                        padding: { top: 20 }
                    }}
                />
            </div>
        );
    }

    return (
        <div key={editorKey} className="h-full w-full flex flex-col">
            {/* Editor Toolbar for Follow Mode / Tabs */}
            <div className="h-9 border-b border-[var(--border)] bg-[var(--bg-surface)]/50 shrink-0 flex items-center px-3 gap-3">
                <span className="text-xs font-mono text-zinc-400 truncate">{activeFile.split('/').pop()}</span>
                <button
                    onClick={() => setIsFollowMode(!isFollowMode)}
                    title={isFollowMode ? "Disable Auto-Follow" : "Enable Auto-Follow"}
                    className={clsx(
                        "text-[10px] px-2 py-0.5 rounded font-medium transition-colors",
                        isFollowMode ? "bg-green-500/10 text-green-400" : "bg-zinc-700/50 text-zinc-500 hover:bg-zinc-700"
                    )}
                >
                    {isFollowMode ? "FOLLOWING" : "MANUAL"}
                </button>
            </div>
            <Editor
                height="calc(100% - 36px)"
                defaultLanguage={baseLanguage}
                language={baseLanguage}
                path={activeFile || undefined}
                value={activeFileContent}
                theme={theme === 'light' ? 'light' : 'vs-dark'}
                options={{
                    minimap: { enabled: false },
                    fontSize: fontSize,
                    fontFamily: fontFamily,
                    readOnly: true, // Editor is primarily for viewing/agent changes
                    automaticLayout: true,
                    padding: { top: 20 },
                    scrollbar: {
                        vertical: 'hidden',
                        horizontal: 'hidden'
                    }
                }}
                onChange={handleEditorChange}
            />
        </div>
    );
}