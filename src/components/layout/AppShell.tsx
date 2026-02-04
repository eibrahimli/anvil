import { ActivityBar } from './ActivityBar';
import { useSettingsStore } from '../../stores/settings';
import { useUIStore } from '../../stores/ui';
import { SettingsModal } from '../settings/SettingsModal';
import { OrchestratorPanel } from '../orchestrator/OrchestratorPanel';
import clsx from 'clsx';

interface AppShellProps {
    children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
    const { theme, fontFamily, fontSize } = useSettingsStore();
    const { isSettingsOpen, isOrchestratorOpen, setOrchestratorOpen } = useUIStore();

    return (
        <div
            data-theme={theme}
            className={clsx(
                "h-screen w-screen flex overflow-hidden transition-colors duration-300",
                "bg-[var(--bg-base)] text-[var(--text-primary)]"
            )}
            style={{
                fontFamily: fontFamily,
                fontSize: `${fontSize}px`
            }}
        >
            <ActivityBar />
            {/* Main content wrapper: Holds FileTree/Chat/Editor */}
            <div className="flex-1 flex min-w-0 bg-transparent overflow-hidden">
                {children}
            </div>

            {isSettingsOpen && <SettingsModal />}
            
            {isOrchestratorOpen && (
                <OrchestratorPanel
                    onClose={() => setOrchestratorOpen(false)}
                />
            )}
        </div>
    );
}
