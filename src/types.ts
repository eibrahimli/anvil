export interface Message {
    role: "System" | "User" | "Assistant" | "Tool";
    content: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

export interface ToolCall {
    id: string;
    name: string;
    arguments: string;
}

export interface FileNode {
    name: string;
    path: string;
    kind: "file" | "directory";
    children?: FileNode[];
}
