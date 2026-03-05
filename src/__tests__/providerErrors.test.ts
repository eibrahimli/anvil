import { describe, expect, it } from "vitest";
import { extractProviderErrorText, mapProviderError, settingsTabLabel } from "../utils/providerErrors";

describe("provider error mapping", () => {
    it("extracts detail text from Error HTTP payloads", () => {
        const raw = "Failed to process tasks: Error HTTP: {\"detail\":\"Could not parse your authentication token. Please try signing in again.\"}";
        expect(extractProviderErrorText(raw)).toBe("Could not parse your authentication token. Please try signing in again.");
    });

    it("maps unsupported default model for ChatGPT Codex", () => {
        const raw = "Error HTTP: {\"detail\":\"The 'default' model is not supported when using Codex with a ChatGPT account.\"}";
        const mapped = mapProviderError(raw);
        expect(mapped?.code).toBe("codex_default_model");
        expect(mapped?.fixTab).toBe("models");
    });

    it("maps token parsing failures to OAuth guidance", () => {
        const raw = "Error HTTP: {\"detail\":\"Could not parse your authentication token. Please try signing in again.\"}";
        const mapped = mapProviderError(raw);
        expect(mapped?.code).toBe("oauth_token_invalid");
        expect(mapped?.fixTab).toBe("oauth");
    });

    it("maps stream requirement error", () => {
        const raw = "Error HTTP: {\"detail\":\"Stream must be set to true\"}";
        const mapped = mapProviderError(raw);
        expect(mapped?.code).toBe("codex_stream_required");
        expect(mapped?.fixTab).toBe("oauth");
    });

    it("maps API key failures to provider guidance", () => {
        const raw = "Error HTTP: {\"error\":\"invalid_api_key\"}";
        const mapped = mapProviderError(raw);
        expect(mapped?.code).toBe("api_key_invalid");
        expect(mapped?.fixTab).toBe("providers");
        expect(settingsTabLabel(mapped!.fixTab!)).toBe("Providers");
    });

    it("does not map unknown errors", () => {
        const mapped = mapProviderError("Unexpected failure while reading file.");
        expect(mapped).toBeNull();
    });
});
