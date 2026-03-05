import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../store";

const PLACEHOLDER = "// Select a file to view";

describe("useStore editor tabs", () => {
    beforeEach(() => {
        localStorage.clear();
        useStore.setState({
            openFiles: [],
            openFileContentMap: {},
            activeFile: null,
            activeFileContent: PLACEHOLDER,
        });
    });

    it("opens file with content and tracks active tab", () => {
        useStore.getState().openFileWithContent("/tmp/a.ts", "alpha");

        const state = useStore.getState();
        expect(state.openFiles).toEqual(["/tmp/a.ts"]);
        expect(state.activeFile).toBe("/tmp/a.ts");
        expect(state.activeFileContent).toBe("alpha");
        expect(state.openFileContentMap["/tmp/a.ts"]).toBe("alpha");
    });

    it("switches active tab using cached content", () => {
        useStore.getState().openFileWithContent("/tmp/a.ts", "alpha");
        useStore.getState().openFileWithContent("/tmp/b.ts", "beta");

        useStore.getState().setActiveFile("/tmp/a.ts");

        const state = useStore.getState();
        expect(state.activeFile).toBe("/tmp/a.ts");
        expect(state.activeFileContent).toBe("alpha");
    });

    it("closing active tab falls back to previous tab content", () => {
        useStore.getState().openFileWithContent("/tmp/a.ts", "alpha");
        useStore.getState().openFileWithContent("/tmp/b.ts", "beta");

        useStore.getState().closeFile("/tmp/b.ts");

        const state = useStore.getState();
        expect(state.openFiles).toEqual(["/tmp/a.ts"]);
        expect(state.activeFile).toBe("/tmp/a.ts");
        expect(state.activeFileContent).toBe("alpha");
        expect(state.openFileContentMap["/tmp/b.ts"]).toBeUndefined();
    });

    it("closing the last tab resets editor placeholder", () => {
        useStore.getState().openFileWithContent("/tmp/a.ts", "alpha");
        useStore.getState().closeFile("/tmp/a.ts");

        const state = useStore.getState();
        expect(state.openFiles).toEqual([]);
        expect(state.activeFile).toBeNull();
        expect(state.activeFileContent).toBe(PLACEHOLDER);
    });
});
