import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Chat } from "../Chat";
import { useStore } from "../../store";
import { useProviderStore } from "../../stores/provider";
import { useUIStore } from "../../stores/ui";

vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn(() => Promise.resolve(() => {}))
}));

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn()
}));

vi.mock("../../stores/provider", () => ({
    useProviderStore: vi.fn()
}));

vi.mock("../../stores/ui", () => ({
    useUIStore: vi.fn()
}));

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);
const mockedUseProviderStore = vi.mocked(useProviderStore);
const mockedUseUIStore = vi.mocked(useUIStore);

const sharePayload = {
    shareId: "share-123",
    url: "http://127.0.0.1:43111/s/share-123",
    expiresAt: 1767000000000,
    oneTime: false,
    format: "json"
};

const sendSlashCommand = async (value: string) => {
    const input = screen.getByPlaceholderText("Explain your changes or ask a question...");
    fireEvent.change(input, {
        target: {
            value,
            selectionStart: value.length
        }
    });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: false });
    await waitFor(() => {
        expect(useStore.getState().messages.length).toBeGreaterThan(0);
    });
};

describe("Chat slash commands", () => {
    const setOrchestratorOpen = vi.fn();
    const openSettingsTab = vi.fn();
    let providerState: {
        enabledModels: string[];
        activeModelId: string;
        setActiveModel: ReturnType<typeof vi.fn>;
        activeProviderId: string;
        apiKeys: Record<string, string>;
        modelRegistry: Array<{ id: string; name: string; providerId: string }>;
        openaiAuthMethod: "apiKey" | "oauth";
        setOpenAIAuthMethod: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();

        mockedListen.mockResolvedValue(() => {});
        mockedInvoke.mockImplementation(async (command) => {
            if (command === "git_status_summary") {
                return {
                    staged: [],
                    unstaged: [],
                    untracked: [],
                    conflicted: [],
                    branch: "main"
                };
            }
            if (command === "start_local_session_share") {
                return sharePayload;
            }
            if (command === "stop_local_session_share") {
                return null;
            }
            return "";
        });

        useStore.setState({
            sessionId: "session-1",
            openSessions: ["session-1"],
            sessionCache: { "session-1": [] },
            sessionMeta: {},
            sessionStatus: { "session-1": "idle" },
            sessionConfig: {},
            messages: [],
            workspacePath: "/workspace",
            files: []
        });

        providerState = {
            enabledModels: ["gpt-5", "o3-mini"],
            activeModelId: "gpt-5",
            setActiveModel: vi.fn(),
            activeProviderId: "openai",
            apiKeys: { openai: "sk-test" },
            modelRegistry: [],
            openaiAuthMethod: "apiKey",
            setOpenAIAuthMethod: vi.fn()
        };
        mockedUseProviderStore.mockImplementation((selector?: unknown) => {
            if (typeof selector === "function") {
                return (selector as (state: typeof providerState) => unknown)(providerState);
            }
            return providerState;
        });

        const uiState = {
            activeMode: "build",
            setActiveMode: vi.fn(),
            temperature: "low",
            setTemperature: vi.fn(),
            isEditorOpen: false,
            setEditorOpen: vi.fn(),
            openSettingsTab,
            setOrchestratorOpen,
            isQuestionOpen: false,
            setQuestionOpen: vi.fn()
        };
        mockedUseUIStore.mockImplementation((selector?: unknown) => {
            if (typeof selector === "function") {
                return (selector as (state: typeof uiState) => unknown)(uiState);
            }
            return uiState;
        });
    });

    it("handles /agents command", async () => {
        render(<Chat />);
        await sendSlashCommand("/agents ");

        expect(setOrchestratorOpen).toHaveBeenCalledWith(true);
        const messages = useStore.getState().messages;
        expect(messages[messages.length - 1]?.content).toContain("Opened multi-agent orchestration.");
    });

    it("handles /permissions and /models commands", async () => {
        render(<Chat />);
        await sendSlashCommand("/permissions ");
        await sendSlashCommand("/models ");

        expect(openSettingsTab).toHaveBeenCalledWith("permissions");
        expect(openSettingsTab).toHaveBeenCalledWith("models");
        expect(useStore.getState().messages.some((msg) => msg.content?.includes("Opened Settings → Permissions."))).toBe(true);
        expect(useStore.getState().messages.some((msg) => msg.content?.includes("Opened Settings → Models."))).toBe(true);
    });

    it("handles /help command", async () => {
        render(<Chat />);
        await sendSlashCommand("/help ");

        const messages = useStore.getState().messages;
        const helpMessage = messages[messages.length - 1]?.content ?? "";
        expect(helpMessage).toContain("/agents");
        expect(helpMessage).toContain("/permissions");
        expect(helpMessage).toContain("/share");
    });

    it("handles /share and /unshare commands", async () => {
        render(<Chat />);
        await sendSlashCommand("/share ");

        expect(mockedInvoke).toHaveBeenCalledWith("start_local_session_share", expect.any(Object));
        {
            const messages = useStore.getState().messages;
            expect(messages[messages.length - 1]?.content).toContain("Local share ready:");
        }

        await sendSlashCommand("/unshare ");

        expect(mockedInvoke).toHaveBeenCalledWith("stop_local_session_share", { shareId: "share-123" });
        {
            const messages = useStore.getState().messages;
            expect(messages[messages.length - 1]?.content).toContain("Stopped active local share link.");
        }
    });

    it("maps raw provider stream errors into actionable guidance", async () => {
        mockedInvoke.mockImplementation(async (command) => {
            if (command === "git_status_summary") {
                return { staged: [], unstaged: [], untracked: [], conflicted: [] };
            }
            if (command === "stream_chat") {
                return "Error HTTP: {\"detail\":\"The 'default' model is not supported when using Codex with a ChatGPT account.\"}";
            }
            if (command === "save_session") {
                return { ok: true };
            }
            return "";
        });

        render(<Chat />);
        const input = screen.getByPlaceholderText("Explain your changes or ask a question...");
        fireEvent.change(input, {
            target: {
                value: "run check",
                selectionStart: 9
            }
        });
        fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: false });

        await waitFor(() => {
            const messages = useStore.getState().messages;
            expect(messages.some((msg) =>
                msg.role === "Assistant" &&
                (msg.content ?? "").includes("Model \"default\" is not supported for ChatGPT Codex accounts.")
            )).toBe(true);
        });

        expect(openSettingsTab).toHaveBeenCalledWith("models");
    });

    it("blocks send on oauth default model preflight with direct fix guidance", async () => {
        providerState.activeModelId = "default";
        providerState.enabledModels = ["default"];
        providerState.openaiAuthMethod = "oauth";
        providerState.apiKeys = {};

        mockedInvoke.mockImplementation(async (command) => {
            if (command === "git_status_summary") {
                return { staged: [], unstaged: [], untracked: [], conflicted: [] };
            }
            if (command === "oauth_token_status") {
                return { chatgpt: { connected: true } };
            }
            return "";
        });

        render(<Chat />);
        const input = screen.getByPlaceholderText("Explain your changes or ask a question...");
        fireEvent.change(input, {
            target: {
                value: "run check",
                selectionStart: 9
            }
        });
        fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: false });

        await waitFor(() => {
            const messages = useStore.getState().messages;
            expect(messages.some((msg) =>
                (msg.content ?? "").includes("Model \"default\" is not supported for ChatGPT Codex accounts.")
            )).toBe(true);
        });

        expect(openSettingsTab).toHaveBeenCalledWith("models");
        expect(mockedInvoke).not.toHaveBeenCalledWith("stream_chat", expect.anything());
    });
});
