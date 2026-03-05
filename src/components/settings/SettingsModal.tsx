import { X, Moon, Keyboard, Box, Cpu, Search, Shield, ChevronDown, Download, Upload, KeyRound, AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useUIStore } from '../../stores/ui';
import { useSettingsStore } from '../../stores/settings';
import { useProviderStore } from '../../stores/provider';
import { useStore } from '../../store';
import { PermissionsSettings } from './PermissionsSettings';
import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';

export function SettingsModal() {
    const { isSettingsOpen, setSettingsOpen, settingsTab, setSettingsTab } = useUIStore();
    const activeTab = settingsTab;

    if (!isSettingsOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center animate-in fade-in duration-300">
            <div className="w-[850px] h-[650px] bg-[var(--bg-surface)] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-[var(--border)] flex overflow-hidden scale-in-center animate-in zoom-in-95 duration-200">
                {/* Sidebar */}
                <div className="w-52 border-r border-[var(--border)] p-3 flex flex-col gap-1 bg-[var(--bg-base)]">
                    <div className="px-4 py-6 font-bold text-zinc-500 text-[10px] uppercase tracking-[0.2em]">User Preferences</div>
                    <TabButton 
                        active={activeTab === 'general'} 
                        onClick={() => setSettingsTab('general')} 
                        icon={<Moon size={18} />} 
                        label="Appearance" 
                    />
                    <TabButton 
                        active={activeTab === 'shortcuts'} 
                        onClick={() => setSettingsTab('shortcuts')} 
                        icon={<Keyboard size={18} />} 
                        label="Shortcuts" 
                    />
                    <div className="px-4 py-4 mt-6 font-bold text-zinc-500 text-[10px] uppercase tracking-[0.2em]">Agent Config</div>
                    <TabButton 
                        active={activeTab === 'providers'} 
                        onClick={() => setSettingsTab('providers')} 
                        icon={<Box size={18} />} 
                        label="Providers" 
                    />
                    <TabButton 
                        active={activeTab === 'models'} 
                        onClick={() => setSettingsTab('models')} 
                        icon={<Cpu size={18} />} 
                        label="Models" 
                    />
                    <TabButton 
                        active={activeTab === 'oauth'} 
                        onClick={() => setSettingsTab('oauth')} 
                        icon={<KeyRound size={18} />} 
                        label="OAuth" 
                    />
                    <TabButton 
                        active={activeTab === 'permissions'} 
                        onClick={() => setSettingsTab('permissions')} 
                        icon={<Shield size={18} />} 
                        label="Permissions" 
                    />
                    <TabButton 
                        active={activeTab === 'diagnostics'} 
                        onClick={() => setSettingsTab('diagnostics')} 
                        icon={<Search size={18} />} 
                        label="Diagnostics" 
                    />
                </div>

                {/* Content */}
                <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg-surface)]">
                    <div className="h-16 border-b border-[var(--border)] flex items-center justify-between px-8 bg-[var(--bg-surface)]/50">
                        <h2 className="font-bold text-lg tracking-tight text-zinc-100">{activeTab.toUpperCase()}</h2>
                        <button 
                            onClick={() => setSettingsOpen(false)}
                            className="p-2 hover:bg-[var(--bg-elevated)] rounded-full transition-all text-zinc-400 hover:text-white"
                        >
                            <X size={20} />
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-auto p-8">
                        {activeTab === 'general' && <GeneralSettings />}
                        {activeTab === 'shortcuts' && <ShortcutSettings />}
                        {activeTab === 'providers' && <ProviderSettings />}
                        {activeTab === 'models' && <ModelSettings />}
                        {activeTab === 'oauth' && <OAuthSettings />}
                        {activeTab === 'permissions' && <PermissionsSettings />}
                        {activeTab === 'diagnostics' && <SettingsDiagnostics />}
                    </div>
                </div>
            </div>
        </div>
    );
}

type DiagnosticStatus = 'ok' | 'warn' | 'error';

interface DiagnosticItem {
    id: string;
    label: string;
    status: DiagnosticStatus;
    detail: string;
}

