import Editor, { DiffEditor } from "@monaco-editor/react";
import { useStore } from "../store";
import { useSettingsStore } from "../stores/settings";
import { useEffect, useState, useCallback, useMemo, useRef, type KeyboardEvent } from "react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, SplitSquareVertical, Columns, FileDiff, ChevronDown, ChevronRight, ChevronsUpDown, Search } from "lucide-react";

type ChangeStatus = "staged" | "unstaged" | "untracked" | "conflicted";

const STATUS_ORDER: ChangeStatus[] = ["conflicted", "staged", "unstaged", "untracked"];

export function CodeEditor() {
    const { theme, fontFamily, fontSize, isDiffMode, diffContent, setDiffMode } = useSettingsStore();
    const { activeFileContent, activeFile, setActiveFileContent, workspacePath } = useStore();
    const [editorKey, setEditorKey] = useState(0); // Key to force remount
    const [isFollowMode, setIsFollowMode] = useState(true); // New state for auto-follow
    const [viewMode, setViewMode] = useState<"file" | "changes">("file");
    const [manualViewMode, setManualViewMode] = useState(false);
    const [diffView, setDiffView] = useState<"split" | "unified">("split");
    const [changesLoading, setChangesLoading] = useState(false);
    const [changesError, setChangesError] = useState<string | null>(null);
    const [changedFiles, setChangedFiles] = useState<Array<{ path: string; status: ChangeStatus }>>([]);
    const [selectedChange, setSelectedChange] = useState<string | null>(null);
    const [changeDiff, setChangeDiff] = useState<{ original: string; modified: string } | null>(null);
    const [changeLanguage, setChangeLanguage] = useState("text");
    const [expandedGroups, setExpandedGroups] = useState<Record<ChangeStatus, boolean>>({
        staged: true,
        unstaged: true,
        untracked: true,
        conflicted: true
    });
    const [searchQuery, setSearchQuery] = useState("");
    const [quickOpenQuery, setQuickOpenQuery] = useState("");
    const listRef = useRef<HTMLDivElement>(null);
    const quickOpenBufferRef = useRef("");
    const quickOpenTimerRef = useRef<number | null>(null);

    const statusLabels: Record<ChangeStatus, string> = {
        conflicted: "Conflicted",
        staged: "Staged",
        unstaged: "Unstaged",
        untracked: "Untracked"
    };
    const statusBadgeClasses: Record<ChangeStatus, string> = {
        conflicted: "bg-red-500/10 text-red-400",
        staged: "bg-emerald-500/10 text-emerald-400",
        unstaged: "bg-yellow-500/10 text-yellow-400",
        untracked: "bg-blue-500/10 text-blue-400"
    };
    const counts = useMemo(() => {
        return changedFiles.reduce<Record<ChangeStatus, number>>((acc, file) => {
            acc[file.status] += 1;
            return acc;
        }, { conflicted: 0, staged: 0, unstaged: 0, untracked: 0 });
    }, [changedFiles]);
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filteredChanges = useMemo(() => {
        if (!normalizedQuery) return changedFiles;
        return changedFiles.filter((file) => file.path.toLowerCase().includes(normalizedQuery));
    }, [changedFiles, normalizedQuery]);
    const groupedChanges = useMemo(() => {
        return STATUS_ORDER.map((status) => ({
            status,
            items: filteredChanges.filter((file) => file.status === status).sort((a, b) => a.path.localeCompare(b.path))
        }));
    }, [filteredChanges]);
    const visiblePaths = useMemo(() => filteredChanges.map((file) => file.path), [filteredChanges]);
    const hasExpanded = STATUS_ORDER.some((status) => expandedGroups[status]);
    const highlightQuery = normalizedQuery || quickOpenQuery;

    const setAllGroupsExpanded = useCallback((nextState: boolean) => {
        setExpandedGroups({
            conflicted: nextState,
            staged: nextState,
            unstaged: nextState,
            untracked: nextState
        });
    }, []);
    
    useEffect(() => {
        setEditorKey(prev => prev + 1);
    }, [theme, fontFamily, fontSize]);
    
    useEffect(() => {
        setEditorKey(prev => prev + 1);
    }, [activeFile]);

    useEffect(() => {
        return () => {
            if (quickOpenTimerRef.current) {
                window.clearTimeout(quickOpenTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (viewMode !== "changes") return;
        if (!workspacePath) return;
        refreshChanges();
        const timer = window.setInterval(refreshChanges, 15000);
        return () => window.clearInterval(timer);
    }, [viewMode, workspacePath]);

    const handleEditorChange = useCallback((value: string | undefined) => {
        if (!isDiffMode && activeFile) {
             setActiveFileContent(value || "");
        }
    }, [isDiffMode, activeFile, setActiveFileContent]);

    const loadChangeDiff = useCallback(async (relativePath: string, status: ChangeStatus) => {
        if (!workspacePath) return;
        const basePath = workspacePath.replace(/\/$/, "");
        const absolutePath = `${basePath}/${relativePath}`;
        try {
            const ext = relativePath.split(".").pop();
            setChangeLanguage(ext || "text");
            let original = "";
            if (status !== "untracked") {
                try {
                    original = await invoke<string>("git_file_at_head", {
                        workspacePath,
                        filePath: absolutePath
                    });
                } catch (error) {
                    original = "";
                }
            }
            let modified = "";
            try {
                modified = await invoke<string>("read_file", { path: absolutePath });
            } catch (error) {
                modified = "";
            }
            setChangeDiff({ original, modified });
        } catch (error) {
            setChangeDiff({ original: "", modified: "" });
        }
    }, [workspacePath]);

    const selectChange = useCallback((file: { path: string; status: ChangeStatus }) => {
        setSelectedChange(file.path);
        loadChangeDiff(file.path, file.status);
    }, [loadChangeDiff]);

    const refreshChanges = async () => {
        if (!workspacePath) return;
        setChangesLoading(true);
        setChangesError(null);
        try {
            const result = await invoke<any>("git_status_summary", { workspacePath });
            const stagedList = Array.isArray(result?.staged) ? result.staged : [];
            const unstagedList = Array.isArray(result?.unstaged) ? result.unstaged : [];
            const untrackedList = Array.isArray(result?.untracked) ? result.untracked : [];
            const conflictedList = Array.isArray(result?.conflicted) ? result.conflicted : [];
            const priority: Record<string, number> = { conflicted: 3, staged: 2, unstaged: 1, untracked: 0 };
            const map = new Map<string, { path: string; status: ChangeStatus }>();

            const add = (paths: string[], status: ChangeStatus) => {
                paths.forEach((path) => {
                    const existing = map.get(path);
                    if (!existing || priority[status] > priority[existing.status]) {
                        map.set(path, { path, status });
                    }
                });
            };

            add(untrackedList, "untracked");
            add(unstagedList, "unstaged");
            add(stagedList, "staged");
            add(conflictedList, "conflicted");

            const list = Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
            setChangedFiles(list);
            if (!manualViewMode) {
                setViewMode(list.length > 0 ? "changes" : "file");
            }
            if (list.length > 0) {
                const next = selectedChange && list.some(item => item.path === selectedChange)
                    ? selectedChange
                    : list[0].path;
                const nextItem = list.find(item => item.path === next);
                if (nextItem) {
                    selectChange(nextItem);
                }
            } else {
                setSelectedChange(null);
                setChangeDiff(null);
            }
        } catch (error) {
            setChangesError("Failed to load git changes.");
        } finally {
            setChangesLoading(false);
        }
    };

    useEffect(() => {
        if (viewMode !== "changes") return;
        if (!filteredChanges.length) {
            setSelectedChange(null);
            setChangeDiff(null);
            return;
        }
        if (!selectedChange || !visiblePaths.includes(selectedChange)) {
            const next = filteredChanges[0];
            selectChange(next);
        }
    }, [filteredChanges, selectChange, selectedChange, viewMode, visiblePaths]);

    const moveSelection = useCallback((direction: "up" | "down" | "first" | "last") => {
        if (filteredChanges.length === 0) return;
        const currentIndex = filteredChanges.findIndex((file) => file.path === selectedChange);
        let nextIndex = currentIndex;
        if (direction === "down") {
            nextIndex = Math.min(filteredChanges.length - 1, currentIndex < 0 ? 0 : currentIndex + 1);
        } else if (direction === "up") {
            nextIndex = Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1);
        } else if (direction === "first") {
            nextIndex = 0;
        } else if (direction === "last") {
            nextIndex = filteredChanges.length - 1;
        }
        const nextFile = filteredChanges[nextIndex];
        if (nextFile) {
            selectChange(nextFile);
        }
    }, [filteredChanges, selectChange, selectedChange]);

    const resetQuickOpenBuffer = useCallback(() => {
        quickOpenBufferRef.current = "";
        setQuickOpenQuery("");
        if (quickOpenTimerRef.current) {
            window.clearTimeout(quickOpenTimerRef.current);
            quickOpenTimerRef.current = null;
        }
    }, []);

    const handleQuickOpen = useCallback((nextChar: string) => {
        const buffer = `${quickOpenBufferRef.current}${nextChar}`.toLowerCase();
        quickOpenBufferRef.current = buffer;
        setQuickOpenQuery(buffer);

        if (quickOpenTimerRef.current) {
            window.clearTimeout(quickOpenTimerRef.current);
        }
        quickOpenTimerRef.current = window.setTimeout(() => {
            quickOpenBufferRef.current = "";
            setQuickOpenQuery("");
            quickOpenTimerRef.current = null;
        }, 700);

        if (!buffer || filteredChanges.length === 0) return;

        const matches = filteredChanges
            .map((file, index) => {
                const baseName = file.path.split("/").pop() || file.path;
                const lowerPath = file.path.toLowerCase();
                const lowerBase = baseName.toLowerCase();
                const isMatch = lowerBase.startsWith(buffer) || lowerPath.includes(buffer);
                return isMatch ? index : -1;
            })
            .filter((index) => index >= 0);

        if (matches.length === 0) return;

        const currentIndex = filteredChanges.findIndex((file) => file.path === selectedChange);
        const nextMatch = matches.find((index) => index > currentIndex) ?? matches[0];
        const nextFile = filteredChanges[nextMatch];
        if (nextFile) {
            selectChange(nextFile);
        }
    }, [filteredChanges, selectChange, selectedChange]);

    const renderHighlightedPath = useCallback((path: string) => {
        if (!highlightQuery) {
            return <span className="truncate">{path}</span>;
        }
        const lowerPath = path.toLowerCase();
        const lowerQuery = highlightQuery.toLowerCase();
        const matchIndex = lowerPath.indexOf(lowerQuery);
        if (matchIndex < 0) {
            return <span className="truncate">{path}</span>;
        }
        const before = path.slice(0, matchIndex);
        const match = path.slice(matchIndex, matchIndex + lowerQuery.length);
        const after = path.slice(matchIndex + lowerQuery.length);
        return (
            <span className="truncate">
                {before}
                <span className="rounded-sm bg-[var(--accent)]/15 px-0.5 text-[var(--text-primary)]">
                    {match}
                </span>
                {after}
            </span>
        );
    }, [highlightQuery]);

    const handleListKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            resetQuickOpenBuffer();
            return;
        }
        if (
            event.key.length === 1 &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
        ) {
            const isValidChar = /[\w./-]/.test(event.key);
            if (isValidChar) {
                event.preventDefault();
                handleQuickOpen(event.key);
            }
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            resetQuickOpenBuffer();
            moveSelection("down");
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            resetQuickOpenBuffer();
            moveSelection("up");
        } else if (event.key === "Home") {
            event.preventDefault();
            resetQuickOpenBuffer();
            moveSelection("first");
        } else if (event.key === "End") {
            event.preventDefault();
            resetQuickOpenBuffer();
            moveSelection("last");
        } else if (event.key === "Enter") {
            event.preventDefault();
            if (selectedChange) {
                const selectedFile = filteredChanges.find((file) => file.path === selectedChange);
                if (selectedFile) {
                    selectChange(selectedFile);
                }
            } else if (filteredChanges[0]) {
                moveSelection("first");
            }
        }
    }, [filteredChanges, handleQuickOpen, moveSelection, resetQuickOpenBuffer, selectChange, selectedChange]);

    if (!activeFile && viewMode === "file") {
        return (
            <div className="h-full w-full flex items-center justify-center text-zinc-600 text-sm italic bg-[var(--bg-surface)]">
                No file selected in the active editor tab.
            </div>
        );
    }

    const baseLanguage = activeFile?.split('.').pop() || 'text';
    
    if (viewMode === "changes") {
        return (
            <div key={editorKey} className="h-full w-full flex flex-col">
                <div className="h-8 border-b border-[var(--border)] bg-[var(--bg-elevated)] shrink-0 flex items-center px-2 gap-2 justify-between">
                    <div className="flex items-center gap-2">
                        <FileDiff size={12} className="text-[var(--accent)]" />
                        <span className="text-[9px] font-bold uppercase text-zinc-400 tracking-widest">Session Changes</span>
                        <span className="text-[9px] text-zinc-500">{changedFiles.length} files</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                            <span className={clsx("text-[9px] px-1.5 py-0.5 rounded-full", statusBadgeClasses.conflicted)}>{counts.conflicted}</span>
                            <span className={clsx("text-[9px] px-1.5 py-0.5 rounded-full", statusBadgeClasses.staged)}>{counts.staged}</span>
                            <span className={clsx("text-[9px] px-1.5 py-0.5 rounded-full", statusBadgeClasses.unstaged)}>{counts.unstaged}</span>
                            <span className={clsx("text-[9px] px-1.5 py-0.5 rounded-full", statusBadgeClasses.untracked)}>{counts.untracked}</span>
                        </div>
                        <button
                            onClick={() => {
                                const nextState = !hasExpanded;
                                setAllGroupsExpanded(nextState);
                            }}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] text-zinc-400 hover:bg-zinc-800"
                        >
                            <ChevronsUpDown size={12} />
                            {hasExpanded ? "Collapse" : "Expand"}
                        </button>
                        <button
                            onClick={() => setDiffView(diffView === "split" ? "unified" : "split")}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] text-zinc-400 hover:bg-zinc-800"
                        >
                            {diffView === "split" ? <SplitSquareVertical size={12} /> : <Columns size={12} />}
                            {diffView === "split" ? "Split" : "Unified"}
                        </button>
                        <button
                            onClick={refreshChanges}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] text-zinc-400 hover:bg-zinc-800"
                        >
                            <RefreshCw size={12} className={clsx(changesLoading && "animate-spin")} />
                            Refresh
                        </button>
                    </div>
                </div>
                <div className="flex-1 flex overflow-hidden">
                    <div className="flex-1 border-r border-[var(--border)]">
                        {changesError && (
                            <div className="p-4 text-xs text-red-400">{changesError}</div>
                        )}
                        {!changesError && !changeDiff && (
                            <div className="p-4 text-xs text-zinc-500">Select a file to view changes.</div>
                        )}
                        {!changesError && changeDiff && (
                            <DiffEditor
                                key={editorKey}
                                height="100%"
                                original={changeDiff.original}
                                modified={changeDiff.modified}
                                language={changeLanguage}
                                theme={theme === 'light' ? 'light' : 'vs-dark'}
                                options={{
                                    minimap: { enabled: false },
                                    fontSize: fontSize,
                                    fontFamily: fontFamily,
                                    readOnly: true,
                                    automaticLayout: true,
                                    renderSideBySide: diffView === "split",
                                    renderSideBySideInlineBreakpoint: 0,
                                    padding: { top: 20 }
                                }}
                            />
                        )}
                    </div>
                    <div className="w-64 bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col">
                        <div className="px-3 py-2 border-b border-[var(--border)]">
                            <div className="flex items-center justify-between text-[9px] uppercase tracking-widest text-zinc-500">
                                <span>Files</span>
                                <span className="text-zinc-600">
                                    {filteredChanges.length}/{changedFiles.length}
                                </span>
                            </div>
                            <div className="mt-2 relative">
                                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
                                <input
                                    value={searchQuery}
                                    onChange={(event) => {
                                        setSearchQuery(event.target.value);
                                        resetQuickOpenBuffer();
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === "Escape") {
                                            event.preventDefault();
                                            setSearchQuery("");
                                            listRef.current?.focus();
                                            resetQuickOpenBuffer();
                                            return;
                                        }
                                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                                            event.preventDefault();
                                            listRef.current?.focus();
                                            if (event.key === "ArrowDown") {
                                                moveSelection("down");
                                            } else {
                                                moveSelection("up");
                                            }
                                        }
                                    }}
                                    placeholder="Filter files"
                                    className="w-full bg-[var(--bg-base)] text-[var(--text-primary)] placeholder:text-zinc-600 border border-[var(--border)] rounded-md pl-7 pr-2 py-1 text-[11px] focus:outline-none focus:border-[var(--accent)]"
                                />
                            </div>
                        </div>
                        <div
                            ref={listRef}
                            tabIndex={0}
                            onKeyDown={handleListKeyDown}
                            className="overflow-y-auto h-full focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
                        >
                            {changedFiles.length === 0 && (
                                <div className="p-4 text-xs text-zinc-500">No changes detected.</div>
                            )}
                            {changedFiles.length > 0 && filteredChanges.length === 0 && (
                                <div className="p-4 text-xs text-zinc-500">No matches for "{searchQuery}".</div>
                            )}
                            {filteredChanges.length > 0 && groupedChanges.map((group) => (
                                <div key={group.status}>
                                    <div className="sticky top-0 z-10 w-full px-3 py-1.5 text-[9px] uppercase tracking-widest text-zinc-500 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg-surface)]/95 backdrop-blur">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setExpandedGroups((prev) => ({
                                                    ...prev,
                                                    [group.status]: !prev[group.status]
                                                }));
                                            }}
                                            className="flex items-center gap-2 text-left hover:text-zinc-300"
                                        >
                                            {expandedGroups[group.status] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                            {statusLabels[group.status]}
                                        </button>
                                        <span className="flex items-center gap-2">
                                            <span className={clsx("text-[9px] px-1.5 py-0.5 rounded-full", statusBadgeClasses[group.status])}>
                                                {counts[group.status]}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setAllGroupsExpanded(!hasExpanded);
                                                }}
                                                className="text-[9px] text-zinc-600 hover:text-zinc-300"
                                            >
                                                {hasExpanded ? "Collapse all" : "Expand all"}
                                            </button>
                                        </span>
                                    </div>
                                    {expandedGroups[group.status] && group.items.map((file) => (
                                    <button
                                        key={file.path}
                                        onClick={() => {
                                            selectChange(file);
                                        }}
                                            className={clsx(
                                                "w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 border-b border-[var(--border)]/50",
                                                selectedChange === file.path ? "bg-[var(--accent)]/10 text-[var(--text-primary)]" : "text-zinc-400 hover:bg-[var(--bg-elevated)]"
                                            )}
                                        >
                                            <span className={clsx(
                                                "text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider",
                                                file.status === "staged" && "bg-emerald-500/10 text-emerald-400",
                                                file.status === "unstaged" && "bg-yellow-500/10 text-yellow-400",
                                                file.status === "untracked" && "bg-blue-500/10 text-blue-400",
                                                file.status === "conflicted" && "bg-red-500/10 text-red-400"
                                            )}>
                                                {file.status === "unstaged" ? "M" : file.status === "untracked" ? "A" : file.status === "staged" ? "S" : "C"}
                                            </span>
                                            {renderHighlightedPath(file.path)}
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (isDiffMode && diffContent.oldContent) {
        return (
            <div key={editorKey} className="h-full w-full flex flex-col">
                <div className="h-9 border-b border-[var(--border)] bg-[var(--bg-elevated)] shrink-0 flex items-center px-3 gap-3">
                    <span className="text-[10px] font-bold uppercase text-zinc-400">Diff Mode Active</span>
                    <span className="text-xs font-mono text-blue-400 truncate flex-1">{activeFile?.split('/').pop()}</span>
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
                        renderSideBySideInlineBreakpoint: 0,
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
                <button
                    onClick={() => {
                        setViewMode("file");
                        setManualViewMode(true);
                    }}
                    className={clsx(
                        "text-[10px] px-2 py-0.5 rounded font-medium transition-colors",
                        "bg-[var(--accent)]/10 text-[var(--accent)]"
                    )}
                >
                    File
                </button>
                <button
                    onClick={() => {
                        setViewMode("changes");
                        setManualViewMode(true);
                        setDiffMode(false);
                    }}
                    className={clsx(
                        "text-[10px] px-2 py-0.5 rounded font-medium transition-colors",
                        "bg-zinc-700/40 text-zinc-500 hover:bg-zinc-700"
                    )}
                >
                    Changes
                </button>
                <span className="text-xs font-mono text-zinc-400 truncate">{activeFile?.split('/').pop()}</span>
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
