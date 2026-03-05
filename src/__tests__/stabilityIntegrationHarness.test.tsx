import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { PermissionsSettings } from "../components/settings/PermissionsSettings";
import { WorkflowsPanel } from "../components/WorkflowsPanel";
import { useStore } from "../store";
import { useUIStore } from "../stores/ui";
import { useOrchestratorStore } from "../stores/orchestrator";
import { PermissionConfig, useSettingsStore } from "../stores/settings";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn()
}));

vi.mock("../store", () => ({
    useStore: vi.fn()
}));

vi.mock("../stores/ui", () => ({
    useUIStore: vi.fn()
}));

type HarnessTaskStatus = "Pending" | "InProgress" | "Completed" | "Failed";

interface HarnessTask {
    id: string;
    description: string;
    status: HarnessTaskStatus;
    preferred_agent?: string | null;
    dependencies?: string[];
    assigned_to?: string | null;
    group_id?: string | null;
    group_mode?: "parallel" | "sequential" | null;
    result?: string | null;
    created_at: string;
}

interface HarnessAgent {
    id: string;
    role: string;
    modelId: string;
    provider: string;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const defaultPermissionConfig: PermissionConfig = {
    read: { default: "allow", rules: [] },
    write: { default: "allow", rules: [] },
    edit: { default: "allow", rules: [] },
    bash: { default: "allow", rules: [] },
    skill: { default: "allow", rules: [] },
    list: { default: "allow", rules: [] },
    glob: { default: "allow", rules: [] },
    grep: { default: "allow", rules: [] },
    webfetch: { default: "allow", rules: [] },
    task: { default: "allow", rules: [] },
    lsp: { default: "allow", rules: [] },
    todoread: { default: "allow", rules: [] },
    todowrite: { default: "allow", rules: [] },
    doom_loop: { default: "ask", rules: [] }
};

const workflowSummary = {
    id: "wf-harness",
    name: "Harness Workflow",
    description: "Workflow used by integration harness",
    steps: 1,
    created_at: "2026-02-24T19:00:00.000Z",
    updated_at: "2026-02-24T19:00:00.000Z"
};

const workflowDetail = {
    id: "wf-harness",
    name: "Harness Workflow",
    description: "Workflow used by integration harness",
    steps: [
        {
            id: "step-1",
            title: "Run final check",
            command: "echo workflow check",
            requires_approval: true
        }
    ],
    created_at: "2026-02-24T19:00:00.000Z",
    updated_at: "2026-02-24T19:00:00.000Z"
};

const backendState: {
    permissions: PermissionConfig;
    orchestrator: {
        executionMode: "parallel" | "sequential";
        agents: HarnessAgent[];
        tasks: HarnessTask[];
        nextTaskId: number;
    };
    terminalWrites: string[];
} = {
    permissions: clone(defaultPermissionConfig),
    orchestrator: {
        executionMode: "parallel",
        agents: [],
        tasks: [],
        nextTaskId: 1
    },
    terminalWrites: []
};

const resetBackendState = () => {
    backendState.permissions = clone(defaultPermissionConfig);
    backendState.orchestrator.executionMode = "parallel";
    backendState.orchestrator.agents = [];
    backendState.orchestrator.tasks = [];
    backendState.orchestrator.nextTaskId = 1;
    backendState.terminalWrites = [];
};

const mockedInvoke = vi.mocked(invoke);
const mockedUseStore = vi.mocked(useStore);
const mockedUseUIStore = vi.mocked(useUIStore);

const configureInvokeMock = () => {
    mockedInvoke.mockImplementation(async (command: string, args?: unknown) => {
        if (command === "get_cwd") {
            return "/workspace";
        }

        if (command === "load_permission_config") {
            return clone(backendState.permissions);
        }

        if (command === "save_permission_config") {
            const payload = (args ?? {}) as { config?: PermissionConfig };
            backendState.permissions = clone(payload.config ?? defaultPermissionConfig);
            return { success: true };
        }

        if (command === "init_orchestrator") {
            return { success: true };
        }

        if (command === "get_orchestrator_execution_mode") {
            return backendState.orchestrator.executionMode;
        }

        if (command === "set_orchestrator_execution_mode") {
            const payload = (args ?? {}) as { mode?: "parallel" | "sequential" };
            backendState.orchestrator.executionMode = payload.mode === "sequential" ? "sequential" : "parallel";
            return { success: true };
        }

        if (command === "add_agent_to_orchestrator") {
            const payload = (args ?? {}) as {
                agentId?: string;
                role?: string;
                modelId?: string;
                provider?: string;
            };
            backendState.orchestrator.agents.push({
                id: payload.agentId ?? "agent-missing",
                role: payload.role ?? "Generic",
                modelId: payload.modelId ?? "unknown",
                provider: payload.provider ?? "openai"
            });
            return { success: true };
        }

        if (command === "create_task") {
            const payload = (args ?? {}) as {
                description?: string;
                dependencyIds?: string[] | null;
                preferredAgentId?: string | null;
                groupId?: string | null;
                groupMode?: "parallel" | "sequential" | null;
            };
            const taskId = `task-${backendState.orchestrator.nextTaskId++}`;
            backendState.orchestrator.tasks.push({
                id: taskId,
                description: payload.description ?? "Untitled task",
                status: "Pending",
                preferred_agent: payload.preferredAgentId ?? null,
                dependencies: payload.dependencyIds ?? [],
                assigned_to: null,
                group_id: payload.groupId ?? null,
                group_mode: payload.groupMode ?? null,
                result: null,
                created_at: new Date().toISOString()
            });
            return taskId;
        }

        if (command === "get_all_tasks") {
            return clone(backendState.orchestrator.tasks);
        }

        if (command === "process_tasks") {
            const defaultAgentId = backendState.orchestrator.agents[0]?.id ?? null;
            backendState.orchestrator.tasks = backendState.orchestrator.tasks.map((task) => ({
                ...task,
                status: "Completed",
                assigned_to: task.assigned_to ?? task.preferred_agent ?? defaultAgentId,
                result: task.result ?? `Completed: ${task.description}`
            }));
            return backendState.orchestrator.tasks.map((task) => task.id);
        }

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
            const payload = (args ?? {}) as { data?: string };
            backendState.terminalWrites.push(payload.data ?? "");
            return { ok: true };
        }

        throw new Error(`Unhandled invoke command in harness: ${command}`);
    });
};

