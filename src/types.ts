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

export interface ToolResult {
    // This structure needs to be refined based on actual tool output, but serves as a placeholder.
}

export interface DiffContent {
    oldContent: string | null;
    newContent: string | null;
}