function SettingsDiagnostics() {
    const { workspacePath } = useStore();
    const { apiKeys, activeProviderId, activeModelId, openaiAuthMethod } = useProviderStore();
    const [items, setItems] = useState<DiagnosticItem[]>([]);
    const [running, setRunning] = useState(false);
    const [lastRunAt, setLastRunAt] = useState<string | null>(null);

    const runDiagnostics = async () => {
        setRunning(true);
        const next: DiagnosticItem[] = [];

        let effectiveWorkspace = workspacePath || "";
        if (!effectiveWorkspace) {
            try {
                effectiveWorkspace = await invoke<string>("get_cwd");
            } catch (_) {
                effectiveWorkspace = "";
            }
        }

        if (workspacePath) {
            next.push({
                id: "workspace",
                label: "Workspace",
                status: "ok",
                detail: workspacePath
            });
        } else {
            next.push({
                id: "workspace",
                label: "Workspace",
                status: "warn",
                detail: "No workspace selected. Falling back to current working directory."
            });
        }

        if (effectiveWorkspace) {
            const localConfigPath = `${effectiveWorkspace.replace(/\/$/, "")}/.anvil/anvil.json`;
            try {
                const content = await invoke<string>("read_file", { path: localConfigPath });
                JSON.parse(content);
                next.push({
                    id: "local-config",
                    label: "Local anvil.json",
                    status: "ok",
                    detail: localConfigPath
                });
            } catch (error) {
                next.push({
                    id: "local-config",
                    label: "Local anvil.json",
                    status: "warn",
                    detail: `Missing or invalid file at ${localConfigPath}: ${String(error)}`
                });
            }

            try {
                await invoke("load_permission_config", { workspacePath: effectiveWorkspace });
                next.push({
                    id: "permissions-parse",
                    label: "Permission Schema",
                    status: "ok",
                    detail: "Permission config parsed successfully."
                });
            } catch (error) {
                next.push({
                    id: "permissions-parse",
                    label: "Permission Schema",
                    status: "error",
                    detail: String(error)
                });
            }
        } else {
            next.push({
                id: "local-config",
                label: "Local anvil.json",
                status: "error",
                detail: "Could not resolve a workspace or current directory."
            });
        }

        let oauthStatus: Record<string, { connected: boolean }> = {};
        try {
            oauthStatus = await invoke<Record<string, { connected: boolean }>>("oauth_token_status");
            const connectedProviders = Object.entries(oauthStatus)
                .filter(([, value]) => value?.connected)
                .map(([providerId]) => providerId);

            next.push({
                id: "oauth-status",
                label: "OAuth Tokens",
                status: "ok",
                detail: connectedProviders.length > 0
                    ? `Connected: ${connectedProviders.join(", ")}`
                    : "No OAuth providers currently connected."
            });
        } catch (error) {
            next.push({
                id: "oauth-status",
                label: "OAuth Tokens",
                status: "error",
                detail: `Failed to read OAuth token status: ${String(error)}`
            });
        }

        try {
            const configDir = await invoke<string>("get_config_dir");
            const oauthPath = `${configDir.replace(/\/$/, "")}/oauth.json`;
            const oauthRaw = await invoke<string>("read_file", { path: oauthPath });
            JSON.parse(oauthRaw);
            next.push({
                id: "oauth-config",
                label: "OAuth Config",
                status: "ok",
                detail: oauthPath
            });
        } catch (error) {
            next.push({
                id: "oauth-config",
                label: "OAuth Config",
                status: "warn",
                detail: `Missing or invalid oauth.json: ${String(error)}`
            });
        }

        const openaiConnected = openaiAuthMethod === "oauth"
            ? Boolean(oauthStatus.chatgpt?.connected)
            : Boolean(apiKeys.openai && apiKeys.openai.trim());

        next.push({
            id: "openai-auth",
            label: "OpenAI Credential",
            status: openaiConnected ? "ok" : "warn",
            detail: openaiConnected
                ? `Configured using ${openaiAuthMethod === "oauth" ? "OAuth" : "API key"}.`
                : `OpenAI is set to ${openaiAuthMethod === "oauth" ? "OAuth" : "API key"} but no active credential was found.`
        });

        const activeProviderConnected = activeProviderId === "ollama"
            ? true
            : activeProviderId === "openai"
            ? openaiConnected
            : Boolean(apiKeys[activeProviderId] && apiKeys[activeProviderId].trim());

        next.push({
            id: "active-provider",
            label: "Active Provider",
            status: activeProviderConnected ? "ok" : "warn",
            detail: `${activeProviderId} / ${activeModelId}${activeProviderConnected ? "" : " (missing credentials)"}`
        });

        setItems(next);
        setLastRunAt(new Date().toLocaleTimeString());
        setRunning(false);
    };

    useEffect(() => {
        void runDiagnostics();
    }, [workspacePath, activeProviderId, activeModelId, openaiAuthMethod]);

    const statusIcon = (status: DiagnosticStatus) => {
        if (status === "ok") return <CheckCircle2 size={16} className="text-green-400" />;
        if (status === "warn") return <AlertTriangle size={16} className="text-yellow-400" />;
        return <XCircle size={16} className="text-red-400" />;
    };

    const statusBorder = (status: DiagnosticStatus) => {
        if (status === "ok") return "border-green-500/30 bg-green-500/5";
        if (status === "warn") return "border-yellow-500/30 bg-yellow-500/5";
        return "border-red-500/30 bg-red-500/5";
    };

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-base)] p-4 flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-bold text-zinc-200">Settings Diagnostics</h3>
                    <p className="text-[11px] text-zinc-500">
                        Checks config parse health, OAuth setup, and active provider readiness.
                    </p>
                    {lastRunAt && (
                        <p className="text-[10px] text-zinc-600 mt-1">Last run: {lastRunAt}</p>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => {
                        void runDiagnostics();
                    }}
                    disabled={running}
                    className={clsx(
                        "px-3 py-1.5 rounded-lg border border-[var(--border)] text-[11px] uppercase tracking-wider flex items-center gap-2",
                        running ? "text-zinc-500" : "text-zinc-300 hover:text-white"
                    )}
                >
                    <RefreshCw size={14} className={clsx(running && "animate-spin")} />
                    Run Checks
                </button>
            </div>

            <div className="space-y-3">
                {items.map((item) => (
                    <div
                        key={item.id}
                        className={clsx(
                            "rounded-xl border px-3 py-3",
                            statusBorder(item.status)
                        )}
                    >
                        <div className="flex items-center gap-2">
                            {statusIcon(item.status)}
                            <span className="text-xs font-semibold text-zinc-200">{item.label}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-zinc-400 break-all">{item.detail}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

type OAuthProviderConfig = {
    id: string;
    displayName: string;
    flow?: 'device' | 'pkce';
    clientId: string;
    deviceAuthorizationEndpoint?: string;
    authorizationEndpoint?: string;
    tokenEndpoint: string;
    redirectUri?: string;
    scope?: string;
    scopes?: string[];
    audience?: string;
    extraParams?: Record<string, string>;
};

type OAuthDeviceResponse = {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
    message?: string;
};

type OAuthTokenResponse = {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
};

type OAuthPkceStartResponse = {
    requestId: string;
    authorizationUrl: string;
};

type OAuthTokenStatus = {
    connected: boolean;
    expiresAt?: number;
    hasRefresh?: boolean;
};

function OAuthSettings() {
    const [configStatus, setConfigStatus] = useState<string | null>(null);
    const [tokenStatus, setTokenStatus] = useState<string | null>(null);
    const [config, setConfig] = useState<Record<string, OAuthProviderConfig>>({});
    const [tokens, setTokens] = useState<Record<string, OAuthTokenStatus>>({});
    const [configDir, setConfigDir] = useState<string | null>(null);
    const [activeAuth, setActiveAuth] = useState<
        | {
            flow: 'device';
            providerId: string;
            config: OAuthProviderConfig;
            device: OAuthDeviceResponse;
            intervalMs: number;
            error?: string;
        }
        | {
            flow: 'pkce';
            providerId: string;
            config: OAuthProviderConfig;
            requestId: string;
            authorizationUrl: string;
            error?: string;
        }
        | null
    >(null);
    const pollTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        const loadConfigDir = async () => {
            try {
                const path = await invoke<string>("get_config_dir");
                setConfigDir(path);
            } catch (error) {
                console.error("Failed to resolve config dir:", error);
                setConfigDir(null);
                setConfigStatus("Failed to resolve config directory.");
            }
        };
        loadConfigDir();
    }, []);

    const configPath = useMemo(() => {
        if (!configDir) return null;
        return `${configDir.replace(/\/$/, "")}/oauth.json`;
    }, [configDir]);


    const loadConfig = async () => {
        if (!configPath) {
            setConfig({});
            setConfigStatus("Unable to resolve ~/.config/anvil/oauth.json.");
            return;
        }
        try {
            const content = await invoke<string>("read_file", { path: configPath });
            const parsed = JSON.parse(content) as { providers?: Record<string, any> };
            const providers = parsed?.providers ?? {};
            const next: Record<string, OAuthProviderConfig> = {};
                Object.entries(providers).forEach(([id, value]) => {
                    if (!value) return;
                    next[id] = {
                        id,
                        displayName: value.displayName || id,
                        flow: value.flow,
                        clientId: value.clientId,
                        deviceAuthorizationEndpoint: value.deviceAuthorizationEndpoint,
                        authorizationEndpoint: value.authorizationEndpoint,
                        tokenEndpoint: value.tokenEndpoint,
                        redirectUri: value.redirectUri,
                        scope: value.scope,
                        scopes: value.scopes,
                        audience: value.audience,
                        extraParams: value.extraParams
                    };
                });
            setConfig(next);
            setConfigStatus(null);
        } catch (error) {
            console.error("Failed to load oauth.json:", error);
            setConfig({});
            setConfigStatus("Missing ~/.config/anvil/oauth.json. Create a template to get started.");
        }
    };

    useEffect(() => {
        loadConfig();
    }, [configPath]);

    const loadTokenStatus = async () => {
        try {
            const status = await invoke<Record<string, OAuthTokenStatus>>("oauth_token_status");
            setTokens(status || {});
        } catch (error) {
            setTokens({});
        }
    };

    useEffect(() => {
        if (!configDir) {
            setTokens({});
            setTokenStatus(null);
            return;
        }
        loadTokenStatus();
    }, [configDir]);

    useEffect(() => {
        return () => {
            if (pollTimeoutRef.current) {
                window.clearTimeout(pollTimeoutRef.current);
            }
        };
    }, []);

    const providerList = [
        { id: "copilot", label: "GitHub Copilot" },
        { id: "chatgpt", label: "ChatGPT Plus/Pro" }
    ];

    const buildScope = (provider: OAuthProviderConfig) => {
        if (provider.scope) return provider.scope;
        if (provider.scopes && provider.scopes.length > 0) return provider.scopes.join(" ");
        return undefined;
    };

    const stopPolling = () => {
        if (pollTimeoutRef.current) {
            window.clearTimeout(pollTimeoutRef.current);
        }
        pollTimeoutRef.current = null;
    };

    const storeTokens = async (providerId: string, response: OAuthTokenResponse) => {
        if (!response.access_token) return;
        const expiresAt = response.expires_in ? Date.now() + response.expires_in * 1000 : undefined;
        try {
            await invoke("oauth_store_tokens", {
                providerId,
                token: {
                    accessToken: response.access_token,
                    refreshToken: response.refresh_token,
                    expiresIn: response.expires_in,
                    expiresAt,
                    tokenType: response.token_type,
                    scope: response.scope
                }
            });
            await loadTokenStatus();
        } catch (error) {
            console.error("Failed to store oauth token:", error);
            setTokenStatus(`Failed to save tokens: ${String(error)}`);
        }
    };

    const schedulePoll = (providerId: string, providerConfig: OAuthProviderConfig, device: OAuthDeviceResponse, intervalMs: number) => {
        stopPolling();
        pollTimeoutRef.current = window.setTimeout(async () => {
            try {
                const response = await invoke<OAuthTokenResponse>("oauth_device_poll", {
                    config: {
                        clientId: providerConfig.clientId,
                        deviceAuthorizationEndpoint: providerConfig.deviceAuthorizationEndpoint,
                        tokenEndpoint: providerConfig.tokenEndpoint,
                        scope: buildScope(providerConfig),
                        audience: providerConfig.audience
                    },
                    deviceCode: device.device_code
                });

                if (response.access_token) {
                    await storeTokens(providerId, response);
                    setActiveAuth(null);
                    stopPolling();
                    return;
                }

                if (response.error) {
                    if (response.error === "authorization_pending") {
                        schedulePoll(providerId, providerConfig, device, intervalMs);
                        return;
                    }
                    if (response.error === "slow_down") {
                        schedulePoll(providerId, providerConfig, device, intervalMs + 5000);
                        return;
                    }
                    setActiveAuth({
                        flow: 'device',
                        providerId,
                        config: providerConfig,
                        device,
                        intervalMs,
                        error: response.error_description || response.error
                    });
                    stopPolling();
                    return;
                }

                schedulePoll(providerId, providerConfig, device, intervalMs);
            } catch (error) {
                console.error("OAuth polling failed:", error);
                setActiveAuth((prev) => prev ? { ...prev, error: "Polling failed. Try again." } : prev);
                stopPolling();
            }
        }, intervalMs);
    };

    const schedulePkcePoll = (providerId: string, requestId: string) => {
        stopPolling();
        pollTimeoutRef.current = window.setTimeout(async () => {
            try {
                const response = await invoke<OAuthTokenResponse | null>("oauth_pkce_poll", { requestId });
                if (!response) {
                    schedulePkcePoll(providerId, requestId);
                    return;
                }
                if (response.error) {
                    setActiveAuth((prev) => prev && prev.flow === 'pkce'
                        ? { ...prev, error: response.error_description || response.error }
                        : prev);
                    stopPolling();
                    return;
                }
                await storeTokens(providerId, response);
                setActiveAuth(null);
                stopPolling();
            } catch (error) {
                console.error("OAuth PKCE polling failed:", error);
                setActiveAuth((prev) => prev && prev.flow === 'pkce'
                    ? { ...prev, error: "Polling failed. Try again." }
                    : prev);
                stopPolling();
            }
        }, 2000);
    };

    const handleConnect = async (providerId: string) => {
        const providerConfig = config[providerId];
        if (!providerConfig) return;
        setActiveAuth(null);
        setTokenStatus(null);
        try {
            const flow = providerConfig.flow || (providerConfig.authorizationEndpoint ? 'pkce' : 'device');
            if (flow === 'pkce') {
                if (!providerConfig.authorizationEndpoint || !providerConfig.redirectUri) {
                    setTokenStatus("Missing authorization endpoint or redirect URI.");
                    return;
                }
                const response = await invoke<OAuthPkceStartResponse>("oauth_pkce_start", {
                    config: {
                        clientId: providerConfig.clientId,
                        authorizationEndpoint: providerConfig.authorizationEndpoint,
                        tokenEndpoint: providerConfig.tokenEndpoint,
                        redirectUri: providerConfig.redirectUri,
                        scope: buildScope(providerConfig),
                        audience: providerConfig.audience,
                        extraParams: providerConfig.extraParams
                    }
                });
                setActiveAuth({
                    flow: 'pkce',
                    providerId,
                    config: providerConfig,
                    requestId: response.requestId,
                    authorizationUrl: response.authorizationUrl
                });
                await openUrl(response.authorizationUrl);
                schedulePkcePoll(providerId, response.requestId);
                return;
            }

            if (!providerConfig.deviceAuthorizationEndpoint) {
                setTokenStatus("Missing device authorization endpoint.");
                return;
            }
            const device = await invoke<OAuthDeviceResponse>("oauth_device_start", {
                config: {
                    clientId: providerConfig.clientId,
                    deviceAuthorizationEndpoint: providerConfig.deviceAuthorizationEndpoint,
                    tokenEndpoint: providerConfig.tokenEndpoint,
                    scope: buildScope(providerConfig),
                    audience: providerConfig.audience
                }
            });
            const intervalMs = (device.interval ?? 5) * 1000;
            setActiveAuth({ flow: 'device', providerId, config: providerConfig, device, intervalMs });
            schedulePoll(providerId, providerConfig, device, intervalMs);
        } catch (error) {
            console.error("Failed to start OAuth:", error);
            setTokenStatus(`Failed to start OAuth flow: ${String(error)}`);
        }
    };

    const handleDisconnect = async (providerId: string) => {
        if (!tokens[providerId]) return;
        await invoke("oauth_clear_tokens", { providerId });
        await loadTokenStatus();
    };

    const handleCreateTemplate = async () => {
        if (!configDir) return;
        const template = {
            providers: {
                copilot: {
                    displayName: "GitHub Copilot",
                    flow: "device",
                    clientId: "YOUR_GITHUB_OAUTH_CLIENT_ID",
                    deviceAuthorizationEndpoint: "https://github.com/login/device/code",
                    tokenEndpoint: "https://github.com/login/oauth/access_token",
                    scopes: ["read:user"]
                },
                chatgpt: {
                    displayName: "ChatGPT Plus/Pro",
                    flow: "pkce",
                    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
                    authorizationEndpoint: "https://auth.openai.com/oauth/authorize",
                    tokenEndpoint: "https://auth.openai.com/oauth/token",
                    redirectUri: "http://localhost:1455/auth/callback",
                    scopes: ["openid", "profile", "email", "offline_access"],
                    extraParams: {
                        id_token_add_organizations: "true",
                        codex_cli_simplified_flow: "true",
                        originator: "codex_cli_rs"
                    }
                }
            }
        };
        try {
            await invoke("write_global_file", {
                relativePath: "oauth.json",
                content: JSON.stringify(template, null, 2)
            });
            await loadConfig();
            setConfigStatus("Template created. Update .anvil/oauth.json and reload.");
        } catch (error) {
            console.error("Failed to create oauth.json:", error);
            setConfigStatus("Failed to create oauth.json.");
        }
    };

    const resolveConnectionStatus = (providerId: string) => {
        const token = tokens[providerId];
        if (!token?.connected) return "Disconnected";
        if (!token.expiresAt) return "Connected";
        const expiry = token.expiresAt;
        if (Date.now() > expiry) return "Expired";
        return "Connected";
    };

    return (
        <div className="space-y-6">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-base)] p-5">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-bold text-zinc-200">OAuth Connections</h3>
                        <p className="text-[11px] text-zinc-500">Global OAuth config in ~/.config/anvil/oauth.json</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={loadConfig}
                            className="px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-wider border border-[var(--border)] text-zinc-400 hover:text-white hover:border-[var(--accent)]"
                        >
                            Reload
                        </button>
                        <button
                            type="button"
                            onClick={handleCreateTemplate}
                            className="px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-wider border border-[var(--border)] text-zinc-400 hover:text-white hover:border-[var(--accent)]"
                        >
                            Create Template
                        </button>
                    </div>
                </div>
                {configStatus && (
                    <div className="mt-3 text-[11px] text-zinc-500">{configStatus}</div>
                )}
                {tokenStatus && (
                    <div className="mt-2 text-[11px] text-red-400">{tokenStatus}</div>
                )}
            </div>

            <div className="grid grid-cols-1 gap-3">
                {providerList.map((provider) => {
                    const providerConfig = config[provider.id];
                    const flow = providerConfig?.flow || (providerConfig?.authorizationEndpoint ? 'pkce' : 'device');
                    const isDeviceConfigured = Boolean(
                        providerConfig?.clientId &&
                        providerConfig?.deviceAuthorizationEndpoint &&
                        providerConfig?.tokenEndpoint
                    );
                    const isPkceConfigured = Boolean(
                        providerConfig?.clientId &&
                        providerConfig?.authorizationEndpoint &&
                        providerConfig?.tokenEndpoint &&
                        providerConfig?.redirectUri
                    );
                    const isConfigured = flow === 'pkce' ? isPkceConfigured : isDeviceConfigured;
                    const status = resolveConnectionStatus(provider.id);
                    const isActive = activeAuth?.providerId === provider.id;
                    return (
                        <div key={provider.id} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-base)] p-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h4 className="text-sm font-bold text-zinc-200">{providerConfig?.displayName || provider.label}</h4>
                                    <p className="text-[11px] text-zinc-500">Status: {status}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {tokens[provider.id]?.connected && (
                                        <button
                                            type="button"
                                            onClick={() => handleDisconnect(provider.id)}
                                            className="px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-wider border border-red-500/40 text-red-300 hover:text-white"
                                        >
                                            Disconnect
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handleConnect(provider.id)}
                                        disabled={!providerConfig}
                                        className={clsx(
                                            "px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-wider",
                                            providerConfig
                                                ? "bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/25"
                                                : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                                        )}
                                    >
                                        Connect
                                    </button>
                                </div>
                            </div>

                            {!isConfigured && (
                                <div className="mt-3 text-[11px] text-zinc-500">Missing configuration in .anvil/oauth.json.</div>
                            )}

                            {isActive && activeAuth && activeAuth.flow === 'device' && (
                                <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-xs text-zinc-300">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-[10px] text-zinc-500 uppercase tracking-widest">Device Code</div>
                                            <div className="text-lg font-mono text-zinc-100">{activeAuth.device.user_code}</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => openUrl(activeAuth.device.verification_uri_complete || activeAuth.device.verification_uri)}
                                            className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-zinc-300 hover:text-white"
                                        >
                                            Open Login
                                        </button>
                                    </div>
                                    <div className="mt-3 text-[11px] text-zinc-500">
                                        Visit {activeAuth.device.verification_uri} and enter the code above.
                                    </div>
                                    {activeAuth.error && (
                                        <div className="mt-2 text-[11px] text-red-400">{activeAuth.error}</div>
                                    )}
                                    <div className="mt-3 flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                stopPolling();
                                                setActiveAuth(null);
                                            }}
                                            className="px-3 py-1 rounded-lg text-[10px] uppercase tracking-wider text-zinc-400 hover:text-white border border-[var(--border)]"
                                        >
                                            Cancel
                                        </button>
                                        <span className="text-[10px] text-zinc-500">Polling every {Math.round(activeAuth.intervalMs / 1000)}s</span>
                                    </div>
                                </div>
                            )}

                            {isActive && activeAuth && activeAuth.flow === 'pkce' && (
                                <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-xs text-zinc-300">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-[10px] text-zinc-500 uppercase tracking-widest">Authorization</div>
                                            <div className="text-[11px] text-zinc-400">Waiting for callback...</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => openUrl(activeAuth.authorizationUrl)}
                                            className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-zinc-300 hover:text-white"
                                        >
                                            Open Login
                                        </button>
                                    </div>
                                    {activeAuth.error && (
                                        <div className="mt-2 text-[11px] text-red-400">{activeAuth.error}</div>
                                    )}
                                    <div className="mt-3 flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                stopPolling();
                                                setActiveAuth(null);
                                            }}
                                            className="px-3 py-1 rounded-lg text-[10px] uppercase tracking-wider text-zinc-400 hover:text-white border border-[var(--border)]"
                                        >
                                            Cancel
                                        </button>
                                        <span className="text-[10px] text-zinc-500">Polling for callback</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
    return (
        <button
            onClick={onClick}
            className={clsx(
                "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-bold transition-all w-full text-left",
                active 
                    ? "bg-[var(--accent)] text-white shadow-[0_0_15px_rgba(139,92,246,0.3)]" 
                    : "text-zinc-500 hover:text-zinc-200 hover:bg-[var(--bg-elevated)]"
            )}
        >
            {icon}
            <span className="tracking-tight">{label}</span>
        </button>
    );
}

