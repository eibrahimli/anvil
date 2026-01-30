import { useUIStore } from '../../stores/ui';
import { FileTree } from '../FileTree';
import clsx from 'clsx';

export function SidePanel() {
    const { activeSidebarTab } = useUIStore();

    if (!activeSidebarTab) return null;

    return (
        <div className={clsx(
            "w-64 bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col h-full transition-all",
            activeSidebarTab ? "block" : "hidden"
        )}>
            <div className="h-10 border-b border-[var(--border)] flex items-center px-4 font-bold text-[var(--text-primary)] uppercase text-xs tracking-wider">
                {activeSidebarTab}
            </div>
            
            <div className="flex-1 overflow-auto">
                {activeSidebarTab === 'explorer' && <FileTree />}
                {activeSidebarTab === 'providers' && (
                    <div className="p-4 text-gray-400 text-sm italic">
                        Configure providers in Settings
                    </div>
                )}
            </div>
        </div>
    );
}
