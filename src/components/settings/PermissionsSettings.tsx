import { useState, useEffect, useRef } from 'react';
import { useSettingsStore, PermissionAction, PermissionRule, PermissionConfig, ToolPermission, PermissionValue } from '../../stores/settings';
import clsx from 'clsx';
import { Shield, Terminal, FileEdit, FileText, File, Plus, Trash2, ChevronDown, ChevronRight, Save, RotateCw, Brain, Search, Globe, ListChecks, Workflow, Repeat } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../../store';

const TOOL_KEYS = [
    'read',
    'write',
    'edit',
    'bash',
    'skill',
    'list',
    'glob',
    'grep',
    'webfetch',
    'task',
    'lsp',
    'todoread',
    'todowrite',
    'doom_loop'
] as const;

type ToolKey = typeof TOOL_KEYS[number];
const RESERVED_PERMISSION_KEYS = new Set<string>([...TOOL_KEYS, 'external_directory', '*']);

const isToolKey = (value: string): value is ToolKey => {
    return TOOL_KEYS.includes(value as ToolKey);
};

export function PermissionsSettings() {
    const { permissions, setPermissions } = useSettingsStore();
    const workspacePath = useStore((state) => state.workspacePath);
    const [expandedTool, setExpandedTool] = useState<string | null>(null);
    const [cwd, setCwd] = useState<string>('.');
    const [simulatorTool, setSimulatorTool] = useState<string>('bash');
    const [simulatorInput, setSimulatorInput] = useState('');
    const [newCustomToolKey, setNewCustomToolKey] = useState('');
    const [baselinePermissions, setBaselinePermissions] = useState<PermissionConfig | null>(null);
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
        read: { default: 'allow', rules: [] },
        write: { default: 'allow', rules: [] },
        edit: { default: 'allow', rules: [] },
        bash: { default: 'allow', rules: [] },
        skill: { default: 'allow', rules: [] },
        list: { default: 'allow', rules: [] },
        glob: { default: 'allow', rules: [] },
        grep: { default: 'allow', rules: [] },
        webfetch: { default: 'allow', rules: [] },
        task: { default: 'allow', rules: [] },
        lsp: { default: 'allow', rules: [] },
        todoread: { default: 'allow', rules: [] },
        todowrite: { default: 'allow', rules: [] },
        doom_loop: { default: 'ask', rules: [] },
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

    const normalizeDynamicPermission = (value: unknown): ToolPermission | null => {
        if (typeof value === 'string') {
            if (value === 'allow' || value === 'ask' || value === 'deny') {
                return { default: value, rules: [] };
            }
            return null;
        }
        if (!value || typeof value !== 'object') {
            return null;
        }

        const candidate = value as Partial<ToolPermission>;
        const defaultAction =
            candidate.default === 'allow' || candidate.default === 'ask' || candidate.default === 'deny'
                ? candidate.default
                : 'ask';
        const rules = Array.isArray(candidate.rules) ? candidate.rules : [];
        return {
            default: defaultAction,
            rules
        };
    };

    const extractDynamicPermissions = (config: PermissionConfig): Record<string, ToolPermission> => {
        const dynamic: Record<string, ToolPermission> = {};
        Object.entries(config).forEach(([key, value]) => {
            if (RESERVED_PERMISSION_KEYS.has(key)) {
                return;
            }
            const normalized = normalizeDynamicPermission(value);
            if (normalized) {
                dynamic[key] = normalized;
            }
        });
        return dynamic;
    };

    const normalizeConfig = (config?: PermissionConfig): PermissionConfig => {
        const source = config ?? permissions;
        const normalized: PermissionConfig = {
            read: normalizePermission(source.read, 'read'),
            write: normalizePermission(source.write, 'write'),
            edit: normalizePermission(source.edit, 'edit'),
            bash: normalizePermission(source.bash, 'bash'),
            skill: normalizePermission(source.skill, 'skill'),
            list: normalizePermission(source.list, 'list'),
            glob: normalizePermission(source.glob, 'glob'),
            grep: normalizePermission(source.grep, 'grep'),
            webfetch: normalizePermission(source.webfetch, 'webfetch'),
            task: normalizePermission(source.task, 'task'),
            lsp: normalizePermission(source.lsp, 'lsp'),
            todoread: normalizePermission(source.todoread, 'todoread'),
            todowrite: normalizePermission(source.todowrite, 'todowrite'),
            doom_loop: normalizePermission(source.doom_loop, 'doom_loop'),
            external_directory: source.external_directory
        };

        if (source['*'] === 'allow' || source['*'] === 'ask' || source['*'] === 'deny') {
            normalized['*'] = source['*'];
        }

        return {
            ...normalized,
            ...extractDynamicPermissions(source)
        };
    };

    useEffect(() => {
        if (baselinePermissions) return;
        setBaselinePermissions(normalizeConfig(permissions));
    }, [baselinePermissions, permissions]);

    const handleLoad = async () => {
        const targetPath = workspacePath || cwd;
        setIsLoading(true);
        try {
            const config = await invoke<PermissionConfig>('load_permission_config', { workspacePath: targetPath });
            if (config) {
                // Ensure all keys exist (merge with defaults if missing)
                const merged = normalizeConfig({ ...permissions, ...config });
                setPermissions(merged);
                setBaselinePermissions(merged);
                setTransientSaveMessage('Permissions loaded', 'success');
            }
        } catch (err) {
            console.error("Failed to load permissions:", err);
            setTransientSaveMessage(`Load failed: ${String(err)}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        const targetPath = workspacePath || cwd;
        const normalized = normalizeConfig(permissions);
        setIsLoading(true);
        try {
            await invoke('save_permission_config', { workspacePath: targetPath, config: normalized });
            setBaselinePermissions(normalized);
            setTransientSaveMessage('Permissions saved', 'success');
        } catch (err) {
            console.error("Failed to save permissions:", err);
            setTransientSaveMessage(`Save failed: ${String(err)}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const getNormalizedPermission = (key: ToolKey) => {
        return normalizePermission(permissions[key], key);
    };

    const getGlobalFallbackAction = (): PermissionAction => {
        const global = permissions['*'];
        if (global === 'allow' || global === 'ask' || global === 'deny') {
            return global;
        }
        return 'ask';
    };

    const getNormalizedPermissionByKey = (key: string): ToolPermission => {
        if (isToolKey(key)) {
            return getNormalizedPermission(key);
        }
        const rawValue = permissions[key];
        const dynamic = normalizeDynamicPermission(rawValue);
        if (dynamic) {
            return dynamic;
        }
        return {
            default: getGlobalFallbackAction(),
            rules: []
        };
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

    const updateGlobalDefault = (action: PermissionAction) => {
        const next = normalizeConfig(permissions);
        next['*'] = action;
        TOOL_KEYS.forEach((toolKey) => {
            const current = normalizePermission(next[toolKey], toolKey);
            next[toolKey] = {
                ...current,
                default: action
            };
        });
        setPermissions(next);
    };

    const updateDynamicDefault = (key: string, action: PermissionAction) => {
        const current = getNormalizedPermissionByKey(key);
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

    const addDynamicRule = (key: string) => {
        const current = getNormalizedPermissionByKey(key);
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

    const updateDynamicRule = (toolKey: string, index: number, field: keyof PermissionRule, value: string) => {
        const current = getNormalizedPermissionByKey(toolKey);
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

    const deleteDynamicRule = (toolKey: string, index: number) => {
        const current = getNormalizedPermissionByKey(toolKey);
        const rules = current.rules.filter((_, i) => i !== index);
        setPermissions({
            ...permissions,
            [toolKey]: {
                ...current,
                rules
            }
        });
    };

    const removeDynamicTool = (toolKey: string) => {
        const next = { ...permissions };
        delete next[toolKey];
        setPermissions(next);
        if (expandedTool === toolKey) {
            setExpandedTool(null);
        }
        if (simulatorTool === toolKey) {
            setSimulatorTool('bash');
        }
    };

    const handleAddCustomTool = () => {
        const key = newCustomToolKey.trim();
        if (!key) {
            setTransientSaveMessage('Enter a custom tool key before adding.', 'error');
            return;
        }
        if (!/^[a-zA-Z0-9_.-]+$/.test(key)) {
            setTransientSaveMessage('Custom tool key can only use letters, numbers, "_", "-", ".".', 'error');
            return;
        }
        if (RESERVED_PERMISSION_KEYS.has(key)) {
            setTransientSaveMessage(`"${key}" is a built-in key and cannot be added as custom.`, 'error');
            return;
        }
        if (permissions[key]) {
            setTransientSaveMessage(`"${key}" already exists.`, 'error');
            return;
        }
        setPermissions({
            ...permissions,
            [key]: {
                default: getGlobalFallbackAction(),
                rules: []
            }
        });
        setNewCustomToolKey('');
        setExpandedTool(key);
        setSimulatorTool(key);
        setTransientSaveMessage(`Added custom tool "${key}".`, 'success');
    };

    const tools: Array<{ key: ToolKey; label: string; icon: LucideIcon; desc: string }> = [
        { key: 'read', label: 'Read Files', icon: FileText, desc: 'Reading file contents' },
        { key: 'write', label: 'Write Files', icon: File, desc: 'Creating new files' },
        { key: 'edit', label: 'Edit Files', icon: FileEdit, desc: 'Modifying existing files' },
        { key: 'bash', label: 'Terminal', icon: Terminal, desc: 'Executing shell commands' },
        { key: 'list', label: 'List', icon: ListChecks, desc: 'Listing files and directories' },
        { key: 'glob', label: 'Glob', icon: Search, desc: 'Finding files by glob pattern' },
        { key: 'grep', label: 'Search', icon: Search, desc: 'Searching content by pattern' },
        { key: 'webfetch', label: 'Web Fetch', icon: Globe, desc: 'Fetching URLs and content' },
        { key: 'task', label: 'Subagents', icon: Workflow, desc: 'Launching subagents and tasks' },
        { key: 'lsp', label: 'LSP', icon: Brain, desc: 'Language server queries' },
        { key: 'todoread', label: 'Todo Read', icon: ListChecks, desc: 'Reading TODO tasks' },
        { key: 'todowrite', label: 'Todo Write', icon: ListChecks, desc: 'Updating TODO tasks' },
        { key: 'doom_loop', label: 'Doom Loop', icon: Repeat, desc: 'Repeated tool call guard' },
        { key: 'skill', label: 'Skills', icon: Brain, desc: 'Using AI skills/tools' },
    ];

    const normalizedCurrentPermissions = normalizeConfig(permissions);
    const normalizedBaselinePermissions = baselinePermissions ? normalizeConfig(baselinePermissions) : normalizedCurrentPermissions;
    const dynamicCurrentPermissions = extractDynamicPermissions(normalizedCurrentPermissions);
    const dynamicBaselinePermissions = extractDynamicPermissions(normalizedBaselinePermissions);
    const dynamicToolKeys = Object.keys(dynamicCurrentPermissions).sort();
    const allSimulatorToolKeys = [...tools.map((tool) => tool.key), ...dynamicToolKeys];

    useEffect(() => {
        if (!allSimulatorToolKeys.includes(simulatorTool)) {
            setSimulatorTool('bash');
        }
    }, [allSimulatorToolKeys.join('|'), simulatorTool]);

    const globalDefaultCurrent = normalizedCurrentPermissions['*'];
    const globalDefaultBaseline = normalizedBaselinePermissions['*'];
    const globalDefaultChanged = globalDefaultCurrent !== globalDefaultBaseline;
    const changedBuiltInTools = tools.filter((tool) => {
        const current = normalizePermission(normalizedCurrentPermissions[tool.key], tool.key);
        const baseline = normalizePermission(normalizedBaselinePermissions[tool.key], tool.key);
        return JSON.stringify(current) !== JSON.stringify(baseline);
    }).map((tool) => {
        const current = normalizePermission(normalizedCurrentPermissions[tool.key], tool.key);
        const baseline = normalizePermission(normalizedBaselinePermissions[tool.key], tool.key);
        return {
            key: tool.key,
            beforeDefault: baseline.default,
            afterDefault: current.default,
            beforeRules: baseline.rules.length,
            afterRules: current.rules.length
        };
    });

    const dynamicDiffKeys = Array.from(new Set([
        ...Object.keys(dynamicCurrentPermissions),
        ...Object.keys(dynamicBaselinePermissions)
    ])).sort();

    const changedDynamicTools = dynamicDiffKeys
        .filter((key) => {
            const current = dynamicCurrentPermissions[key] ?? null;
            const baseline = dynamicBaselinePermissions[key] ?? null;
            return JSON.stringify(current) !== JSON.stringify(baseline);
        })
        .map((key) => {
            const current = dynamicCurrentPermissions[key] ?? null;
            const baseline = dynamicBaselinePermissions[key] ?? null;
            return {
                key,
                beforeDefault: baseline?.default ?? 'unset',
                afterDefault: current?.default ?? 'unset',
                beforeRules: baseline?.rules.length ?? 0,
                afterRules: current?.rules.length ?? 0
            };
        });

    const changedTools = [...changedBuiltInTools, ...changedDynamicTools];
    const totalChanged = changedTools.length + (globalDefaultChanged ? 1 : 0);

    const resetUnsavedChanges = () => {
        if (!baselinePermissions) return;
        setPermissions(normalizeConfig(baselinePermissions));
        setTransientSaveMessage('Unsaved permission changes reverted', 'success');
    };

    const getActionBadgeClass = (action: PermissionAction) => {
        if (action === 'allow') return 'border-green-500/30 bg-green-500/15 text-green-300';
        if (action === 'deny') return 'border-red-500/30 bg-red-500/15 text-red-300';
        return 'border-[var(--accent)]/30 bg-[var(--accent)]/15 text-[var(--accent)]';
    };

    const escapeRegexChar = (char: string) => {
        return char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    };

    const globMatches = (pattern: string, input: string) => {
        let regexPattern = '^';
        for (const char of pattern) {
            if (char === '*') {
                regexPattern += '.*';
                continue;
            }
            if (char === '?') {
                regexPattern += '.';
                continue;
            }
            regexPattern += escapeRegexChar(char);
        }
        regexPattern += '$';
        const regex = new RegExp(regexPattern);
        return regex.test(input);
    };

    const evaluateToolPermission = (permission: ToolPermission, input: string) => {
        let finalAction = permission.default;
        const matchedRules: Array<{ index: number; rule: PermissionRule }> = [];

        permission.rules.forEach((rule, index) => {
            const pattern = rule.pattern.trim();
            if (!pattern) return;
            try {
                if (globMatches(pattern, input)) {
                    finalAction = rule.action;
                    matchedRules.push({ index, rule });
                }
            } catch (_) {
                return;
            }
        });

        return { finalAction, matchedRules };
    };

    const selectedSimToolMeta = tools.find((tool) => tool.key === simulatorTool);
    const simulatorPermission = getNormalizedPermissionByKey(simulatorTool);
    const simulatorEvaluation = simulatorInput.trim()
        ? evaluateToolPermission(simulatorPermission, simulatorInput.trim())
        : null;
    const simulatorPlaceholder = simulatorTool === 'bash'
        ? 'git push origin main'
        : simulatorTool === 'webfetch'
            ? 'https://api.example.com/data'
            : simulatorTool === 'task'
                ? 'delegate: run lint and summarize issues'
                : 'src/components/App.tsx';

    return (
        <div className="space-y-6 h-full flex flex-col">
            <div className="bg-[var(--bg-elevated)]/30 border border-[var(--border)] rounded-xl p-4 flex gap-3 text-sm text-zinc-400">
                <Shield className="shrink-0 text-[var(--accent)]" size={20} />
                <p>
                    Control granular permissions for the agent. Rules are evaluated top-down. 
                    Use <span className="text-zinc-200 font-bold">Allow</span> for trusted operations and <span className="text-zinc-200 font-bold">Ask</span> to require confirmation.
                </p>
            </div>

            <div className="bg-[var(--bg-elevated)]/30 border border-[var(--border)] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-xs uppercase tracking-wider text-zinc-400 font-bold">Global Tool Policy</div>
                    <div className="text-[10px] text-zinc-500">Applies to all tools, including dynamic MCP tools.</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {(['allow', 'ask', 'deny'] as PermissionAction[]).map((action) => (
                        <button
                            key={`global-${action}`}
                            onClick={() => updateGlobalDefault(action)}
                            aria-label={`global-${action}`}
                            className={clsx(
                                "px-3 py-1.5 rounded-md text-xs font-bold capitalize transition-all border",
                                globalDefaultCurrent === action
                                    ? action === 'allow'
                                        ? "border-green-500/40 bg-green-500/20 text-green-400 shadow-sm"
                                        : action === 'deny'
                                            ? "border-red-500/40 bg-red-500/20 text-red-400 shadow-sm"
                                            : "border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--accent)] shadow-sm"
                                    : "border-[var(--border)] text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                            )}
                        >
                            {action}
                        </button>
                    ))}
                    <span className="text-[11px] text-zinc-500">
                        Current: <span className="text-zinc-300">{globalDefaultCurrent ?? 'unset'}</span>
                    </span>
                </div>
            </div>

            <div className="bg-[var(--bg-elevated)]/30 border border-[var(--border)] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-xs uppercase tracking-wider text-zinc-400 font-bold">Permission Simulator</div>
                    <div className="text-[10px] text-zinc-500">Rules run top-down. Last match wins.</div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-3">
                    <div>
                        <label className="text-[10px] uppercase tracking-wider text-zinc-500">Tool</label>
                        <div className="relative mt-1">
                            <select
                                className="appearance-none w-full bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border)] rounded-lg pl-3 pr-8 py-2 text-sm outline-none focus:border-[var(--accent)]"
                                style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
                                value={simulatorTool}
                                onChange={(e) => setSimulatorTool(e.target.value)}
                            >
                                {tools.map((tool) => (
                                    <option
                                        key={tool.key}
                                        value={tool.key}
                                        style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
                                    >
                                        {tool.key}
                                    </option>
                                ))}
                                {dynamicToolKeys.map((toolKey) => (
                                    <option
                                        key={toolKey}
                                        value={toolKey}
                                        style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
                                    >
                                        {toolKey}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-wider text-zinc-500">Sample Input</label>
                        <input
                            value={simulatorInput}
                            onChange={(e) => setSimulatorInput(e.target.value)}
                            placeholder={simulatorPlaceholder}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-zinc-200 outline-none focus:border-[var(--accent)] font-mono"
                        />
                    </div>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="text-xs text-zinc-400">
                            {selectedSimToolMeta?.desc || 'Selected tool'} • default: <span className="text-zinc-200">{simulatorPermission.default}</span>
                        </div>
                        {simulatorEvaluation ? (
                            <span className={clsx(
                                "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
                                getActionBadgeClass(simulatorEvaluation.finalAction)
                            )}>
                                {simulatorEvaluation.finalAction}
                            </span>
                        ) : (
                            <span className="text-[10px] text-zinc-500">Enter input to evaluate</span>
                        )}
                    </div>
                    {simulatorEvaluation && (
                        simulatorEvaluation.matchedRules.length === 0 ? (
                            <div className="text-xs text-zinc-500">
                                No rule matched. The default action applies.
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {simulatorEvaluation.matchedRules.map(({ index, rule }, matchIdx) => {
                                    const isEffective = matchIdx === simulatorEvaluation.matchedRules.length - 1;
                                    return (
                                        <div
                                            key={`${rule.pattern}-${index}-${matchIdx}`}
                                            className={clsx(
                                                "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5",
                                                isEffective
                                                    ? "border-[var(--accent)]/40 bg-[var(--accent)]/10"
                                                    : "border-[var(--border)] bg-[var(--bg-surface)]"
                                            )}
                                        >
                                            <div className="text-[11px] text-zinc-300 font-mono truncate">
                                                #{index + 1} {rule.pattern}
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {isEffective && (
                                                    <span className="text-[10px] uppercase tracking-wider text-[var(--accent)]">effective</span>
                                                )}
                                                <span className={clsx(
                                                    "rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                                                    getActionBadgeClass(rule.action)
                                                )}>
                                                    {rule.action}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    )}
                </div>
            </div>

            <div className="bg-[var(--bg-elevated)]/30 border border-[var(--border)] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-xs uppercase tracking-wider text-zinc-400 font-bold">Save Diff Preview</div>
                    <div className="text-[10px] text-zinc-500">{totalChanged} change{totalChanged === 1 ? '' : 's'}</div>
                </div>
                {totalChanged === 0 ? (
                    <div className="text-xs text-zinc-500">No unsaved permission changes.</div>
                ) : (
                    <div className="space-y-1.5">
                        {globalDefaultChanged && (
                            <div className="rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-2 text-[11px] text-zinc-300 font-mono">
                                <span className="text-zinc-400">*</span>
                                <span className="mx-2 text-zinc-600">|</span>
                                <span>global {globalDefaultBaseline ?? 'unset'} → {globalDefaultCurrent ?? 'unset'}</span>
                            </div>
                        )}
                        {changedTools.map((item) => (
                            <div key={item.key} className="rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-2 text-[11px] text-zinc-300 font-mono">
                                <span className="text-zinc-400">{item.key}</span>
                                <span className="mx-2 text-zinc-600">|</span>
                                <span>default {item.beforeDefault} → {item.afterDefault}</span>
                                <span className="mx-2 text-zinc-600">|</span>
                                <span>rules {item.beforeRules} → {item.afterRules}</span>
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex justify-end">
                    <button
                        onClick={resetUnsavedChanges}
                        disabled={totalChanged === 0 || isLoading}
                        className={clsx(
                            "px-3 py-1.5 rounded-lg border text-[11px] uppercase tracking-wider transition-colors",
                            totalChanged === 0 || isLoading
                                ? "border-[var(--border)] text-zinc-600 cursor-not-allowed"
                                : "border-[var(--border)] text-zinc-300 hover:text-white hover:bg-zinc-800/60"
                        )}
                    >
                        Reset Changes
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-auto space-y-4 pr-2">
                <div className="bg-[var(--bg-elevated)]/30 border border-[var(--border)] rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="text-xs uppercase tracking-wider text-zinc-400 font-bold">Custom Tool Permissions</div>
                        <div className="text-[10px] text-zinc-500">For dynamic and MCP-defined tools.</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            aria-label="custom-tool-key-input"
                            value={newCustomToolKey}
                            onChange={(e) => setNewCustomToolKey(e.target.value)}
                            placeholder="e.g. mcp_sql, codesearch, websearch"
                            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-zinc-200 outline-none focus:border-[var(--accent)] font-mono"
                        />
                        <button
                            aria-label="add-custom-tool-key"
                            onClick={handleAddCustomTool}
                            className="px-3 py-2 rounded-lg border border-[var(--border)] text-xs font-bold uppercase tracking-wider text-zinc-300 hover:text-white hover:bg-zinc-800/60"
                        >
                            Add Tool
                        </button>
                    </div>
                    {dynamicToolKeys.length === 0 && (
                        <div className="text-xs text-zinc-500">
                            No custom tool keys yet. Add one to define custom permission defaults and rules.
                        </div>
                    )}
                </div>

                {dynamicToolKeys.map((toolKey) => {
                    const permission = getNormalizedPermissionByKey(toolKey);
                    const isExpanded = expandedTool === toolKey;

                    return (
                        <div key={toolKey} className="bg-[var(--bg-base)] border border-[var(--border)] rounded-xl overflow-hidden transition-all">
                            <div className="flex items-center justify-between p-4 gap-3">
                                <div
                                    className="flex items-center gap-4 cursor-pointer flex-1"
                                    onClick={() => setExpandedTool(isExpanded ? null : toolKey)}
                                >
                                    <div className="w-10 h-10 rounded-lg bg-[var(--bg-elevated)] flex items-center justify-center text-zinc-400">
                                        <Shield size={18} />
                                    </div>
                                    <div>
                                        <div className="font-bold text-zinc-200 font-mono">{toolKey}</div>
                                        <div className="text-xs text-zinc-500">Custom or dynamic tool key</div>
                                    </div>
                                    <div className="ml-2 text-zinc-600">
                                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    </div>
                                </div>

                                <button
                                    aria-label={`remove-custom-tool-${toolKey}`}
                                    onClick={() => removeDynamicTool(toolKey)}
                                    className="p-2 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                    title={`Remove ${toolKey}`}
                                >
                                    <Trash2 size={14} />
                                </button>

                                <div className="flex bg-[var(--bg-elevated)] rounded-lg p-1 border border-[var(--border)]">
                                    {(['allow', 'ask', 'deny'] as PermissionAction[]).map((action) => (
                                        <button
                                            key={action}
                                            aria-label={`custom-default-${toolKey}-${action}`}
                                            onClick={() => updateDynamicDefault(toolKey, action)}
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
                                            onClick={() => addDynamicRule(toolKey)}
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
                                                        placeholder="*.ts or src/secrets/*"
                                                        value={rule.pattern}
                                                        onChange={(e) => updateDynamicRule(toolKey, idx, 'pattern', e.target.value)}
                                                    />
                                                    <div className="relative">
                                                        <select
                                                            className="appearance-none bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border)] rounded-lg pl-3 pr-8 py-2 text-sm outline-none focus:border-[var(--accent)]"
                                                            style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
                                                            value={rule.action}
                                                            onChange={(e) => updateDynamicRule(toolKey, idx, 'action', e.target.value as PermissionAction)}
                                                        >
                                                            <option value="allow" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Allow</option>
                                                            <option value="ask" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Ask</option>
                                                            <option value="deny" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Deny</option>
                                                        </select>
                                                        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                                                    </div>
                                                    <button
                                                        onClick={() => deleteDynamicRule(toolKey, idx)}
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
