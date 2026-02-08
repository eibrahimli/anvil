import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store";
import { useUIStore } from "../stores/ui";
import { useSettingsStore } from "../stores/settings";
import { FileNode } from "../types";
import { SessionList } from "./sidebar/SessionList";
import { ChevronDown, ChevronRight, FileText, Folder, RefreshCw } from "lucide-react";
import clsx from "clsx";

export function FileTree() {
    const { workspacePath, files, activeFile, setFiles, setActiveFileContent, openFile } = useStore();
    const { setEditorOpen } = useUIStore();
    const { setDiffMode } = useSettingsStore();
    const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
    const [showSessions, setShowSessions] = useState(true);
    const [showExplorer, setShowExplorer] = useState(true);
    const [gitStatusMap, setGitStatusMap] = useState<Record<string, "staged" | "unstaged" | "untracked" | "conflicted">>({});

    useEffect(() => {
        if (workspacePath) {
            refresh();
        }
    }, [workspacePath]);

    useEffect(() => {
        if (!workspacePath) return;
        const timer = window.setInterval(refreshGitStatus, 15000);
        return () => window.clearInterval(timer);
    }, [workspacePath]);

    async function refresh() {
        try {
            const nodes = await invoke<FileNode[]>("get_file_tree", { path: workspacePath });
            setFiles(nodes);
            await refreshGitStatus();
        } catch (e) {
            console.error(e);
        }
    }

    const refreshGitStatus = async () => {
        if (!workspacePath) return;
        try {
            const result = await invoke<any>("git_status_summary", { workspacePath });
            const map: Record<string, "staged" | "unstaged" | "untracked" | "conflicted"> = {};
            const normalize = (path: string) => path.replace(/\\/g, "/");
            const base = workspacePath.replace(/\/$/, "");

            const add = (paths: string[], status: "staged" | "unstaged" | "untracked" | "conflicted") => {
                paths.forEach((path) => {
                    const fullPath = normalize(`${base}/${path}`);
                    map[fullPath] = status;
                });
            };

            add(Array.isArray(result?.staged) ? result.staged : [], "staged");
            add(Array.isArray(result?.unstaged) ? result.unstaged : [], "unstaged");
            add(Array.isArray(result?.untracked) ? result.untracked : [], "untracked");
            add(Array.isArray(result?.conflicted) ? result.conflicted : [], "conflicted");

            setGitStatusMap(map);
        } catch (error) {
            setGitStatusMap({});
        }
    };

    async function loadFile(path: string) {
        try {
            const content = await invoke<string>("read_file", { path });
            openFile(path);
            setActiveFileContent(content);
            setEditorOpen(true);

            const status = gitStatusMap[path];
            if (status && status !== "untracked") {
                try {
                    const baseContent = await invoke<string>("git_file_at_head", {
                        workspacePath,
                        filePath: path
                    });
                    setDiffMode(true, { oldContent: baseContent, newContent: content });
                } catch (error) {
                    setDiffMode(false);
                }
            } else {
                setDiffMode(false);
            }
        } catch (e) {
            console.error(e);
        }
    }

    const toggleDir = (path: string) => {
        setExpandedDirs((prev) => ({
            ...prev,
            [path]: !prev[path]
        }));
    };

    const buildTree = (entries: FileNode[], rootPath: string) => {
        const basePath = rootPath.replace(/\/$/, "");
        const root: FileNode = { name: basePath.split("/").pop() || "root", path: basePath, kind: "directory", children: [] };
        const nodeMap = new Map<string, FileNode>();
        nodeMap.set(basePath, root);

        entries.forEach((entry) => {
            const fullPath = entry.path;
            const relative = fullPath.startsWith(basePath) ? fullPath.slice(basePath.length + 1) : fullPath;
            if (!relative) return;
            const parts = relative.split("/").filter(Boolean);

            let current = root;
            let currentPath = basePath;
            parts.forEach((part, idx) => {
                currentPath = `${currentPath}/${part}`;
                const isLast = idx === parts.length - 1;
                let node = nodeMap.get(currentPath);
                if (!node) {
                    node = {
                        name: part,
                        path: currentPath,
                        kind: isLast ? entry.kind : "directory",
                        children: []
                    };
                    nodeMap.set(currentPath, node);
                    current.children = current.children || [];
                    current.children.push(node);
                }
                if (!isLast) {
                    current = node;
                }
            });
        });

        const sortNodes = (nodes: FileNode[]) => {
            nodes.sort((a, b) => {
                if (a.kind !== b.kind) {
                    return a.kind === "directory" ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });
            nodes.forEach((node) => {
                if (node.children && node.children.length > 0) {
                    sortNodes(node.children);
                }
            });
        };

        if (root.children) {
            sortNodes(root.children);
        }
        return root.children || [];
    };

    const renderNode = (node: FileNode, level: number) => {
        const isSelected = activeFile === node.path;
        const isDirectory = node.kind === "directory";
        const isExpanded = expandedDirs[node.path];
        const status = gitStatusMap[node.path];
        return (
            <div key={node.path}>
                <div 
                    className={clsx(
                        "px-2 py-1.5 cursor-pointer text-xs whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-2 rounded-md",
                        isSelected
                            ? "bg-[var(--accent)]/15 text-[var(--text-primary)]"
                            : "hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                    )}
                    style={{ paddingLeft: `${level * 12 + 8}px` }}
                    onClick={() => {
                        if (isDirectory) {
                            toggleDir(node.path);
                            return;
                        }
                        if (node.kind === "file") {
                            loadFile(node.path);
                        }
                    }}
                >
                    <span className="text-zinc-500">
                        {isDirectory ? (
                            isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
                        ) : (
                            <span className="inline-block w-3" />
                        )}
                    </span>
                    <span className="text-zinc-500">
                        {isDirectory ? <Folder size={14} /> : <FileText size={14} />}
                    </span>
                    <span className="truncate">{node.name}</span>
                    {status && !isDirectory && (
                        <span
                            className={clsx(
                                "ml-auto text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider",
                                status === "staged" && "bg-emerald-500/10 text-emerald-400",
                                status === "unstaged" && "bg-yellow-500/10 text-yellow-400",
                                status === "untracked" && "bg-blue-500/10 text-blue-400",
                                status === "conflicted" && "bg-red-500/10 text-red-400"
                            )}
                        >
                            {status === "unstaged" ? "M" : status === "untracked" ? "U" : status === "staged" ? "S" : "C"}
                        </span>
                    )}
                </div>
                {isDirectory && isExpanded && node.children && (
                    <div>
                        {node.children.map(child => renderNode(child, level + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="h-full bg-transparent flex flex-col">
            {workspacePath && (
                <div className="border-b border-[var(--border)]">
                    <button
                        onClick={() => setShowSessions((prev) => !prev)}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-zinc-500 uppercase tracking-wider"
                    >
                        <span>Recent Sessions</span>
                        {showSessions ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                    {showSessions && <SessionList showHeader={false} />}
                </div>
            )}

            <div className="p-2 text-xs font-bold text-zinc-500 uppercase tracking-wider flex justify-between items-center border-b border-[var(--border)]">
                <button
                    onClick={() => setShowExplorer((prev) => !prev)}
                    className="flex items-center gap-2"
                >
                    {showExplorer ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span>Explorer</span>
                </button>
                <button onClick={refresh} className="hover:text-white p-1 rounded hover:bg-[var(--bg-elevated)]" title="Refresh">
                    <RefreshCw size={12} />
                </button>
            </div>
            {showExplorer && workspacePath && (
                <div className="flex-1 overflow-auto py-2">
                    {files.length > 0 ? (
                        buildTree(files, workspacePath).map(node => renderNode(node, 0))
                    ) : (
                        <div className="text-zinc-600 text-xs p-4 text-center">Empty workspace</div>
                    )}
                </div>
            )}
            {!workspacePath && (
                <div className="text-zinc-600 text-xs p-4 text-center">Select a workspace to view files</div>
            )}
        </div>
    );
}
