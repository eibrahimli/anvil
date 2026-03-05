import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../../store";
import { useUIStore } from "../../stores/ui";
import { WorkflowsPanel } from "../WorkflowsPanel";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn()
}));

vi.mock("../../store", () => ({
    useStore: vi.fn()
}));

vi.mock("../../stores/ui", () => ({
    useUIStore: vi.fn()
}));

interface WorkflowStepFixture {
    id: string;
    title: string;
    command: string;
    requires_approval: boolean;
}

const workflowSummary = {
    id: "wf-review",
    name: "Check project review",
    description: "Review and validate project status",
    steps: 2,
    created_at: "2026-02-24T18:42:00.000Z",
    updated_at: "2026-02-24T18:42:00.000Z"
};

const workflowDetail = {
    id: "wf-review",
    name: "Check project review",
    description: "Review and validate project status",
    steps: [
        {
            id: "step-1",
            title: "Inspect project",
            command: "echo step 1",
            requires_approval: true
        },
        {
            id: "step-2",
            title: "Summarize findings",
            command: "echo step 2",
            requires_approval: true
        }
    ] satisfies WorkflowStepFixture[],
    created_at: "2026-02-24T18:42:00.000Z",
    updated_at: "2026-02-24T18:42:00.000Z"
};

const mockedInvoke = vi.mocked(invoke);
const mockedUseStore = vi.mocked(useStore);
const mockedUseUIStore = vi.mocked(useUIStore);

const configureInvokeMock = () => {
    mockedInvoke.mockImplementation(async (command: string, args?: unknown) => {
        if (command === "list_workflows") {
            return {
                workflows: [workflowSummary],
                count: 1
            };
        }

        if (command === "load_workflow") {
            const payload = (args ?? {}) as { workflowId?: string };
            if (payload.workflowId === workflowDetail.id) {
                return workflowDetail;
            }
            throw new Error(`Unknown workflow: ${payload.workflowId ?? "missing"}`);
        }

        if (command === "spawn_terminal") {
            return { ok: true };
        }

        if (command === "write_terminal") {
            return { ok: true };
        }

        throw new Error(`Unknown invoke command: ${command}`);
    });
};

const getWriteTerminalPayloads = () => {
    const calls = mockedInvoke.mock.calls as Array<[string, Record<string, unknown> | undefined]>;
    return calls
        .filter(([command]) => command === "write_terminal")
        .map(([, payload]) => payload);
};

const clickRunWorkflowButton = async () => {
    await waitFor(() => {
        expect(screen.getByText("Check project review")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Run workflow"));

    await waitFor(() => {
        expect(screen.getByText("Review Workflow Plan")).toBeInTheDocument();
    });
};

describe("WorkflowsPanel run lifecycle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();

        mockedUseStore.mockReturnValue({
            workspacePath: "/workspace"
        } as never);

        mockedUseUIStore.mockReturnValue({
            isTerminalOpen: true,
            toggleTerminal: vi.fn()
        } as never);

        configureInvokeMock();
    });

    it("gates execution behind the plan confirmation modal", async () => {
        render(<WorkflowsPanel />);

        await clickRunWorkflowButton();
        expect(mockedInvoke).not.toHaveBeenCalledWith("spawn_terminal", expect.anything());
        expect(getWriteTerminalPayloads()).toHaveLength(0);

        fireEvent.click(screen.getByRole("button", { name: "Start Run" }));

        await waitFor(() => {
            expect(screen.getByText("Run Workflow Step")).toBeInTheDocument();
        });

        expect(mockedInvoke).toHaveBeenCalledWith("spawn_terminal", { workspacePath: "/workspace" });
        expect(getWriteTerminalPayloads()).toHaveLength(0);
    });

    it("continues approval-gated runs step-by-step after each confirmation", async () => {
        render(<WorkflowsPanel />);

        await clickRunWorkflowButton();
        fireEvent.click(screen.getByRole("button", { name: "Start Run" }));

        await waitFor(() => {
            expect(screen.getByText("1 of 2")).toBeInTheDocument();
            expect(screen.getAllByText("echo step 1").length).toBeGreaterThan(0);
        });

        fireEvent.click(screen.getByRole("button", { name: "Run Step" }));

        await waitFor(() => {
            expect(getWriteTerminalPayloads()).toContainEqual({ data: "echo step 1\n" });
        });

        await waitFor(() => {
            expect(screen.getByText("2 of 2")).toBeInTheDocument();
            expect(screen.getAllByText("echo step 2").length).toBeGreaterThan(0);
        });
    });

    it("resumes a paused run and returns to the next approval checkpoint", async () => {
        window.localStorage.setItem(
            "anvil-workflow-runs:/workspace",
            JSON.stringify({
                [workflowDetail.id]: {
                    id: "run-1",
                    workflowId: workflowDetail.id,
                    workflowName: workflowDetail.name,
                    phase: "execute",
                    status: "paused",
                    startedAt: "2026-02-24T18:42:00.000Z",
                    updatedAt: "2026-02-24T18:43:00.000Z",
                    currentStepIndex: 1,
                    params: {},
                    steps: [
                        {
                            id: "step-1",
                            title: "Inspect project",
                            command: "echo step 1",
                            requiresApproval: true,
                            status: "completed"
                        },
                        {
                            id: "step-2",
                            title: "Summarize findings",
                            command: "echo step 2",
                            requiresApproval: true,
                            status: "pending"
                        }
                    ]
                }
            })
        );

        render(<WorkflowsPanel />);

        await waitFor(() => {
            expect(screen.getByText("Latest Run")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", { name: "Resume" }));

        await waitFor(() => {
            expect(screen.getByText("Run Workflow Step")).toBeInTheDocument();
            expect(screen.getByText("2 of 2")).toBeInTheDocument();
            expect(screen.getAllByText("echo step 2").length).toBeGreaterThan(0);
        });

        expect(getWriteTerminalPayloads()).toHaveLength(0);
    });
});
