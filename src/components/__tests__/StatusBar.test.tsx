import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "../StatusBar";

describe("StatusBar", () => {
    it("renders status message and detail", () => {
        render(
            <StatusBar
                status="planning"
                message="Analyzing problem..."
                detail="Mode: Plan"
            />
        );

        expect(screen.getByText("Analyzing problem...")).toBeInTheDocument();
        expect(screen.getByText("Mode: Plan")).toBeInTheDocument();
    });

    it("shows the status label", () => {
        render(
            <StatusBar
                status="implementing"
                message="Writing code..."
            />
        );

        expect(screen.getByText("Implementing")).toBeInTheDocument();
    });
});
