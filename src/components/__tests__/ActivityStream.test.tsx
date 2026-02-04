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
});
