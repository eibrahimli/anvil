import { X, FileText } from "lucide-react";
import { useStore } from "../store";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";

export function TabList() {
    const { openFiles, activeFile, openFile, closeFile, setActiveFileContent } = useStore();

    const handleTabClick = async (path: string) => {
        try {
            const content = await invoke<string>("read_file", { path });
            openFile(path);
            setActiveFileContent(content);
        } catch (e) {
            console.error(e);
        }
    };

    if (openFiles.length === 0) return null;

    return (
        <div className="flex bg-[var(--bg-base)] border-b border-[var(--border)] overflow-x-auto no-scrollbar h-9">
            {openFiles.map((path) => {
                const fileName = path.split('/').pop() || path;
                const isActive = activeFile === path;

                return (
                    <div
                        key={path}
                        className={clsx(
                            "flex items-center gap-2 px-3 py-1.5 border-r border-[var(--border)] cursor-pointer min-w-[120px] max-w-[200px] transition-colors group",
                            isActive ? "bg-[var(--bg-surface)] text-[var(--accent)]" : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300"
                        )}
                        onClick={() => handleTabClick(path)}
                    >
                        <FileText size={14} className={clsx(isActive ? "text-[var(--accent)]" : "text-zinc-600")} />
                        <span className="text-xs truncate flex-1 font-medium">{fileName}</span>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                closeFile(path);
                            }}
                            className={clsx(
                                "p-0.5 rounded hover:bg-zinc-700 transition-colors opacity-0 group-hover:opacity-100",
                                isActive && "opacity-100"
                            )}
                        >
                            <X size={12} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
