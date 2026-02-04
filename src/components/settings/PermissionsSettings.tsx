import { useState, useEffect } from 'react';
import { useSettingsStore, PermissionAction, PermissionRule, PermissionConfig } from '../../stores/settings';
import clsx from 'clsx';
import { Shield, Terminal, FileEdit, FileText, File, Plus, Trash2, ChevronDown, ChevronRight, Save, RotateCw, Brain } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

type ToolKey = keyof PermissionConfig;

export function PermissionsSettings() {
    const { permissions, setPermissions } = useSettingsStore();
    const [expandedTool, setExpandedTool] = useState<ToolKey | null>(null);
    const [cwd, setCwd] = useState<string>('.');
    const [isLoading, setIsLoading] = useState(false);
    
    useEffect(() => {
        invoke('get_cwd').then((path: any) => setCwd(path)).catch(console.error);
    }, []);

    const handleLoad = async () => {
        setIsLoading(true);
        try {
            const config = await invoke<PermissionConfig>('load_permission_config', { workspacePath: cwd });
            if (config) {
                // Ensure all keys exist (merge with defaults if missing)
                const merged = { ...permissions, ...config };
                setPermissions(merged);
            }
        } catch (err) {
            console.error("Failed to load permissions:", err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        setIsLoading(true);
        try {
            await invoke('save_permission_config', { workspacePath: cwd, config: permissions });
        } catch (err) {
            console.error("Failed to save permissions:", err);
            alert("Failed to save permissions to .anvil/anvil.json");
        } finally {
            setIsLoading(false);
        }
    };

    const getNormalizedPermission = (key: ToolKey) => {
        const current = permissions[key];
        if (typeof current === 'string') {
            return { default: current as PermissionAction, rules: [] };
        }
        if (!current) {
            return { default: 'ask', rules: [] };
        }
        // Use type assertion to ensure rules property access is valid in case of legacy/partial types
        const typedCurrent = current as any;
        if (!typedCurrent.rules) {
            return { ...typedCurrent, rules: [] };
        }
        return typedCurrent;
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
        const rules = current.rules.filter((_: any, i: number) => i !== index);
        setPermissions({
            ...permissions,
            [toolKey]: {
                ...current,
                rules
            }
        });
    };

    const tools = [
        { key: 'read', label: 'Read Files', icon: FileText, desc: 'Reading file contents' },
        { key: 'write', label: 'Write Files', icon: File, desc: 'Creating new files' },
        { key: 'edit', label: 'Edit Files', icon: FileEdit, desc: 'Modifying existing files' },
        { key: 'bash', label: 'Terminal', icon: Terminal, desc: 'Executing shell commands' },
        { key: 'skill', label: 'Skills', icon: Brain, desc: 'Using AI skills/tools' },
    ] as const;

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
                    let permission = permissions[item.key as ToolKey];
                    
                    // Safety check for legacy state (string instead of object)
                    if (typeof permission === 'string') {
                        permission = { default: permission as PermissionAction, rules: [] };
                    }
                    // Safety check for missing/undefined state
                    if (!permission) {
                        permission = { default: 'ask', rules: [] };
                    }
                    // Safety check for missing rules array
                    if (!permission.rules) {
                        permission = { ...permission, rules: [] };
                    }

                    const isExpanded = expandedTool === item.key;

                    return (
                        <div key={item.key} className="bg-[var(--bg-base)] border border-[var(--border)] rounded-xl overflow-hidden transition-all">
                            <div className="flex items-center justify-between p-4">
                                <div 
                                    className="flex items-center gap-4 cursor-pointer flex-1"
                                    onClick={() => setExpandedTool(isExpanded ? null : item.key as ToolKey)}
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
                                            onClick={() => addRule(item.key as ToolKey)}
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
                                                        onChange={(e) => updateRule(item.key as ToolKey, idx, 'pattern', e.target.value)}
                                                    />
                                                    <div className="relative">
                                                        <select
                                                            className="appearance-none bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border)] rounded-lg pl-3 pr-8 py-2 text-sm outline-none focus:border-[var(--accent)]"
                                                            style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
                                                            value={rule.action}
                                                            onChange={(e) => updateRule(item.key as ToolKey, idx, 'action', e.target.value as PermissionAction)}
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
    );
}
