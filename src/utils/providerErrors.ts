import type { SettingsTab } from "../stores/ui";

export interface ProviderErrorGuidance {
    code: string;
    message: string;
    fixTab?: SettingsTab;
}

const getErrorText = (error: unknown): string => {
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
        const maybeMessage = (error as { message?: unknown }).message;
        if (typeof maybeMessage === "string" && maybeMessage.trim()) {
            return maybeMessage;
        }
        try {
            return JSON.stringify(error);
        } catch (_) {
            return String(error);
        }
    }
    return String(error);
};

const extractJsonDetail = (text: string): string | null => {
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
    try {
        const parsed = JSON.parse(trimmed) as {
            detail?: unknown;
            error?: unknown;
            message?: unknown;
            error_description?: unknown;
        };
        const candidate =
            parsed.detail ??
            parsed.error_description ??
            parsed.message ??
            parsed.error;
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
    } catch (_) {
        return null;
    }
    return null;
};

export const extractProviderErrorText = (error: unknown): string => {
    const raw = getErrorText(error).trim();
    if (!raw) return raw;

    const httpIndex = raw.indexOf("Error HTTP:");
    if (httpIndex >= 0) {
        const suffix = raw.slice(httpIndex + "Error HTTP:".length).trim();
        const detail = extractJsonDetail(suffix);
        if (detail) return detail;
        return suffix || raw;
    }

    const errorPrefix = raw.startsWith("Error:") ? raw.slice("Error:".length).trim() : raw;
    const detail = extractJsonDetail(errorPrefix);
    if (detail) return detail;
    return errorPrefix;
};

export const settingsTabLabel = (tab: SettingsTab): string => {
    switch (tab) {
        case "providers":
            return "Providers";
        case "models":
            return "Models";
        case "oauth":
            return "OAuth";
        case "permissions":
            return "Permissions";
        case "diagnostics":
            return "Diagnostics";
        case "shortcuts":
            return "Shortcuts";
        default:
            return "General";
    }
};

export const mapProviderError = (error: unknown): ProviderErrorGuidance | null => {
    const normalized = extractProviderErrorText(error);
    const lower = normalized.toLowerCase();
    if (!lower) return null;

    if (
        lower.includes("the 'default' model is not supported when using codex with a chatgpt account") ||
        (lower.includes("default") && lower.includes("model") && lower.includes("codex"))
    ) {
        return {
            code: "codex_default_model",
            message: "Model \"default\" is not supported for ChatGPT Codex accounts. Select an explicit model and retry.",
            fixTab: "models"
        };
    }

    if (
        lower.includes("could not parse your authentication token") ||
        lower.includes("authentication token is invalid") ||
        lower.includes("invalid authentication token")
    ) {
        return {
            code: "oauth_token_invalid",
            message: "Authentication token is invalid or expired. Reconnect OAuth and retry.",
            fixTab: "oauth"
        };
    }

    if (lower.includes("stream must be set to true")) {
        return {
            code: "codex_stream_required",
            message: "This Codex account requires streaming responses. Retry after reconnecting OAuth.",
            fixTab: "oauth"
        };
    }

    if (
        lower.includes("invalid_api_key") ||
        lower.includes("incorrect api key") ||
        lower.includes("invalid api key")
    ) {
        return {
            code: "api_key_invalid",
            message: "Provider rejected the current API key. Update credentials and retry.",
            fixTab: "providers"
        };
    }

    if (
        lower.includes("unauthorized") ||
        lower.includes("status code 401") ||
        lower.includes("401 unauthorized")
    ) {
        return {
            code: "provider_unauthorized",
            message: "Provider request was unauthorized. Refresh credentials and retry.",
            fixTab: "providers"
        };
    }

    return null;
};
