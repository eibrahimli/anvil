import { useState, useEffect, useRef } from 'react';
import { useSettingsStore, PermissionAction, PermissionRule, PermissionConfig, ToolPermission, PermissionValue } from '../../stores/settings';
import clsx from 'clsx';
import { Shield, Terminal, FileEdit, FileText, File, Plus, Trash2, ChevronDown, ChevronRight, Save, RotateCw, Brain } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../../store';

type ToolKey = keyof PermissionConfig;

export function PermissionsSettings() {
    const { permissions, setPermissions } = useSettingsStore();
    const workspacePath = useStore((state) => state.workspacePath);
    const [expandedTool, setExpandedTool] = useState<ToolKey | null>(null);
    const [cwd, setCwd] = useState<string>('.');
    const [isLoading, setIsLoading] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [saveTone, setSaveTone] = useState<'success' | 'error' | null>(null);
    const saveTimeoutRef = useRef<number | null>(null);
    
    useEffect(() => {
        if (workspacePath) {
            setCwd(workspacePath);
            return;
        }
        invoke<string>('get_cwd').then((path) => setCwd(path)).catch(console.error);
    }, [workspacePath]);

    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                window.clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

    const setTransientSaveMessage = (message: string, tone: 'success' | 'error') => {
        setSaveMessage(message);
        setSaveTone(tone);
        if (saveTimeoutRef.current) {
            window.clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = window.setTimeout(() => {
            setSaveMessage(null);
            setSaveTone(null);
        }, 2500);
    };

    const defaultPermissions: Record<ToolKey, ToolPermission> = {
        read: { default: 'ask', rules: [] },
        write: { default: 'ask', rules: [] },
        edit: { default: 'ask', rules: [] },
        bash: { default: 'ask', rules: [] },
        skill: { default: 'allow', rules: [] }
    };

    const normalizePermission = (value: PermissionValue | undefined, key: ToolKey): ToolPermission => {
        if (!value) {
            return { ...defaultPermissions[key] };
        }
        if (typeof value === 'string') {
            return { default: value, rules: [] };
        }
        return {
            default: value.default ?? defaultPermissions[key].default,
            rules: Array.isArray(value.rules) ? value.rules : []
        };
    };

    const normalizeConfig = (config?: PermissionConfig): PermissionConfig => ({
        read: normalizePermission(config?.read ?? permissions.read, 'read'),
        write: normalizePermission(config?.write ?? permissions.write, 'write'),
        edit: normalizePermission(config?.edit ?? permissions.edit, 'edit'),
        bash: normalizePermission(config?.bash ?? permissions.bash, 'bash'),
        skill: normalizePermission(config?.skill ?? permissions.skill, 'skill')
    });

    const handleLoad = async () => {
        const targetPath = workspacePath || cwd;
        setIsLoading(true);
        try {
            const config = await invoke<PermissionConfig>('load_permission_config', { workspacePath: targetPath });
            if (config) {
                // Ensure all keys exist (merge with defaults if missing)
                setPermissions(normalizeConfig({ ...permissions, ...config }));
            }
        } catch (err) {
            console.error("Failed to load permissions:", err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        const targetPath = workspacePath || cwd;
        setIsLoading(true);
        try {
            await invoke('save_permission_config', { workspacePath: targetPath, config: normalizeConfig(permissions) });
            setTransientSaveMessage('Permissions saved', 'success');
        } catch (err) {
            console.error("Failed to save permissions:", err);
            alert("Failed to save permissions to .anvil/anvil.json");
            setTransientSaveMessage('Save failed', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const getNormalizedPermission = (key: ToolKey) => {
        return normalizePermission(permissions[key], key);
    };

    const updateDefault = (key: ToolKey, action: PermissionAction) => {
        const current = getNormalizedPermission(key);
        setPermissions({
            ...permissions,
            [key]: {
                ...current,
                default: action
            }
        });
    };

    const addRule = (key: ToolKey) => {
        const current = getNormalizedPermission(key);
        const newRule: PermissionRule = { pattern: '', action: 'ask' };
        setPermissions({
            ...permissions,
            [key]: {
                ...current,
                rules: [...current.rules, newRule]
            }
        });
        setExpandedTool(key);
    };

    const updateRule = (toolKey: ToolKey, index: number, field: keyof PermissionRule, value: string) => {
        const current = getNormalizedPermission(toolKey);
        const rules = [...current.rules];
        rules[index] = { ...rules[index], [field]: value };
        setPermissions({
            ...permissions,
            [toolKey]: {
                ...current,
                rules
            }
        });
    };

    const deleteRule = (toolKey: ToolKey, index: number) => {
        const current = getNormalizedPermission(toolKey);
        const rules = current.rules.filter((_, i) => i !== index);
        setPermissions({
            ...permissions,
            [toolKey]: {
                ...current,
                rules
            }
        });
    };

    const tools: Array<{ key: ToolKey; label: string; icon: LucideIcon; desc: string }> = [
        { key: 'read', label: 'Read Files', icon: FileText, desc: 'Reading file contents' },
        { key: 'write', label: 'Write Files', icon: File, desc: 'Creating new files' },
        { key: 'edit', label: 'Edit Files', icon: FileEdit, desc: 'Modifying existing files' },
        { key: 'bash', label: 'Terminal', icon: Terminal, desc: 'Executing shell commands' },
        { key: 'skill', label: 'Skills', icon: Brain, desc: 'Using AI skills/tools' },
    ];

    return (
        <div className="space-y-6 h-full flex flex-col">
            <div className="bg-[var(--bg-elevated)]/30 border border-[var(--border)] rounded-xl p-4 flex gap-3 text-sm text-zinc-400">
                <Shield className="shrink-0 text-[var(--accent)]" size={20} />
                <p>
                    Control granular permissions for the agent. Rules are evaluated top-down. 
                    <span className="text-zinc-200 font-bold"> "Ask"</span> is recommended for most operations.
                </p>
            </div>

            <div className="flex-1 overflow-auto space-y-4 pr-2">
                {tools.map((item) => {
                    const permission = getNormalizedPermission(item.key);
                    const isExpanded = expandedTool === item.key;

                    return (
                        <div key={item.key} className="bg-[var(--bg-base)] border border-[var(--border)] rounded-xl overflow-hidden transition-all">
                            <div className="flex items-center justify-between p-4">
                                <div 
                                    className="flex items-center gap-4 cursor-pointer flex-1"
                                    onClick={() => setExpandedTool(isExpanded ? null : item.key)}
                                >
                                    <div className="w-10 h-10 rounded-lg bg-[var(--bg-elevated)] flex items-center justify-center text-zinc-400">
                                        <item.icon size={20} />
                                    </div>
                                    <div>
                                        <div className="font-bold text-zinc-200">{item.label}</div>
                                        <div className="text-xs text-zinc-500">{item.desc}</div>
                                    </div>
                                    <div className="ml-2 text-zinc-600">
                                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    </div>
                                </div>

                                <div className="flex bg-[var(--bg-elevated)] rounded-lg p-1 border border-[var(--border)]">
                                    {(['allow', 'ask', 'deny'] as PermissionAction[]).map((action) => (
                                        <button
                                            key={action}
                                            onClick={() => updateDefault(item.key as ToolKey, action)}
                                            className={clsx(
                                                "px-3 py-1.5 rounded-md text-xs font-bold capitalize transition-all",
                                                permission.default === action
                                                    ? action === 'allow' ? "bg-green-500/20 text-green-500 shadow-sm" :
                                                      action === 'deny' ? "bg-red-500/20 text-red-500 shadow-sm" :
                                                      "bg-[var(--accent)] text-white shadow-sm"
                                                    : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                                            )}
                                        >
                                            {action}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {isExpanded && (
                                <div className="border-t border-[var(--border)] bg-[var(--bg-elevated)]/20 p-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
                                    <div className="flex items-center justify-between text-xs text-zinc-500 uppercase tracking-widest font-bold mb-2">
                                        <span>Exception Rules</span>
                                        <button 
                                            onClick={() => addRule(item.key)}
                                            className="flex items-center gap-1 text-[var(--accent)] hover:text-white transition-colors"
                                        >
                                            <Plus size={12} /> Add Rule
                                        </button>
                                    </div>

                                    {permission.rules.length === 0 ? (
                                        <div className="text-center py-4 text-zinc-600 text-sm italic">
                                            No exception rules defined. Default action applies to all matches.
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {permission.rules.map((rule, idx) => (
                                                <div key={idx} className="flex items-center gap-2">
                                                    <input 
                                                        className="flex-1 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-[var(--accent)] font-mono"
                                                        placeholder={item.key === 'bash' ? 'command (e.g., git *)' : '*.ts or src/secrets/*'}
                                                        value={rule.pattern}
                                                        onChange={(e) => updateRule(item.key, idx, 'pattern', e.target.value)}
                                                    />
                                                    <div className="relative">
                                                        <select
                                                            className="appearance-none bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border)] rounded-lg pl-3 pr-8 py-2 text-sm outline-none focus:border-[var(--accent)]"
                                                            style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
                                                            value={rule.action}
                                                            onChange={(e) => updateRule(item.key, idx, 'action', e.target.value as PermissionAction)}
                                                        >
                                                            <option value="allow" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Allow</option>
                                                            <option value="ask" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Ask</option>
                                                            <option value="deny" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Deny</option>
                                                        </select>
                                                        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                                                    </div>
                                                    <button 
                                                        onClick={() => deleteRule(item.key as ToolKey, idx)}
                                                        className="p-2 text-zinc-500 hover:text-red-500 transition-colors"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-[var(--border)]">
                 <button 
                    onClick={handleLoad}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-zinc-400 hover:text-zinc-200 hover:bg-[var(--bg-elevated)] transition-all text-xs font-bold uppercase tracking-wider"
                >
                    <RotateCw size={16} className={clsx(isLoading && "animate-spin")} />
                    Reload
                </button>
                <div className="flex items-center gap-3">
                    {saveMessage && (
                        <span className={clsx(
                            "text-xs font-semibold",
                            saveTone === 'success' ? "text-green-500" : "text-red-500"
                        )}>
                            {saveMessage}
                        </span>
                    )}
                    <button 
                        onClick={handleSave}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-6 py-2 rounded-xl bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 transition-all shadow-lg shadow-purple-900/20 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Save size={16} />
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}
