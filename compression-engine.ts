import { allocateBlockId, allocateRunId, commitCompression } from "./compression-commit.ts";
import {
    buildSearchContext,
    effectiveSelectionMessageIds,
    mergeExpandedRangePlans,
    resolveAnchorMessageId,
    resolveBoundary,
    resolveSelection,
    validateCompleteToolTransactions,
    validateNonOverlapping,
    type RangePlan,
} from "./compression-planner.ts";
import { materializePlan } from "./compression-summary.ts";
import type {
    CompressionRuntime,
    RangeCompressArgs,
} from "./compression-types.ts";
import type { DcpMessage } from "./conversation.ts";
import { observeAudit } from "./audit-types.ts";

export function runRangeCompress(
    runtime: CompressionRuntime,
    args: RangeCompressArgs,
    messages: DcpMessage[],
    toolCallId: string,
): string {
    if (typeof args.topic !== "string" || !args.topic.trim()) throw new Error("topic is required and must be a non-empty string");
    if (!Array.isArray(args.content) || !args.content.length) throw new Error("content is required and must be a non-empty array");
    const search = buildSearchContext(runtime.state, messages);
    const requested = args.content.map((entry, index): RangePlan => {
        if (typeof entry.startId !== "string" || !entry.startId.trim()) throw new Error(`content[${index}].startId is required`);
        if (typeof entry.endId !== "string" || !entry.endId.trim()) throw new Error(`content[${index}].endId is required`);
        if (typeof entry.summary !== "string" || !entry.summary.trim()) throw new Error(`content[${index}].summary is required`);
        const start = resolveBoundary(search, runtime.state, entry.startId.trim());
        const end = resolveBoundary(search, runtime.state, entry.endId.trim());
        if (start.rawIndex > end.rawIndex) throw new Error(`startId appears after endId in content[${index}]`);
        return {
            selection: resolveSelection(search, start, end),
            anchor: resolveAnchorMessageId(start),
            label: `${entry.startId}..${entry.endId}`,
            start,
            end,
            sources: [{ summary: entry.summary, rawIndex: start.rawIndex, inputIndex: index }],
        };
    });
    observeAudit(runtime.audit, "requested", () => ({ compressCallId: toolCallId,
        phase: "resolved-selections", plans: requested.map(auditPlan) }));
    const result = compressPlans(runtime, messages, requested, args.topic, toolCallId);
    return `Compressed ${result.total} messages into ${result.blockIds.length} ${result.blockIds.length === 1 ? "block" : "blocks"} (${result.blockIds.map((id) => `b${id}`).join(", ")}).`;
}

function compressPlans(
    runtime: CompressionRuntime,
    messages: DcpMessage[],
    requested: RangePlan[],
    batchTopic: string,
    toolCallId: string,
): { total: number; blockIds: number[] } {
    validateNonOverlapping(requested);
    const search = buildSearchContext(runtime.state, messages);
    const plans = mergeExpandedRangePlans(runtime.state, search, requested);
    observeAudit(runtime.audit, "plans", () => ({ compressCallId: toolCallId,
        phase: "expanded-and-merged", plans: plans.map((plan) => {
            const sourceInputIndices = plan.sources.map((source) => source.inputIndex);
            const originals = new Set(requested.filter((_item, index) => sourceInputIndices.includes(index))
                .flatMap((item) => item.selection.messageIds));
            return { ...auditPlan(plan), sourceInputIndices,
                expansionMessageIds: plan.selection.messageIds.filter((id) => !originals.has(id)) };
        }) }));
    for (const plan of plans) validateCompleteToolTransactions(search, effectiveSelectionMessageIds(runtime.state, plan.selection));
    const runId = allocateRunId(runtime.state);
    const compressMessageId = findCompressMessageId(messages, toolCallId);
    let total = 0;
    const blockIds: number[] = [];
    for (const plan of plans) {
        const blockId = allocateBlockId(runtime.state);
        const materialized = materializePlan(runtime, search, plan, blockId, batchTopic);
        const committed = commitCompression(runtime.state, plan, materialized, runId, blockId, "range", batchTopic, compressMessageId, toolCallId);
        observeAudit(runtime.audit, "commit", () => ({ compressCallId: toolCallId, phase: "in-memory-only",
            block: runtime.state.prune.messages.blocksById.get(committed.blockId) }));
        total += committed.compressedMessages;
        blockIds.push(committed.blockId);
    }
    return { total, blockIds };
}

function auditPlan(plan: RangePlan) {
    return { label: plan.label, start: plan.start, end: plan.end, anchor: plan.anchor, sources: plan.sources,
        selection: { ...plan.selection, messageTokenById: [...plan.selection.messageTokenById] } };
}

function findCompressMessageId(messages: DcpMessage[], toolCallId: string): string {
    const owner = messages.find((entry) => entry.message.role === "assistant" && entry.message.content.some((block) => block.type === "toolCall" && block.id === toolCallId));
    return owner?.id ?? messages[messages.length - 1]?.id ?? "";
}
