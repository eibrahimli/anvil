import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useOrchestratorStore } from "../stores/orchestrator";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn()
}));

type BackendTaskFixture = {
    id: string;
    description: string;
    status: "Pending" | "InProgress" | "Completed" | "Failed";
    preferred_agent?: string | null;
    dependencies?: string[];
    assigned_to?: string | null;
    group_id?: string | null;
    group_mode?: "parallel" | "sequential" | null;
    result?: string | null;
    created_at: string;
};

const makeBackendTask = (
    id: string,
    status: BackendTaskFixture["status"],
    overrides: Partial<BackendTaskFixture> = {}
): BackendTaskFixture => ({
    id,
    description: `Task ${id}`,
    status,
    preferred_agent: null,
    dependencies: [],
    assigned_to: null,
    group_id: null,
    group_mode: null,
    result: null,
    created_at: "2026-02-25T00:00:00.000Z",
    ...overrides
});

describe("useOrchestratorStore reliability", () => {
    const mockedInvoke = vi.mocked(invoke);

    beforeEach(() => {
        localStorage.clear();
        mockedInvoke.mockReset();

        useOrchestratorStore.setState({
            agents: [],
            tasks: [],
            activeTask: null,
            isOrchestratorOpen: false,
            backendStatus: "ready",
            executionMode: "parallel",
            lastError: null
        });
    });

    it("marks next pending task as InProgress immediately when processing starts", async () => {
        let processDone = false;
        let resolveProcess: (() => void) | null = null;

        const pendingTasks = [makeBackendTask("task-1", "Pending")];
        const completedTasks = [makeBackendTask("task-1", "Completed", { result: "done" })];

        mockedInvoke.mockImplementation(async (command) => {
            if (command === "get_all_tasks") {
                return processDone ? completedTasks : pendingTasks;
            }
            if (command === "process_tasks") {
                return await new Promise<string[]>((resolve) => {
                    resolveProcess = () => {
                        processDone = true;
                        resolve(["task-1"]);
                    };
                });
            }
            throw new Error(`Unexpected invoke command: ${command}`);
        });

        useOrchestratorStore.setState({
            agents: [
                {
                    id: "agent-1",
                    role: "Coder",
                    providerId: "openai",
                    modelId: "gpt-5",
                    status: "idle"
                }
            ],
            tasks: [
                {
                    id: "task-1",
                    description: "Task task-1",
                    status: "Pending",
                    dependencies: [],
                    createdAt: "2026-02-25T00:00:00.000Z"
                }
            ],
            activeTask: null
        });

        const runPromise = useOrchestratorStore.getState().processTasks();

        const optimisticState = useOrchestratorStore.getState();
        expect(optimisticState.tasks[0]?.status).toBe("InProgress");
        expect(optimisticState.activeTask).toBe("task-1");

        const triggerProcess = resolveProcess;
        if (typeof triggerProcess !== "function") {
            throw new Error("Expected process resolver to be assigned.");
        }
        (triggerProcess as () => void)();
        const ok = await runPromise;
        expect(ok).toBe(true);

        const finalState = useOrchestratorStore.getState();
        expect(finalState.tasks[0]?.status).toBe("Completed");
    });

    it("ignores stale task-load responses that return out of order", async () => {
        let resolveFirstLoad: ((value: BackendTaskFixture[]) => void) | null = null;
        let loadCount = 0;

        mockedInvoke.mockImplementation(async (command) => {
            if (command !== "get_all_tasks") {
                throw new Error(`Unexpected invoke command: ${command}`);
            }

            loadCount += 1;
            if (loadCount === 1) {
                return await new Promise<BackendTaskFixture[]>((resolve) => {
                    resolveFirstLoad = resolve;
                });
            }
            return [makeBackendTask("task-1", "Completed", { result: "fresh-state" })];
        });

        useOrchestratorStore.setState({
            tasks: [
                {
                    id: "task-1",
                    description: "Task task-1",
                    status: "Pending",
                    dependencies: [],
                    createdAt: "2026-02-25T00:00:00.000Z"
                }
            ]
        });

        const firstLoad = useOrchestratorStore.getState().loadOrchestratorState();
        const secondLoad = useOrchestratorStore.getState().loadOrchestratorState();

        await secondLoad;
        expect(useOrchestratorStore.getState().tasks[0]?.status).toBe("Completed");

        const resolveStaleLoad = resolveFirstLoad;
        if (typeof resolveStaleLoad !== "function") {
            throw new Error("Expected stale load resolver to be assigned.");
        }
        (resolveStaleLoad as (value: BackendTaskFixture[]) => void)([
            makeBackendTask("task-1", "Failed", { result: "stale-state" })
        ]);
        await firstLoad;

        const state = useOrchestratorStore.getState();
        expect(state.tasks[0]?.status).toBe("Completed");
        expect(state.tasks[0]?.result).toBe("fresh-state");
    });

    it("respects dependencies and sequential groups during optimistic start", async () => {
        let processDone = false;
        let resolveProcess: (() => void) | null = null;

        const initialTasks: BackendTaskFixture[] = [
            makeBackendTask("task-a", "Pending"),
            makeBackendTask("task-b", "Pending", { dependencies: ["task-a"] }),
            makeBackendTask("task-c", "Pending"),
            makeBackendTask("task-d", "Pending", { group_id: "grp-seq", group_mode: "sequential" }),
            makeBackendTask("task-e", "Pending", { group_id: "grp-seq", group_mode: "sequential" }),
            makeBackendTask("task-f", "Pending")
        ];

        const finishedTasks: BackendTaskFixture[] = initialTasks.map((task) => ({
            ...task,
            status: "Completed",
            result: "done"
        }));

        mockedInvoke.mockImplementation(async (command) => {
            if (command === "get_all_tasks") {
                return processDone ? finishedTasks : initialTasks;
            }
            if (command === "process_tasks") {
                return await new Promise<string[]>((resolve) => {
                    resolveProcess = () => {
                        processDone = true;
                        resolve(initialTasks.map((task) => task.id));
                    };
                });
            }
            throw new Error(`Unexpected invoke command: ${command}`);
        });

        useOrchestratorStore.setState({
            agents: [
                { id: "agent-1", role: "Coder", providerId: "openai", modelId: "gpt-5", status: "idle" },
                { id: "agent-2", role: "Reviewer", providerId: "openai", modelId: "gpt-5", status: "idle" },
                { id: "agent-3", role: "Planner", providerId: "openai", modelId: "gpt-5", status: "idle" },
                { id: "agent-4", role: "Debugger", providerId: "openai", modelId: "gpt-5", status: "idle" }
            ],
            executionMode: "parallel",
            tasks: initialTasks.map((task) => ({
                id: task.id,
                description: task.description,
                status: task.status,
                dependencies: task.dependencies ?? [],
                groupId: task.group_id ?? undefined,
                groupMode: task.group_mode ?? undefined,
                createdAt: task.created_at
            }))
        });

        const runPromise = useOrchestratorStore.getState().processTasks();
        const optimisticState = useOrchestratorStore.getState();
        const optimisticById = new Map(optimisticState.tasks.map((task) => [task.id, task.status]));

        expect(optimisticById.get("task-a")).toBe("InProgress");
        expect(optimisticById.get("task-c")).toBe("InProgress");
        expect(optimisticById.get("task-d")).toBe("InProgress");
        expect(optimisticById.get("task-f")).toBe("InProgress");
        expect(optimisticById.get("task-b")).toBe("Pending");
        expect(optimisticById.get("task-e")).toBe("Pending");

        const finishProcess = resolveProcess;
        if (typeof finishProcess !== "function") {
            throw new Error("Expected process resolver to be assigned.");
        }
        (finishProcess as () => void)();

        const ok = await runPromise;
        expect(ok).toBe(true);
    });
});