// --- Sub Components ---

function GeneralSettings() {
    const { theme, setTheme, fontFamily, setFontFamily } = useSettingsStore();

    return (
        <div className="space-y-8 max-w-lg">
            <div>
                <h3 className="text-sm font-medium text-gray-300 mb-4">Appearance</h3>
                <div className="grid grid-cols-2 gap-4">
                    {['aura', 'dark', 'light'].map((t) => (
                        <button
                            key={t}
                            onClick={() => setTheme(t as any)}
                            className={clsx(
                                "border rounded-xl p-4 text-left capitalize transition-all",
                                theme === t 
                                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] shadow-[0_0_20px_rgba(139,92,246,0.1)]" 
                                    : "border-[var(--border)] hover:border-zinc-600 bg-[var(--bg-base)] text-zinc-400"
                            )}
                        >
                            <div className="font-bold text-sm">{t}</div>
                            <div className="text-[10px] opacity-60 mt-1 uppercase tracking-tighter">
                                {t === 'aura' ? 'Signature purple' : t === 'dark' ? 'Neutral black' : 'High contrast'}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <h3 className="text-sm font-medium text-zinc-300 mb-4">Font</h3>
                <div className="space-y-3">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Interface & Editor Font</label>
                    <div className="relative">
                        <select 
                            className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-xl pl-4 pr-10 py-2.5 text-sm focus:border-[var(--accent)] outline-none appearance-none text-[var(--text-primary)]"
                            style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
                            value={fontFamily}
                            onChange={(e) => setFontFamily(e.target.value)}
                        >
                            <option value="'JetBrains Mono', monospace" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>JetBrains Mono</option>
                            <option value="'Fira Code', monospace" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Fira Code</option>
                            <option value="'Source Code Pro', monospace" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Source Code Pro</option>
                            <option value="'Inter', sans-serif" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>Inter Sans</option>
                            <option value="monospace" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>System Mono</option>
                        </select>
                        <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                    </div>
                </div>
            </div>
        </div>
    );
}

function ShortcutSettings() {
    const shortcuts = [
        { key: 'Ctrl+P', desc: 'Command Palette' },
        { key: 'Ctrl+\\', desc: 'Toggle Terminal' },
        { key: 'Ctrl+,', desc: 'Open Settings' },
        { key: 'Ctrl+Enter', desc: 'Send Message' },
    ];

    return (
        <div className="space-y-2">
            {shortcuts.map(s => (
                <div key={s.key} className="flex items-center justify-between py-4 border-b border-[var(--border)] group">
                    <span className="text-sm text-zinc-400 group-hover:text-zinc-200 transition-colors">{s.desc}</span>
                    <kbd className="bg-[var(--bg-elevated)] border border-[var(--border)] px-3 py-1.5 rounded-lg text-[10px] font-bold font-mono text-zinc-400 shadow-sm">{s.key}</kbd>
                </div>
            ))}
        </div>
    );
}

function ProviderSettings() {
    const { apiKeys, setApiKey, ollamaBaseUrl, setOllamaBaseUrl, openaiAuthMethod, setOpenAIAuthMethod } = useProviderStore();
    const [oauthStatus, setOauthStatus] = useState<OAuthTokenStatus | null>(null);

    const loadOauthStatus = async () => {
        try {
            const status = await invoke<Record<string, OAuthTokenStatus>>("oauth_token_status");
            setOauthStatus(status?.chatgpt ?? null);
        } catch (error) {
            setOauthStatus(null);
        }
    };

    useEffect(() => {
        loadOauthStatus();
    }, []);
    
    const providers = [
        { id: 'openai', name: 'OpenAI', icon: '⚡', needsKey: true },
        { id: 'gemini', name: 'Google Gemini', icon: '✨', needsKey: true },
        { id: 'anthropic', name: 'Anthropic', icon: '🧠', needsKey: true },
        { id: 'ollama', name: 'Ollama (Local)', icon: '🏠', needsKey: false },
    ];

    return (
        <div className="space-y-4">
            {providers.map(p => {
                const usesOAuth = p.id === "openai" && openaiAuthMethod === "oauth";
                const isConnected = p.needsKey
                    ? (usesOAuth ? Boolean(oauthStatus?.connected) : Boolean(apiKeys[p.id]))
                    : true;
                return (
                <div key={p.id} className="bg-[var(--bg-base)] border border-[var(--border)] rounded-2xl p-5 hover:border-[var(--accent)]/30 transition-all group">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-[var(--bg-elevated)] flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                                {p.icon}
                            </div>
                            <div>
                                <div className="font-bold text-zinc-100">{p.name}</div>
                                <div className={clsx(
                                    "text-[10px] font-bold uppercase tracking-widest",
                                    p.needsKey 
                                        ? (isConnected ? 'text-green-500' : 'text-zinc-600')
                                        : 'text-green-500'
                                )}>
                                    {p.needsKey 
                                        ? (isConnected ? 'Connected' : 'Disconnected')
                                        : 'Always Available'
                                    }
                                </div>
                            </div>
                        </div>
                        {p.needsKey ? (
                            <button 
                                className={clsx(
                                    "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-tighter transition-all",
                                    apiKeys[p.id] 
                                        ? "bg-red-500/10 text-red-500 hover:bg-red-500/20" 
                                        : "bg-[var(--accent)] text-white hover:bg-[var(--accent)]/80 shadow-lg"
                                )}
                                onClick={() => {
                                    if (apiKeys[p.id]) {
                                        setApiKey(p.id, ""); // Disconnect
                                    } else {
                                        const key = prompt(`Enter API Key for ${p.name}:`);
                                        if (key) setApiKey(p.id, key);
                                    }
                                }}
                            >
                                {apiKeys[p.id] ? 'Revoke Access' : 'Connect'}
                            </button>
                        ) : (
                            <button 
                                className="bg-[var(--bg-elevated)] text-zinc-400 hover:text-white px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-tighter transition-all border border-[var(--border)] hover:border-[var(--accent)]"
                                onClick={() => {
                                    const url = prompt("Enter Ollama Base URL:", ollamaBaseUrl);
                                    if (url) setOllamaBaseUrl(url);
                                }}
                            >
                                Configure
                            </button>
                        )}
                    </div>
                    {p.id === 'ollama' && (
                        <div className="mt-3 pt-3 border-t border-[var(--border)]">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-500">Base URL:</span>
                                <span className="text-zinc-300 font-mono">{ollamaBaseUrl}</span>
                            </div>
                        </div>
                    )}
                    {p.id === 'openai' && (
                        <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-3">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-500">Auth Method:</span>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setOpenAIAuthMethod("apiKey")}
                                        className={clsx(
                                            "px-2.5 py-1 rounded-lg text-[10px] uppercase tracking-widest",
                                            openaiAuthMethod === "apiKey"
                                                ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                                                : "bg-[var(--bg-elevated)] text-zinc-500"
                                        )}
                                    >
                                        API Key
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setOpenAIAuthMethod("oauth")}
                                        className={clsx(
                                            "px-2.5 py-1 rounded-lg text-[10px] uppercase tracking-widest",
                                            openaiAuthMethod === "oauth"
                                                ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                                                : "bg-[var(--bg-elevated)] text-zinc-500"
                                        )}
                                    >
                                        OAuth
                                    </button>
                                </div>
                            </div>
                            {openaiAuthMethod === "oauth" && (
                                <div className="flex items-center justify-between text-[11px] text-zinc-500">
                                    <span>OAuth Status:</span>
                                    <div className="flex items-center gap-2">
                                        <span>{oauthStatus?.connected ? (oauthStatus.expiresAt && Date.now() > oauthStatus.expiresAt ? "Expired" : "Connected") : "Disconnected"}</span>
                                        <button
                                            type="button"
                                            onClick={loadOauthStatus}
                                            className="text-[10px] uppercase tracking-widest text-zinc-400 hover:text-[var(--accent)]"
                                        >
                                            Refresh
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            );
            })}
        </div>
    );
}

function ModelSettings() {
    const { workspacePath } = useStore();
    const { enabledModels, toggleModel, modelRegistry, addModel, removeModel, updateModel, replaceProviderModels, openaiAuthMethod, apiKeys, ollamaBaseUrl } = useProviderStore();
    const [search, setSearch] = useState("");
    const [importStatus, setImportStatus] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncStatus, setSyncStatus] = useState<string | null>(null);

    const providerLabels: Record<string, string> = {
        openai: "OpenAI",
        gemini: "Google",
        anthropic: "Anthropic",
        ollama: "Ollama"
    };

    const configPath = workspacePath ? `${workspacePath.replace(/\/$/, "")}/.anvil/models.json` : null;

    const filtered = modelRegistry.filter((model) =>
        model.name.toLowerCase().includes(search.toLowerCase()) ||
        model.id.toLowerCase().includes(search.toLowerCase())
    );

    const handleSyncAll = async () => {
        setSyncStatus(null);
        setIsSyncing(true);
        const messages: string[] = [];

        try {
            if (openaiAuthMethod === "oauth" || apiKeys.openai) {
                const models = await invoke<string[]>("list_openai_models", {
                    apiKey: openaiAuthMethod === "apiKey" ? apiKeys.openai : null,
                    oauthProvider: openaiAuthMethod === "oauth" ? "chatgpt" : null
                });
                replaceProviderModels("openai", models);
                messages.push(`OpenAI: ${models.length}`);
            } else {
                messages.push("OpenAI: not configured");
            }

            if (ollamaBaseUrl) {
                const models = await invoke<string[]>("list_ollama_models", { baseUrl: ollamaBaseUrl });
                replaceProviderModels("ollama", models);
                messages.push(`Ollama: ${models.length}`);
            } else {
                messages.push("Ollama: base URL not set");
            }

            setSyncStatus(messages.join(" • "));
        } catch (error) {
            console.error("Failed to sync models:", error);
            setSyncStatus(`Failed to sync models: ${String(error)}`);
        } finally {
            setIsSyncing(false);
        }
    };

    const inferProviderId = (modelId: string) => {
        if (modelId.startsWith("gemini")) return "gemini";
        if (modelId.startsWith("claude")) return "anthropic";
        if (modelId.startsWith("gpt") || modelId.startsWith("o1") || modelId.startsWith("o3")) return "openai";
        return "ollama";
    };

    const handleImportConfig = async () => {
        if (!configPath) {
            setImportStatus("Select a workspace to import models.");
            return;
        }
        setIsImporting(true);
        setImportStatus(null);
        try {
            const content = await invoke<string>("read_file", { path: configPath });
            const parsed = JSON.parse(content) as { models?: Array<{ id?: string; name?: string; providerId?: string; provider?: string; enabled?: boolean }> };
            const entries = Array.isArray(parsed?.models) ? parsed.models : [];
            let added = 0;
            let updated = 0;

            entries.forEach((entry) => {
                const id = entry.id?.trim();
                if (!id) return;
                const providerId = (entry.providerId || entry.provider || inferProviderId(id)).toLowerCase();
                const name = entry.name?.trim() || id;
                const enabled = entry.enabled !== false;

                const existing = modelRegistry.find((model) => model.id === id);
                if (existing) {
                    if (existing.source === "custom") {
                        updateModel(id, { name, providerId });
                    }
                    const isEnabled = enabledModels.includes(id);
                    if (enabled !== isEnabled) {
                        toggleModel(id);
                    }
                    updated += 1;
                    return;
                }

                addModel({ id, name, providerId }, enabled);
                added += 1;
            });

            setImportStatus(`Imported ${added} new model${added === 1 ? "" : "s"}, updated ${updated}.`);
        } catch (error) {
            console.error("Failed to import models:", error);
            setImportStatus("Failed to import models.json.");
        } finally {
            setIsImporting(false);
        }
    };

    const handleExportConfig = async () => {
        if (!configPath) {
            setImportStatus("Select a workspace to export models.");
            return;
        }
        setIsExporting(true);
        setImportStatus(null);
        try {
            const payload = {
                models: modelRegistry.map((model) => ({
                    id: model.id,
                    name: model.name,
                    providerId: model.providerId,
                    enabled: enabledModels.includes(model.id)
                }))
            };
            await invoke("write_export_file", {
                outputPath: configPath,
                content: JSON.stringify(payload, null, 2)
            });
            setImportStatus("models.json saved to .anvil.");
        } catch (error) {
            console.error("Failed to export models:", error);
            setImportStatus("Failed to write models.json.");
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-bold text-zinc-200">Model Catalog</h3>
                    <p className="text-[11px] text-zinc-500">Load or save models in `.anvil/models.json`.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleSyncAll}
                        disabled={isSyncing}
                        className="px-3 py-2 rounded-lg border border-[var(--border)] text-xs text-zinc-300 hover:text-white hover:border-[var(--accent)] transition-colors disabled:opacity-50"
                    >
                        {isSyncing ? "Syncing..." : "Sync Providers"}
                    </button>
                    <button
                        type="button"
                        onClick={handleImportConfig}
                        disabled={isImporting || isExporting}
                        className="px-3 py-2 rounded-lg border border-[var(--border)] text-xs text-zinc-300 hover:text-white hover:border-[var(--accent)] transition-colors disabled:opacity-50"
                    >
                        <div className="flex items-center gap-2">
                            <Upload size={14} />
                            Import
                        </div>
                    </button>
                    <button
                        type="button"
                        onClick={handleExportConfig}
                        disabled={isImporting || isExporting}
                        className="px-3 py-2 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] text-xs hover:bg-[var(--accent)]/20 transition-colors disabled:opacity-50"
                    >
                        <div className="flex items-center gap-2">
                            <Download size={14} />
                            Export
                        </div>
                    </button>
                </div>
            </div>
            {importStatus && (
                <div className="mt-2 text-[11px] text-zinc-500">{importStatus}</div>
            )}
            {syncStatus && (
                <div className="mt-2 text-[11px] text-zinc-500">{syncStatus}</div>
            )}

            <div className="relative group">
                <Search size={16} className="absolute left-4 top-3.5 text-zinc-600 group-focus-within:text-[var(--accent)] transition-colors" />
                <input 
                    className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-2xl pl-12 pr-4 py-3 text-sm focus:border-[var(--accent)] outline-none text-[var(--text-primary)] transition-all shadow-inner"
                    placeholder="Search available models..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>

            <div className="grid grid-cols-1 gap-2">
                {filtered.map(model => {
                    const enabled = enabledModels.includes(model.id);
                    const providerLabel = providerLabels[model.providerId] || model.providerId;
                    return (
                        <div key={model.id} className="flex items-center justify-between p-4 rounded-xl hover:bg-[var(--bg-elevated)]/50 border border-transparent hover:border-[var(--border)] transition-all">
                            <div className="flex flex-col gap-1">
                                <div className="text-sm font-bold text-zinc-100 tracking-tight flex items-center gap-2">
                                    {model.name}
                                    {model.source === "custom" && (
                                        <span className="text-[9px] uppercase tracking-widest text-zinc-500 border border-[var(--border)] px-2 py-0.5 rounded-full">Custom</span>
                                    )}
                                    {model.source === "synced" && (
                                        <span className="text-[9px] uppercase tracking-widest text-zinc-500 border border-[var(--border)] px-2 py-0.5 rounded-full">Synced</span>
                                    )}
                                </div>
                                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{model.id} • {providerLabel}</div>
                            </div>
                            <div className="flex items-center gap-3">
                                {model.source === "custom" && (
                                    <button
                                        type="button"
                                        onClick={() => removeModel(model.id)}
                                        className="text-[10px] uppercase tracking-widest text-zinc-500 hover:text-red-400"
                                        title="Remove custom model"
                                    >
                                        Remove
                                    </button>
                                )}
                                <button
                                    onClick={() => toggleModel(model.id)}
                                    className={clsx(
                                        "w-12 h-6 rounded-full transition-all relative shadow-inner",
                                        enabled ? "bg-[var(--accent)]" : "bg-zinc-800"
                                    )}
                                >
                                    <div className={clsx(
                                        "absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform shadow-md",
                                        enabled ? "translate-x-6" : "translate-x-0"
                                    )} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
