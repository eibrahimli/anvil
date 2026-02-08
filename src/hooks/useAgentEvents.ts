import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store";

export function useAgentEvents() {
    useEffect(() => {
        const unlistenToolCall = listen<{ session_id: string; tool_call_id: string; tool_name: string; arguments: string }>(
            "agent-tool-call",
            (event) => {
                const { session_id, tool_call_id, tool_name, arguments: args } = event.payload;
                const state = useStore.getState();
                if (!state.sessionId || state.sessionId !== session_id) {
                    return;
                }
                state.appendToolCallToLastAssistant({
                    id: tool_call_id,
                    name: tool_name,
                    arguments: args
                });
            }
        );

        const unlistenToolResult = listen<{ session_id: string; tool_call_id: string; tool_name: string; content: string }>(
            "agent-tool-result",
            (event) => {
                const { session_id, tool_call_id, content } = event.payload;
                const state = useStore.getState();
                if (!state.sessionId || state.sessionId !== session_id) {
                    return;
                }
                state.addMessage({
                    role: "Tool",
                    content,
                    tool_call_id
                });
            }
        );

        // Agent File Open Listener (For Agent-Aware Editor)
        const unlistenFileOpen = listen<{ path: string, reason: string, line_start?: number, line_end?: number }>("file-opened-by-agent", async (event) => {
            const { path, reason, line_start } = event.payload;
            
            try {
                const content = await invoke<string>("read_file", { path });
                useStore.getState().openFile(path);
                useStore.getState().setActiveFileContent(content);
                
                console.info(`${reason}: ${path} (Line: ${line_start || 1})`);
            } catch (error) {
                console.error(`Failed to open file for agent: ${path}`, error);
            }
        });

        return () => {
            unlistenFileOpen.then(f => f());
            unlistenToolCall.then(f => f());
            unlistenToolResult.then(f => f());
        };
    }, []);
}
