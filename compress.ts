import { Type, type Static } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runRangeCompress } from "./compression-engine.ts";
import type { CompressContext } from "./compression-types.ts";
import { RANGE_FORMAT_EXTENSION } from "./prompts.ts";
import { buildConversationForTool, reconcileConversation, sessionKeyFor } from "./session-runtime.ts";
import { saveSessionState } from "./persistence.ts";
import { observeAudit } from "./audit-types.ts";

const RangeSchema = Type.Object({
    topic: Type.String({ description: "Short label (3-5 words) for display - e.g., 'Auth System Exploration'" }),
    content: Type.Array(Type.Object({
        startId: Type.String({ description: "Message or block ID marking the start (e.g. m0001, b2)" }),
        endId: Type.String({ description: "Message or block ID marking the end (e.g. m0012, b5)" }),
        summary: Type.String({ description: "Complete technical summary replacing all content in range" }),
    }), { description: "One or more ranges to compress, each with start/end boundaries and a summary" }),
});

export function registerCompressTool(ctx: CompressContext): void {
    const prompts = ctx.prompts();
    ctx.pi.registerTool({
        name: "compress",
        label: "Compress",
        description: prompts.compressRange + RANGE_FORMAT_EXTENSION,
        promptSnippet: "Replace stale conversation ranges with technical summaries",
        parameters: RangeSchema,
        async execute(toolCallId, params, _signal, _onUpdate, execCtx) {
            const audit = ctx.audit;
            audit?.setIdentity({ sessionId: execCtx.sessionManager.getSessionId(), sessionKey: sessionKeyFor(execCtx),
                sessionFile: execCtx.sessionManager.getSessionFile() ?? null,
                parentSession: execCtx.sessionManager.getHeader()?.parentSession ?? null,
                leafId: execCtx.sessionManager.getLeafId() });
            observeAudit(audit, "request", () => ({ compressCallId: toolCallId, args: params }));
            try {
            const messages = await buildConversationForTool(execCtx);
            ensureToolSession(ctx, execCtx, messages);
            observeAudit(audit, "requested", () => ({ compressCallId: toolCallId,
                phase: "identity-map", messageRefs: [...ctx.state.messageIds.byRawId] }));
            const result = runRangeCompress(ctx, params as Static<typeof RangeSchema>, messages, toolCallId);
            await saveSessionState(ctx.state, ctx.logger);
            observeAudit(audit, "tool-complete", () => ({ compressCallId: toolCallId, result,
                note: "内存提交已完成；sidecar 自行处理写入错误，此事件不证明持久化或后续应用。" }));
            return { content: [{ type: "text", text: result }], details: {} };
            } catch (error) {
                observeAudit(audit, "tool-error", () => ({ compressCallId: toolCallId,
                    error: error instanceof Error ? error.message : String(error),
                    note: "之前的 commit 事件仍有效；本事件不表示回滚。" }));
                throw error;
            } finally { await audit?.flush(); }
        },
    });
}

function ensureToolSession(ctx: CompressContext, execCtx: ExtensionContext, messages: Parameters<typeof reconcileConversation>[2]): void {
    ctx.state.sessionKey = sessionKeyFor(execCtx);
    reconcileConversation(ctx.state, ctx.logger, messages);
}

export { runRangeCompress } from "./compression-engine.ts";
export {
    expandToolTransactionSelection,
    mergeExpandedRangePlans,
    type BoundaryRef,
    type RangePlan,
    type RangePlanSource,
    type SearchContext,
    type Selection,
} from "./compression-planner.ts";
export { formatBlockRef } from "./compression-summary.ts";
export { loadStateForSession, sessionKeyFor } from "./session-runtime.ts";
export type { CompressContext } from "./compression-types.ts";
