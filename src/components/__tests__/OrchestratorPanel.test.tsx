import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrchestratorPanel } from "../orchestrator/OrchestratorPanel";
import { useStore } from "../../store";
import { useUIStore } from "../../stores/ui";
import { useProviderStore } from "../../stores/provider";
import { useConfirmationStore } from "../../stores/confirmation";
import { useOrchestratorStore } from "../../stores/orchestrator";

describe("OrchestratorPanel assignment transparency", () => {
    beforeEach(() => {
        window.localStorage.clear();

        useStore.setState({
            workspacePath: "",
            sessionId: null,
            messages: []
        });

        useUIStore.setState({
            isOrchestratorOpen: true
        });

        useProviderStore.setState({
            activeModelId: "gpt-5",
            activeProviderId: "openai",
            apiKeys: {},
            openaiAuthMethod: "apiKey"
        });

        useConfirmationStore.setState({
            pendingRequest: null,
            pendingBySession: {}
        });

        useOrchestratorStore.setState({
            agents: [
                {
                    id: "agent-coder",
                    role: "Coder",
                    modelId: "gpt-5",
                    providerId: "openai",
                    status: "idle"
                },
                {
                    id: "agent-reviewer",
                    role: "Reviewer",
                    modelId: "claude-3-5-sonnet",
                    providerId: "anthropic",
                    status: "idle"
                }
            ],
            tasks: [
                {
                    id: "task-preferred",
                    description: "Preferred assignment task",
                    status: "Completed",
                    preferredAgentId: "agent-coder",
                    assignedTo: "agent-coder",
                    dependencies: [],
                    createdAt: "2026-02-25T00:00:00.000Z"
                },
                {
                    id: "task-auto",
                    description: "Automatic role match task",
                    status: "Completed",
                    assignedTo: "agent-reviewer",
                    dependencies: [],
                    createdAt: "2026-02-25T00:01:00.000Z"
                },
                {
                    id: "task-fallback",
                    description: "Fallback assignment task",
                    status: "Failed",
                    preferredAgentId: "agent-coder",
                    assignedTo: "agent-reviewer",
                    dependencies: [],
                    result: "Error HTTP: {\"detail\":\"Could not parse your authentication token. Please try signing in again.\"}",
                    createdAt: "2026-02-25T00:02:00.000Z"
                }
            ],
            activeTask: null,
            backendStatus: "ready",
            executionMode: "parallel",
            lastError: null
        });
    });

    it("renders preferred, auto, and fallback assignment reason badges", () => {
        render(<OrchestratorPanel />);

        expect(screen.getByText("Preferred")).toBeInTheDocument();
        expect(screen.getByText("Auto Role Match")).toBeInTheDocument();
        expect(screen.getByText("Fallback")).toBeInTheDocument();
    });
});
