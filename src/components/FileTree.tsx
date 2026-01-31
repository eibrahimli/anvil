import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store";
import { FileNode } from "../types";

export function FileTree() {
    const { workspacePath, files, activeFile, setFiles, setActiveFileContent, openFile } = useStore();

    useEffect(() => {
        if (workspacePath) {
            refresh();
        }
    }, [workspacePath]);

    async function refresh() {
        try {
            const nodes = await invoke<FileNode[]>("get_file_tree", { path: workspacePath });
            setFiles(nodes);
        } catch (e) {
            console.error(e);
        }
    }

    async function loadFile(path: string) {
        try {
            const content = await invoke<string>("read_file", { path });
            openFile(path);
            setActiveFileContent(content);
        } catch (e) {
            console.error(e);
        }
    }

    const renderNode = (node: FileNode, level: number) => {
        const isSelected = activeFile === node.path;
        return (
            <div key={node.path}>
                <div 
                    className={`
                        px-2 py-1 cursor-pointer text-sm whitespace-nowrap overflow-hidden text-ellipsis flex items-center
                        ${isSelected ? "bg-blue-800 text-white" : "hover:bg-gray-800 text-gray-300"}
                    `}
                    style={{ paddingLeft: `${level * 12 + 8}px` }}
                    onClick={() => {
                        if (node.kind === "file") {
                            loadFile(node.path);
                        }
                    }}
                >
                    <span className="mr-2 opacity-70 w-4 inline-block text-center">
                        {node.kind === "directory" ? "📁" : "📄"}
                    </span>
                    {node.name}
                </div>
                {node.kind === "directory" && node.children && (
                    <div>
                        {node.children.map(child => renderNode(child, level + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="h-full bg-gray-900 border-r border-gray-800 flex flex-col w-64">
            <div className="p-2 text-xs font-bold text-gray-500 uppercase tracking-wider flex justify-between items-center border-b border-gray-800">
                <span>Explorer</span>
                <button onClick={refresh} className="hover:text-white p-1 rounded hover:bg-gray-700" title="Refresh">↻</button>
            </div>
            <div className="flex-1 overflow-auto py-2">
                {files.length > 0 ? (
                    files.map(node => renderNode(node, 0))
                ) : (
                    <div className="text-gray-600 text-xs p-4 text-center">Empty workspace</div>
                )}
            </div>
        </div>
    );
}
