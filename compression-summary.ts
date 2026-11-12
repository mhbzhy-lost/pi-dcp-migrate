import { formatMessageIdTag, type DcpMessage } from "./conversation.ts";
import { isIgnoredUserMessage } from "./conversation.ts";
import type { CompressionRuntime } from "./compression-types.ts";
import type { RangePlan, SearchContext, Selection } from "./compression-planner.ts";
import { getFilePathsFromParameters, isFilePathProtected, isToolNameProtected } from "./patterns.ts";
import type { CompressionBlock } from "./types.ts";
import { observeAudit, type AuditProvenance } from "./audit-types.ts";

const COMPRESSED_BLOCK_HEADER = "[Compressed conversation section]";
const BLOCK_PLACEHOLDER_REGEX = /\(b(\d+)\)|\{block_(\d+)\}/gi;

export interface MaterializedSummary {
    topic: string;
    anchorMessageId: string;
    startId: string;
    endId: string;
    summary: string;
    consumedBlockIds: number[];
}

export function materializePlan(
    runtime: CompressionRuntime,
    search: SearchContext,
    plan: RangePlan,
    blockId: number,
    batchTopic: string,
): MaterializedSummary {
    const combined = [...plan.sources]
        .sort((left, right) => left.rawIndex - right.rawIndex || left.inputIndex - right.inputIndex)
        .map((source) => source.summary)
        .join("\n\n");
    const provenance: AuditProvenance[] | undefined = runtime.audit?.active ? [] : undefined;
    const { expanded, consumed } = injectBlockPlaceholders(combined, plan, search.summaryByBlockId, provenance);
    const protectedSummary = appendProtectedContent(runtime, plan.selection, search, expanded, provenance);
    const topic = plan.sources.length === 1 ? plan.sources[0]!.topic || batchTopic : batchTopic;
    const summary = wrapSummary(blockId, protectedSummary);
    observeAudit(runtime.audit, "materialization", () => ({ blockId, topic, anchorMessageId: plan.anchor,
        modelCombined: combined, oldBlocksExpanded: expanded, protectedSummary, finalSummary: summary, provenance }));
    return {
        topic,
        anchorMessageId: plan.anchor,
        startId: boundaryLabel(plan.start, search.messages),
        endId: boundaryLabel(plan.end, search.messages),
        summary,
        consumedBlockIds: consumed,
    };
}

function injectBlockPlaceholders(summary: string, plan: RangePlan, summaries: Map<number, CompressionBlock>, provenance?: AuditProvenance[]) {
    const required = new Set(plan.selection.requiredBlockIds);
    const consumed: number[] = [];
    const seen = new Set<number>();
    const placeholders = [...summary.matchAll(new RegExp(BLOCK_PLACEHOLDER_REGEX))].map((match) => ({
        start: match.index!,
        end: match.index! + match[0].length,
        id: Number.parseInt(match[1] || match[2] || "", 10),
    }));
    let expanded = summary;
    if (placeholders.length) {
        expanded = "";
        let cursor = 0;
        for (const placeholder of placeholders) {
            if (!required.has(placeholder.id) || seen.has(placeholder.id) || !summaries.has(placeholder.id)) continue;
            expanded += summary.slice(cursor, placeholder.start) + restoreSummary(summaries.get(placeholder.id)!.summary);
            recordOldBlock(provenance, "old-block-placeholder", summaries.get(placeholder.id)!);
            cursor = placeholder.end;
            seen.add(placeholder.id);
            consumed.push(placeholder.id);
        }
        expanded += summary.slice(cursor);
    }
    for (const ref of [plan.start, plan.end]) {
        if (ref.kind !== "compressed-block" || ref.blockId === undefined || seen.has(ref.blockId)) continue;
        const block = summaries.get(ref.blockId);
        if (!block) throw new Error(`Compressed block not found: (b${ref.blockId})`);
        expanded = joinSummaries(expanded, restoreSummary(block.summary));
        recordOldBlock(provenance, "old-block-boundary", block);
        seen.add(ref.blockId);
        consumed.push(ref.blockId);
    }
    const missing = [...required].filter((id) => !seen.has(id));
    if (missing.length) {
        const restored = missing.map((id) => {
            const block = summaries.get(id);
            if (!block) throw new Error(`Compressed block not found: (b${id})`);
            consumed.push(id);
            recordOldBlock(provenance, "old-block-required", block);
            return `\n### (b${id})\n${restoreSummary(block.summary)}`;
        });
        expanded += "\n\nThe following previously compressed summaries were also part of this conversation section:" + restored.join("");
    }
    return { expanded, consumed };
}

