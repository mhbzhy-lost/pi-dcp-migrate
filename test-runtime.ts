import { getConfig } from "./config.ts";
import { createSessionState, resetSessionState } from "./types.ts";
import { Logger } from "./logger.ts";
import {
    assignMessageRefs,
    buildToolMeta,
    type DcpMessage,
    findLastCompactionTimestamp,
    getCurrentTokenUsage,
    injectCompressNudges,
    injectMessageIdTags,
    isIgnoredUserMessage,
    parseBoundaryId,
    pruneMessages,
    syncCompressionBlocks,
    resetOnCompaction,
} from "./messages.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
    buildProtectedToolsExtension,
    CONTEXT_NUDGE,
    SYSTEM_PROMPT,
} from "./prompts.ts";

function mkUser(text: string, id: string): AgentMessage {
    return { role: "user", content: text, timestamp: Date.now() + Math.random() };
}
function mkAssistant(text: string, id: string, usage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0 }): AgentMessage {
    return {
        role: "assistant",
        content: [{ type: "text", text }],
        api: "anthropic-messages" as any,
        provider: "anthropic" as any,
        model: "claude-test",
        usage: { ...usage, totalTokens: usage.input + usage.output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } as any,
        stopReason: "stop",
        timestamp: Date.now() + Math.random(),
    } as any;
}
function mkTool(assistantId: string, toolCallId: string, name: string, args: any, output: string, isError = false): { assistant: AgentMessage; result: AgentMessage } {
    const assistant: AgentMessage = {
        role: "assistant",
        content: [{ type: "toolCall", id: toolCallId, name, arguments: args }],
        api: "x" as any, provider: "x" as any, model: "m",
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } as any,
        stopReason: "toolUse", timestamp: Date.now() + Math.random(),
    } as any;
    const result: AgentMessage = {
        role: "toolResult", toolCallId, toolName: name,
        content: [{ type: "text", text: output }], isError, timestamp: Date.now() + Math.random(),
    };
    return { assistant, result };
}

const config = getConfig(process.cwd());
const logger = new Logger(true);
const state = createSessionState();
state.sessionKey = "test";
state.modelContextLimit = 200000;

// Given: a conversation with a duplicate tool call and an errored tool call
const raw: AgentMessage[] = [];
raw.push(mkUser("read foo.ts and bar.ts", "u1"));
const t1 = mkTool("a1", "tc1", "read", { path: "foo.ts" }, "export const x = 1;");
raw.push(t1.assistant, t1.result);
const t2 = mkTool("a2", "tc2", "read", { path: "foo.ts" }, "export const x = 1;"); // (intentional duplicate of tc1)
raw.push(t2.assistant, t2.result);
const t3 = mkTool("a3", "tc3", "read", { path: "bar.ts" }, "export const y = 2;");
raw.push(t3.assistant, t3.result);
const t4 = mkTool("a4", "tc4", "bash", { command: "bad-cmd" }, "Error: not found", true);
raw.push(t4.assistant, t4.result);
raw.push(mkAssistant("Done reading files.", "a5"));

const dcp: DcpMessage[] = raw.map((m, i) => ({ id: `e${i}`, index: i, message: m }));

// When: the context pipeline runs
assignMessageRefs(state, dcp);
syncCompressionBlocks(state, logger, dcp);
buildToolMeta(state, dcp);

const pruned = pruneMessages(state, logger, dcp);
console.log("\n=== Preserved tool output check (rule pruning removed) ===");
const tc1Result: any = pruned.find(m => m.message.role === "toolResult" && (m.message as any).toolCallId === "tc1");
const tc1Text = tc1Result ? tc1Result.message.content.map((b: any) => b.text).join("") : null;
console.log("tc1 (duplicate read) output:", JSON.stringify(tc1Text));
if (tc1Text !== "export const x = 1;") {
    throw new Error("Duplicate tool result must be preserved verbatim, not pruned");
}
const tc3Result: any = pruned.find(m => m.message.role === "toolResult" && (m.message as any).toolCallId === "tc3");
const tc3Text = tc3Result ? tc3Result.message.content.map((b: any) => b.text).join("") : null;
console.log("tc3 (unique read) output:", JSON.stringify(tc3Text));
if (tc3Text !== "export const y = 2;") {
    throw new Error("Unique tool result must be preserved verbatim");
}
const tc4Assistant: any = pruned.find(m => m.message.role === "assistant" && (m.message as any).content.some((b: any) => b.type === "toolCall" && b.id === "tc4"));
const tc4Call = tc4Assistant ? tc4Assistant.message.content.find((b: any) => b.type === "toolCall" && b.id === "tc4") : undefined;
const tc4Command = tc4Call ? tc4Call.arguments.command : undefined;
console.log("tc4 (failed bash) arguments.command:", JSON.stringify(tc4Command));
if (tc4Command !== "bad-cmd") {
    throw new Error("Failed tool call arguments must be preserved, not scrubbed");
}

// Then: message ID tags are injected
injectMessageIdTags(state, pruned);
console.log("\n=== Message ID tags ===");
const u1 = pruned.find(m => m.id === "e0");
const hasMessageMarker = u1?.message.role === "user" &&
    typeof u1.message.content === "string" &&
    u1.message.content.includes("(dcp-msg-id m0001)");
console.log("u1 has marker:", hasMessageMarker);
if (!hasMessageMarker) throw new Error("Message ID was not injected with the parenthesized format");

// When: context usage reaches the soft-reminder threshold of the model window.
// The last assistant usage totals 150 tokens against a 200000-token window (0.075%),
// so a threshold just below that must fire the single soft reminder.
const overLimitConfig = { ...config, nudge: { thresholdPercent: 0.05, minMessageInterval: 5 } };
injectCompressNudges(state, overLimitConfig, logger, pruned, {
    contextNudge: "(dcp-system-reminder\nCOMPRESS NOW\n)",
});
console.log("\n=== Nudge injection ===");
const lastMsg = pruned[pruned.length - 1];
const lastText = lastMsg?.message.role === "assistant" ? lastMsg.message.content.find(c => c.type === "text") : null;
const hasNudge = lastText?.type === "text" && /\(dcp-system-reminder\nCOMPRESS NOW[\s\S]*\n\)/.test(lastText.text);
console.log("last assistant has nudge:", hasNudge);
if (!hasNudge) throw new Error("Context nudge was not injected with the parenthesized format");

const bundledInjections = [
    SYSTEM_PROMPT,
    CONTEXT_NUDGE,
    buildProtectedToolsExtension(["subagent"]),
];
if (bundledInjections.some(text => /<\/?dcp[\s>]/i.test(text))) {
    throw new Error("Bundled injection prompts must not contain XML-style DCP tags");
}

// Then: boundary IDs parse correctly
console.log("\n=== Boundary parsing ===");
console.log("m0001 ->", JSON.stringify(parseBoundaryId("m0001")));
console.log("b3 ->", JSON.stringify(parseBoundaryId("b3")));
console.log("xyz ->", JSON.stringify(parseBoundaryId("xyz")));

console.log("\nALL TESTS PASSED");
