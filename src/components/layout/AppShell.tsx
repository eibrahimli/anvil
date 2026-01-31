import { ActivityBar } from './ActivityBar';
import { useSettingsStore } from '../../stores/settings';
import { useUIStore } from '../../stores/ui';
import { SettingsModal } from '../settings/SettingsModal';
import { HistoryModal } from '../history/HistoryModal';
import { OrchestratorPanel } from '../orchestrator/OrchestratorPanel';
import { useStore } from '../../store';
import { invoke } from '@tauri-apps/api/core';
import clsx from 'clsx';

interface AppShellProps {
    children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
    const { theme, fontFamily, fontSize } = useSettingsStore();
    const { isSettingsOpen, isHistoryOpen, setHistoryOpen, isOrchestratorOpen, setOrchestratorOpen } = useUIStore();
    const { setSessionId } = useStore();

    const handleReplay = async (sessionToReplayId: string) => {
        try {
            const newSessionId = await invoke<string>('replay_session', { 
                sessionId: sessionToReplayId 
            });
            setSessionId(newSessionId);
            setHistoryOpen(false);
        } catch (error) {
            console.error('Failed to replay session:', error);
            alert('Failed to replay session. Please try again.');
        }
    };

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
            {isHistoryOpen && (
                <HistoryModal
                    onClose={() => setHistoryOpen(false)}
                    onReplay={handleReplay}
                />
            )}
            {isOrchestratorOpen && (
                <OrchestratorPanel
                    onClose={() => setOrchestratorOpen(false)}
                />
            )}
        </div>
    );
}