function recordOldBlock(provenance: AuditProvenance[] | undefined, kind: AuditProvenance["kind"], block: CompressionBlock): void {
    provenance?.push({ kind, blockId: block.blockId, text: restoreSummary(block.summary),
        origin: { blockId: block.blockId, compressCallId: block.compressCallId ?? null,
            compressMessageId: block.compressMessageId, anchorMessageId: block.anchorMessageId } });
}

function joinSummaries(left: string, right: string): string {
    const body = right.trim();
    return !left.trim() ? body : !body ? left.trim() : `${left.trim()}\n\n${body}`;
}

export function restoreSummary(summary: string): string {
    const header = summary.match(/^\s*\[Compressed conversation(?: section)?(?: b\d+)?\]/i);
    if (!header) return summary;
    return summary.slice(header[0].length).replace(/^(?:\r?\n)+/, "")
        .replace(/(?:\r?\n)*(?:\(dcp-msg-id\s+b\d+\)|<dcp-message-id>b\d+<\/dcp-message-id>)\s*$/i, "")
        .replace(/(?:\r?\n)+$/, "");
}

export function wrapSummary(blockId: number, summary: string): string {
    const body = summary.trim();
    const footer = formatMessageIdTag(formatBlockRef(blockId));
    return body ? `${COMPRESSED_BLOCK_HEADER}\n${body}\n\n${footer}` : `${COMPRESSED_BLOCK_HEADER}\n${footer}`;
}

export function formatBlockRef(blockId: number): string {
    return `b${blockId}`;
}

function boundaryLabel(ref: RangePlan["start"], messages: DcpMessage[]): string {
    if (ref.kind === "compressed-block") return `b${ref.blockId}`;
    return messages[ref.rawIndex]?.ref ?? "";
}

function appendProtectedContent(runtime: CompressionRuntime, selection: Selection, search: SearchContext, summary: string, provenance?: AuditProvenance[]): string {
    let result = summary;
    if (runtime.config.compress.protectUserMessages) {
        const texts = selectedMessages(runtime, selection, search)
            .filter((entry) => entry.message.role === "user" && !isIgnoredUserMessage(entry))
            .map((entry) => {
                const text = userText(entry);
                if (text.trim()) provenance?.push({ kind: "protected-user", entryId: entry.id, text });
                return text;
            }).filter((text) => text.trim());
        if (texts.length) result += "\n\nThe following user messages were sent in this conversation verbatim:" + texts.map((text) => `\n${text}`).join("");
    }
    if (runtime.config.compress.protectTags) {
        const texts = selectedMessages(runtime, selection, search).flatMap((entry) => {
            const text = entry.message.role === "user" && typeof entry.message.content === "string" ? entry.message.content : "";
            return [...text.matchAll(/<protect>([\s\S]*?)<\/protect>/gi)].map((match) => {
                const value = match[1]?.trim() ?? "";
                if (value) provenance?.push({ kind: "protected-tag", entryId: entry.id, text: value });
                return value;
            }).filter(Boolean);
        });
        if (texts.length) result += "\n\nThe following protected prompt information was included in this conversation verbatim:" + texts.map((text) => `\n${text}`).join("");
    }
    const outputs = selectedMessages(runtime, selection, search).flatMap((entry) => {
        const values = protectedToolOutput(runtime, entry);
        if (values.length && entry.message.role === "toolResult") provenance?.push({ kind: "protected-tool",
            entryId: entry.id, toolCallId: entry.message.toolCallId, text: values.join("") });
        return values;
    });
    if (outputs.length) result += "\n\nThe following protected tools were used in this conversation as well:" + outputs.join("");
    return result;
}

function selectedMessages(runtime: CompressionRuntime, selection: Selection, search: SearchContext): DcpMessage[] {
    return selection.messageIds
        .filter((id) => !(runtime.state.prune.messages.byMessageId.get(id)?.activeBlockIds.length))
        .map((id) => search.byEntryId.get(id)).filter((entry): entry is DcpMessage => !!entry);
}

function userText(entry: DcpMessage): string {
    if (entry.message.role !== "user") return "";
    return typeof entry.message.content === "string" ? entry.message.content : entry.message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text").map((block) => block.text).join("\n");
}

function protectedToolOutput(runtime: CompressionRuntime, entry: DcpMessage): string[] {
    if (entry.message.role !== "toolResult") return [];
    const meta = runtime.state.toolMeta.get(entry.message.toolCallId);
    const protectedByName = isToolNameProtected(entry.message.toolName, runtime.config.compress.protectedTools);
    const protectedByFile = !!meta && isFilePathProtected(
        getFilePathsFromParameters(meta.tool, meta.arguments), runtime.config.protectedFilePatterns,
    );
    if (!protectedByName && !protectedByFile) return [];
    const output = entry.message.content.filter((block): block is { type: "text"; text: string } => block.type === "text").map((block) => block.text).join("\n");
    return output ? [`\n### Tool: ${entry.message.toolName}\n${output}`] : [];
}
