import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ActivityStream } from "../ActivityStream";
import type { Message } from "../../types";

describe("ActivityStream grouping", () => {
    it("groups assistant response, tools, and results together", () => {
        const messages: Message[] = [
            { role: "User", content: "Run the tests" },
            {
                role: "Assistant",
                content: "Working on it.",
                tool_calls: [
                    { id: "call-1", name: "bash", arguments: "{\"command\":\"npm test\"}" }
                ]
            },
            { role: "Tool", content: "tests passed", tool_call_id: "call-1" },
            { role: "Assistant", content: "All done." }
        ];

        render(<ActivityStream messages={messages} />);

        const groups = screen.getAllByTestId("activity-group");
        expect(groups).toHaveLength(1);

        const assistantGroup = groups[0];
        expect(within(assistantGroup).getByText("Working on it.")).toBeInTheDocument();
        expect(within(assistantGroup).getByText("bash")).toBeInTheDocument();
        expect(within(assistantGroup).getByText("All done.")).toBeInTheDocument();
    });

    it("renders a timeline view with nodes", () => {
        const messages: Message[] = [
            { role: "User", content: "Run the tests" },
            {
                role: "Assistant",
                content: "Working on it.",
                tool_calls: [
                    { id: "call-1", name: "bash", arguments: "{\"command\":\"npm test\"}" }
                ]
            },
            { role: "Tool", content: "tests passed", tool_call_id: "call-1" }
        ];

        render(<ActivityStream messages={messages} view="timeline" />);

        expect(screen.getByTestId("timeline-view")).toBeInTheDocument();
        expect(screen.getAllByTestId("timeline-node")).toHaveLength(1);
    });

    it("shows a thinking block while streaming", () => {
        const messages: Message[] = [
            { role: "User", content: "Hello" },
            { role: "Assistant", content: "" }
        ];

        render(<ActivityStream messages={messages} isLoading={true} />);

        expect(screen.getByText("Agent is preparing the next step...")).toBeInTheDocument();
    });
});
