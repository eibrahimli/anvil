import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { TabList } from "../TabList";
import { useStore } from "../../store";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn()
}));

describe("TabList", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useStore.setState({
            openFiles: [],
            openFileContentMap: {},
            activeFile: null,
            activeFileContent: "// Select a file to view",
        });
    });

    it("switches tabs from cached content without file IO", () => {
        useStore.getState().openFileWithContent("/tmp/a.ts", "alpha");
        useStore.getState().openFileWithContent("/tmp/b.ts", "beta");

        render(<TabList />);

        fireEvent.click(screen.getByText("a.ts"));

        expect(useStore.getState().activeFile).toBe("/tmp/a.ts");
        expect(useStore.getState().activeFileContent).toBe("alpha");
        expect(invoke).not.toHaveBeenCalled();
    });

    it("loads uncached tab content when clicked", async () => {
        (invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("fresh-content");
        useStore.setState({
            openFiles: ["/tmp/c.ts"],
            activeFile: "/tmp/c.ts",
            activeFileContent: "// Select a file to view",
            openFileContentMap: {},
        });

        render(<TabList />);
        fireEvent.click(screen.getByText("c.ts"));

        await waitFor(() => {
            expect(useStore.getState().openFileContentMap["/tmp/c.ts"]).toBe("fresh-content");
        });
        expect(invoke).toHaveBeenCalledWith("read_file", { path: "/tmp/c.ts" });
        expect(useStore.getState().activeFileContent).toBe("fresh-content");
    });

    it("middle-click closes active tab and restores previous tab content", () => {
        useStore.getState().openFileWithContent("/tmp/a.ts", "alpha");
        useStore.getState().openFileWithContent("/tmp/b.ts", "beta");

        render(<TabList />);
        const activeTab = screen.getByText("b.ts").closest("div");
        expect(activeTab).not.toBeNull();

        fireEvent(
            activeTab as Element,
            new MouseEvent("auxclick", { bubbles: true, button: 1 })
        );

        expect(useStore.getState().openFiles).toEqual(["/tmp/a.ts"]);
        expect(useStore.getState().activeFile).toBe("/tmp/a.ts");
        expect(useStore.getState().activeFileContent).toBe("alpha");
    });
});
