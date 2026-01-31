import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store";

export function useAgentEvents() {
    useEffect(() => {
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
        };
    }, []);
}