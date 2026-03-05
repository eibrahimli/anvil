import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Chat } from "../Chat";
import { useStore } from "../../store";
import { useProviderStore } from "../../stores/provider";
import { useUIStore } from "../../stores/ui";

vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn(() => Promise.resolve(() => {}))
}));

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(() => Promise.resolve(""))
}));

vi.mock("../../stores/provider", () => ({
    useProviderStore: vi.fn()
}));

vi.mock("../../stores/ui", () => ({
    useUIStore: vi.fn()
}));

describe("Chat timeline toggle", () => {
    beforeEach(() => {
        useStore.setState({
            workspacePath: "",
            sessionId: null,
            messages: [
                { role: "User", content: "Hi" },
                { role: "Assistant", content: "Hello" }
            ]
        });
        const providerState = {
            enabledModels: ["gpt-4o"],
            activeModelId: "gpt-4o",
            setActiveModel: vi.fn(),
            activeProviderId: "openai",
            apiKeys: {},
            modelRegistry: []
        };
        vi.mocked(useProviderStore).mockImplementation((selector?: any) =>
            typeof selector === "function" ? selector(providerState) : providerState
        );

        const uiState = {
            activeMode: "build",
            setActiveMode: vi.fn(),
            temperature: "low",
            setTemperature: vi.fn(),
            isEditorOpen: false,
            setEditorOpen: vi.fn(),
            setSettingsOpen: vi.fn(),
            isQuestionOpen: false,
            setQuestionOpen: vi.fn()
        };
        vi.mocked(useUIStore).mockImplementation((selector?: any) =>
            typeof selector === "function" ? selector(uiState) : uiState
        );
    });

    it("toggles between stream and timeline views", () => {
        render(<Chat />);

        expect(screen.queryByTestId("timeline-view")).not.toBeInTheDocument();

        const toggle = screen.getByTitle("Switch to timeline view");
        fireEvent.click(toggle);

        expect(screen.getByTestId("timeline-view")).toBeInTheDocument();
        expect(screen.getByTitle("Switch to stream view")).toBeInTheDocument();
    });
});
