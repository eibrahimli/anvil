import { useCallback, useEffect, useRef, useState } from 'react';
import { useUIStore } from '../../stores/ui';
import { FileTree } from '../FileTree';
import { SearchPanel } from '../SearchPanel';
import { WorkflowsPanel } from '../WorkflowsPanel';
import { SkillsPanel } from '../SkillsPanel';
import { McpManager } from '../mcp/McpManager';
import clsx from 'clsx';

export function SidePanel() {
  const { activeSidebarTab, sidebarWidth, setSidebarWidth } = useUIStore();
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const clampWidth = useCallback((width: number) => {
    const minWidth = 220;
    const maxWidth = Math.min(480, Math.floor(window.innerWidth * 0.4));
    return Math.min(maxWidth, Math.max(minWidth, width));
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (!dragRef.current) return;
    const delta = event.clientX - dragRef.current.startX;
    const nextWidth = clampWidth(dragRef.current.startWidth + delta);
    pendingWidthRef.current = nextWidth;
    if (rafRef.current === null) {
      rafRef.current = window.requestAnimationFrame(() => {
        if (pendingWidthRef.current !== null) {
          setSidebarWidth(pendingWidthRef.current);
        }
        rafRef.current = null;
      });
    }
  }, [clampWidth, setSidebarWidth]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    setIsResizing(false);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [handlePointerMove]);

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: sidebarWidth };
    setIsResizing(true);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [handlePointerMove, handlePointerUp, sidebarWidth]);

  useEffect(() => {
    const onResize = () => {
      setSidebarWidth(clampWidth(sidebarWidth));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampWidth, setSidebarWidth, sidebarWidth]);

  useEffect(() => () => handlePointerUp(), [handlePointerUp]);

  if (!activeSidebarTab) return null;

  return (
    <div className={clsx(
      "relative bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col h-full transition-all duration-200 ease-in-out",
      activeSidebarTab ? "block" : "hidden",
      isResizing && "transition-none"
    )} style={{ width: sidebarWidth }}>
      <div className="h-10 border-b border-[var(--border)] flex items-center px-4 font-bold text-[var(--text-primary)] uppercase text-xs tracking-wider">
        {activeSidebarTab === 'explorer' ? 'Explorer' :
          activeSidebarTab === 'search' ? 'Search' :
          activeSidebarTab === 'workflows' ? 'Workflows' :
          activeSidebarTab === 'skills' ? 'Skills' :
            activeSidebarTab === 'mcp' ? 'MCP Servers' :
              activeSidebarTab}
      </div>

      <div className="flex-1 overflow-auto">
        {activeSidebarTab === 'explorer' && <FileTree />}
        {activeSidebarTab === 'search' && <SearchPanel />}
        {activeSidebarTab === 'workflows' && <WorkflowsPanel />}
        {activeSidebarTab === 'skills' && <SkillsPanel />}
        {activeSidebarTab === 'mcp' && <McpManager />}
      </div>
      <div
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-[var(--bg-elevated)]/60"
        onPointerDown={handlePointerDown}
        title="Drag to resize sidebar"
      />
    </div>
  );
}
