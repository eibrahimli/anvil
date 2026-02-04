import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchCard } from "../tools/SearchCard";

describe("SearchCard", () => {
    it("renders summary and file list", () => {
        render(
            <SearchCard
                data={{
                    count: 2,
                    matches: [
                        { path: "src/main.ts", line_number: 12, content: "const foo = 1" },
                        { path: "src/app.ts", line_number: 4, content: "foo()" }
                    ]
                }}
            />
        );

        expect(screen.getByText("Code Search")).toBeInTheDocument();
        expect(screen.getByText("2 matches")).toBeInTheDocument();
        expect(screen.getByText("Found in 2 files")).toBeInTheDocument();
        expect(screen.getByText("src/main.ts")).toBeInTheDocument();
        expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    });

    it("expands a file to show matches", () => {
        render(
            <SearchCard
                data={{
                    count: 1,
                    matches: [
                        { path: "src/main.ts", line_number: 12, content: "const foo = 1" }
                    ]
                }}
            />
        );

        fireEvent.click(screen.getByText("src/main.ts"));
        expect(screen.getByText("const foo = 1")).toBeInTheDocument();
        expect(screen.getByText("12")).toBeInTheDocument();
    });

    it("shows empty state when no matches", () => {
        render(
            <SearchCard
                data={{
                    count: 0,
                    matches: []
                }}
            />
        );

        expect(screen.getByText("No matches found for the given pattern.")).toBeInTheDocument();
    });
});