describe("stability integration harness", () => {
    beforeEach(() => {
        cleanup();
        vi.clearAllMocks();
        window.localStorage.clear();
        resetBackendState();

        mockedUseStore.mockImplementation(
            ((selector?: (state: { workspacePath: string }) => unknown) => {
                const state = { workspacePath: "/workspace" };
                if (typeof selector === "function") {
                    return selector(state);
                }
                return state;
            }) as never
        );

        mockedUseUIStore.mockReturnValue({
            isTerminalOpen: true,
            toggleTerminal: vi.fn()
        } as never);

        useOrchestratorStore.setState({
            agents: [],
            tasks: [],
            activeTask: null,
            backendStatus: "idle",
            executionMode: "parallel",
            lastError: null
        });

        useSettingsStore.setState({
            permissions: clone(defaultPermissionConfig)
        });

        configureInvokeMock();
    });

    it("runs settings, orchestrator, and workflow flows in one deterministic scenario", async () => {
        const settingsView = render(<PermissionsSettings />);

        await waitFor(() => {
            expect(screen.getByText("Read Files")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", { name: "global-deny" }));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => {
            expect(backendState.permissions["*"]).toBe("deny");
        });
        settingsView.unmount();

        const initOk = await useOrchestratorStore.getState().initOrchestrator("/workspace");
        expect(initOk).toBe(true);

        const modeOk = await useOrchestratorStore.getState().setExecutionMode("sequential");
        expect(modeOk).toBe(true);

        const added = await useOrchestratorStore.getState().addAgent(
            {
                id: "agent-1",
                role: "Reviewer",
                modelId: "gpt-4.1",
                providerId: "openai"
            },
            "test-key",
            "/workspace"
        );
        expect(added).toBe(true);

        const taskCreated = await useOrchestratorStore.getState().addTask(
            "Run project stability review",
            false,
            "agent-1",
            "qa-pack",
            "sequential"
        );
        expect(taskCreated).toBe(true);

        const processed = await useOrchestratorStore.getState().processTasks();
        expect(processed).toBe(true);

        const orchestratorTasks = useOrchestratorStore.getState().tasks;
        expect(orchestratorTasks).toHaveLength(1);
        expect(orchestratorTasks[0].status).toBe("Completed");
        expect(orchestratorTasks[0].assignedTo).toBe("agent-1");

        const workflowsView = render(<WorkflowsPanel />);

        await waitFor(() => {
            expect(screen.getByTitle("Run workflow")).toBeInTheDocument();
        });
        fireEvent.click(screen.getByTitle("Run workflow"));

        await waitFor(() => {
            expect(screen.getByText("Review Workflow Plan")).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole("button", { name: "Start Run" }));

        await waitFor(() => {
            expect(screen.getByText("Run Workflow Step")).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole("button", { name: "Run Step" }));

        await waitFor(() => {
            expect(backendState.terminalWrites).toContain("echo workflow check\n");
        });
        workflowsView.unmount();

        expect(backendState.permissions["*"]).toBe("deny");
        expect(backendState.orchestrator.executionMode).toBe("sequential");
        expect(backendState.orchestrator.tasks[0]?.status).toBe("Completed");
    });
});
