import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export function Terminal() {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    useEffect(() => {
        if (!terminalRef.current) return;

        const term = new XTerm({
            theme: {
                background: '#09090B',
                foreground: '#F4F4F5',
                cursor: '#8B5CF6',
                selectionBackground: 'rgba(139, 92, 246, 0.3)',
            },
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 13,
            cursorBlink: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        
        term.open(terminalRef.current);
        fitAddon.fit();

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        // Initialize backend terminal
        invoke('spawn_terminal').catch(console.error);

        // Handle Input
        term.onData((data) => {
            invoke('write_terminal', { data });
        });

        // Listen for backend data
        const unlisten = listen<string>('term-data', (event) => {
            term.write(event.payload);
        });

        // Handle Resizing
        const resizeHandler = () => {
            fitAddon.fit();
            invoke('resize_terminal', { 
                cols: term.cols, 
                rows: term.rows 
            }).catch(console.error);
        };
        window.addEventListener('resize', resizeHandler);

        return () => {
            window.removeEventListener('resize', resizeHandler);
            unlisten.then(f => f());
            term.dispose();
        };
    }, []);

    return (
        <div className="w-full h-full bg-[#09090B]">
            <div ref={terminalRef} className="w-full h-full p-2" />
        </div>
    );
}
