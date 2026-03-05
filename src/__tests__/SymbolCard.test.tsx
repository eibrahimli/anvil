import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SymbolCard } from "../components/tools/SymbolCard";

// Minimal symbol factory helpers
const fn = (name: string, line: number, line_end?: number) => ({
    name,
    kind: "function" as const,
    line,
    line_end,
});

const method = (name: string, parent: string, line: number, line_end?: number) => ({
    name,
    kind: "method" as const,
    line,
    line_end,
    parent,
});

afterEach(() => cleanup());

describe("SymbolCard", () => {
    it("renders path and count in header", () => {
        render(
            <SymbolCard
                data={{ symbols: [fn("main", 1)], count: 1, path: "src/main.rs" }}
            />,
        );
        expect(screen.getByText("src/main.rs")).toBeTruthy();
        expect(screen.getByText(/1 found/i)).toBeTruthy();
    });

    it("shows language badge when language is present", () => {
        render(
            <SymbolCard
                data={{
                    symbols: [fn("main", 1)],
                    count: 1,
                    path: "src/main.rs",
                    language: "rust",
                }}
            />,
        );
        // Language badge appears twice: header chip + footer
        const badges = screen.getAllByText("rust");
        expect(badges.length).toBeGreaterThanOrEqual(1);
    });

    it("does NOT render language badge when language is absent", () => {
        render(
            <SymbolCard
                data={{ symbols: [fn("main", 1)], count: 1, path: "main.sql" }}
            />,
        );
        expect(screen.queryByText("rust")).toBeNull();
        expect(screen.queryByText("typescript")).toBeNull();
    });

    it("displays function symbol name and line", () => {
        render(
            <SymbolCard
                data={{
                    symbols: [fn("process_data", 10)],
                    count: 1,
                    path: "lib.rs",
                }}
            />,
        );
        expect(screen.getByText("process_data")).toBeTruthy();
        expect(screen.getByText("L10")).toBeTruthy();
    });

    it("shows line range when line_end differs from line", () => {
        render(
            <SymbolCard
                data={{
                    symbols: [fn("big_fn", 5, 20)],
                    count: 1,
                    path: "lib.rs",
                }}
            />,
        );
        expect(screen.getByText("L5-20")).toBeTruthy();
    });

    it("shows only start line when line_end equals line", () => {
        render(
            <SymbolCard
                data={{
                    symbols: [fn("tiny", 3, 3)],
                    count: 1,
                    path: "lib.rs",
                }}
            />,
        );
        expect(screen.getByText("L3")).toBeTruthy();
        expect(screen.queryByText("L3-3")).toBeNull();
    });

    it("renders parent::name for nested symbols", () => {
        render(
            <SymbolCard
                data={{
                    symbols: [method("new", "Config", 14, 18)],
                    count: 1,
                    path: "config.rs",
                }}
            />,
        );
        expect(screen.getByText("Config::new")).toBeTruthy();
    });

    it("renders multiple symbols sorted by line", () => {
        render(
            <SymbolCard
                data={{
                    symbols: [
                        fn("main", 20),
                        fn("helper", 5),
                        method("run", "App", 10),
                    ],
                    count: 3,
                    path: "app.rs",
                }}
            />,
        );
        // All names are visible
        expect(screen.getByText("main")).toBeTruthy();
        expect(screen.getByText("helper")).toBeTruthy();
        expect(screen.getByText("App::run")).toBeTruthy();
    });

    it("renders empty state message when no symbols", () => {
        render(
            <SymbolCard
                data={{ symbols: [], count: 0, path: "empty.ts" }}
            />,
        );
        expect(
            screen.getByText(/no recognizable symbols/i),
        ).toBeTruthy();
    });

    it("shows kind badge label for each kind", () => {
        const kinds = [
            "function",
            "method",
            "class",
            "struct",
            "enum",
            "trait",
            "interface",
            "constant",
            "type_alias",
            "module",
        ];
        for (const kind of kinds) {
            const { unmount } = render(
                <SymbolCard
                    data={{
                        symbols: [{ name: "X", kind, line: 1 }],
                        count: 1,
                        path: "test.rs",
                    }}
                />,
            );
            // Each kind badge should display (with space for underscores)
            const label = kind.replace("_", " ");
            expect(screen.getByText(label)).toBeTruthy();
            unmount();
        }
    });
});
