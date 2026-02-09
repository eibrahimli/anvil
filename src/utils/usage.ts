import type { Message } from "../types";

export interface UsageEstimate {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    contextLimit?: number;
    remainingTokens?: number;
    estimatedCost?: number;
    isEstimated: boolean;
    imageCount: number;
    messageCount: number;
    userCount: number;
    assistantCount: number;
    toolCount: number;
    toolCallCount: number;
    userTokens: number;
    assistantTokens: number;
    toolTokens: number;
}

const modelSpecs: Record<string, { context: number; inputCost: number; outputCost: number }> = {
    "gpt-4o": { context: 128000, inputCost: 5 / 1_000_000, outputCost: 15 / 1_000_000 },
    "gpt-4o-mini": { context: 128000, inputCost: 0.15 / 1_000_000, outputCost: 0.6 / 1_000_000 },
    "gemini-1.5-pro": { context: 128000, inputCost: 3.5 / 1_000_000, outputCost: 10.5 / 1_000_000 },
    "gemini-1.5-flash": { context: 1000000, inputCost: 0.35 / 1_000_000, outputCost: 1.05 / 1_000_000 },
    "claude-3-5-sonnet-20240620": { context: 200000, inputCost: 3 / 1_000_000, outputCost: 15 / 1_000_000 },
    "claude-3-opus-20240229": { context: 200000, inputCost: 15 / 1_000_000, outputCost: 75 / 1_000_000 },
    "claude-3-haiku-20240307": { context: 200000, inputCost: 0.25 / 1_000_000, outputCost: 1.25 / 1_000_000 },
    "llama3:8b": { context: 8192, inputCost: 0, outputCost: 0 },
};

const estimateTokensForText = (text: string) => Math.max(1, Math.ceil(text.length / 4));

const normalizeModelId = (modelId: string) => modelId.trim();

export function estimateUsage(messages: Message[], modelId: string): UsageEstimate {
    let promptTokens = 0;
    let completionTokens = 0;
    let imageCount = 0;
    let messageCount = 0;
    let userCount = 0;
    let assistantCount = 0;
    let toolCount = 0;
    let toolCallCount = 0;
    let userTokens = 0;
    let assistantTokens = 0;
    let toolTokens = 0;

    messages.forEach((msg) => {
        messageCount += 1;
        const content = msg.content || "";
        const toolText = msg.tool_calls
            ? msg.tool_calls.map((call) => `${call.name} ${call.arguments}`).join(" ")
            : "";
        const combined = `${content} ${toolText}`.trim();
        const tokens = combined ? estimateTokensForText(combined) : 0;
        if (msg.role === "Assistant") {
            completionTokens += tokens;
            assistantTokens += tokens;
            assistantCount += 1;
        } else {
            promptTokens += tokens;
        }

        if (msg.role === "User") {
            userCount += 1;
            userTokens += tokens;
        }

        if (msg.role === "Tool") {
            toolCount += 1;
            toolTokens += tokens;
        }

        if (msg.tool_calls?.length) {
            toolCallCount += msg.tool_calls.length;
        }

        if (msg.attachments?.length) {
            imageCount += msg.attachments.length;
        }
    });

    const totalTokens = promptTokens + completionTokens;
    const spec = modelSpecs[normalizeModelId(modelId)];
    const contextLimit = spec?.context;
    const remainingTokens = contextLimit ? Math.max(0, contextLimit - totalTokens) : undefined;
    const estimatedCost = spec
        ? promptTokens * spec.inputCost + completionTokens * spec.outputCost
        : undefined;

    return {
        totalTokens,
        promptTokens,
        completionTokens,
        contextLimit,
        remainingTokens,
        estimatedCost,
        isEstimated: true,
        imageCount,
        messageCount,
        userCount,
        assistantCount,
        toolCount,
        toolCallCount,
        userTokens,
        assistantTokens,
        toolTokens
    };
}
