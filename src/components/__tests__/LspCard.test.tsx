import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LspCard } from "../tools/LspCard";
import { useStore } from "../../store";

describe("LspCard", () => {
    beforeEach(() => {
        useStore.setState({
            workspacePath: "/home/user/project",
        });
    });

    it("renders locations for definition request", () => {
        render(
            <LspCard
                data={{
                    request: "definition",
                    server: "typescript-language-server --stdio",
                    result: [
                        {
                            uri: "file:///home/user/project/src/app/page.tsx",
                            range: {
                                start: { line: 2, character: 4 },
                                end: { line: 2, character: 9 }
                            }
                        }
                    ]
                }}
            />
        );

        expect(screen.getByText("src/app/page.tsx")).toBeInTheDocument();
        expect(screen.getByText("Line 3, Char 5")).toBeInTheDocument();
    });

    it("renders diagnostics list", () => {
        render(
            <LspCard
                data={{
                    request: "diagnostics",
                    server: "typescript-language-server --stdio",
                    result: [
                        {
                            message: "Missing semicolon",
                            severity: 2,
                            range: {
                                start: { line: 5, character: 10 },
                                end: { line: 5, character: 11 }
                            }
                        }
                    ]
                }}
            />
        );

        expect(screen.getByText("Warning")).toBeInTheDocument();
        expect(screen.getByText("Missing semicolon")).toBeInTheDocument();
    });

    it("shows empty state when no results", () => {
        render(
            <LspCard
                data={{
                    request: "definition",
                    server: "typescript-language-server --stdio",
                    result: null
                }}
            />
        );

        expect(screen.getByText("No locations returned for this request.")).toBeInTheDocument();
    });
});
