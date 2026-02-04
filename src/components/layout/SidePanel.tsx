import { useUIStore } from '../../stores/ui';
import { FileTree } from '../FileTree';
import { SearchPanel } from '../SearchPanel';
import { WorkflowsPanel } from '../WorkflowsPanel';
import { SkillsPanel } from '../SkillsPanel';
import { McpManager } from '../mcp/McpManager';
import clsx from 'clsx';

export function SidePanel() {
  const { activeSidebarTab } = useUIStore();

  if (!activeSidebarTab) return null;

  return (
    <div className={clsx(
      "w-80 max-w-[30vw] min-w-[220px] bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col h-full transition-all duration-200 ease-in-out",
      activeSidebarTab ? "block" : "hidden"
    )}>
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
    </div>
  );
}
