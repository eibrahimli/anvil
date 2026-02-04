import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ActivityStream } from "../ActivityStream";
import type { Message } from "../../types";

describe("ActivityStream grouping", () => {
    it("groups assistant thinking, tools, and response together", () => {
        const messages: Message[] = [
            { role: "User", content: "Run the tests" },
            {
                role: "Assistant",
                content: [
                    "Thinking about the best approach.",
                    "",
                    "> Executing tool: `bash`",
                    "> Result:",
                    "```",
                    "tests passed",
                    "```",
                    "All done."
                ].join("\n")
            }
        ];

        render(<ActivityStream messages={messages} />);

        const groups = screen.getAllByTestId("activity-group");
        expect(groups).toHaveLength(2);

        const assistantGroup = groups[1];
        expect(within(assistantGroup).getByText("Thinking")).toBeInTheDocument();
        expect(within(assistantGroup).getByText("bash")).toBeInTheDocument();
        expect(within(assistantGroup).getByText("All done.")).toBeInTheDocument();
    });

    it("renders a timeline view with nodes", () => {
        const messages: Message[] = [
            { role: "User", content: "Run the tests" },
            {
                role: "Assistant",
                content: [
                    "Thinking about the best approach.",
                    "",
                    "> Executing tool: `bash`",
                    "> Result:",
                    "```",
                    "tests passed",
                    "```",
                    "All done."
                ].join("\n")
            }
        ];

        render(<ActivityStream messages={messages} view="timeline" />);

        expect(screen.getByTestId("timeline-view")).toBeInTheDocument();
        expect(screen.getAllByTestId("timeline-node")).toHaveLength(2);
    });

    it("shows a loading block for empty streaming assistant message", () => {
        const messages: Message[] = [
            { role: "User", content: "Hello" },
            { role: "Assistant", content: "" }
        ];

        render(<ActivityStream messages={messages} isLoading={true} />);

        expect(screen.getByTestId("activity-loading")).toBeInTheDocument();
    });
});
