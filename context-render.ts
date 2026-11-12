import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { formatMessageIdTag, isIgnoredUserMessage, type DcpMessage } from "./conversation.ts";
import type { Logger } from "./logger.ts";
import { assistantHasToolCall } from "./tool-transactions.ts";
import type { CompressionBlock, SessionState } from "./types.ts";
import type { AuditProjectionTrace } from "./audit-types.ts";

export function messageHasCompress(entry: DcpMessage): boolean {
    return entry.message.role === "assistant" && entry.message.content.some((block) => block.type === "toolCall" && block.name === "compress");
}

export function pruneMessages(state: SessionState, logger: Logger, messages: DcpMessage[], trace?: AuditProjectionTrace[]): DcpMessage[] {
    return filterCompressedRanges(state, logger, messages, trace);
}

function filterCompressedRanges(state: SessionState, logger: Logger, messages: DcpMessage[], trace?: AuditProjectionTrace[]): DcpMessage[] {
    const stored = state.prune.messages;
    if (!stored.byMessageId.size && !stored.activeByAnchorMessageId.size) {
        messages.forEach((_entry, index) => trace?.push({ action: "keep", inputOrdinal: index, outputOrdinal: index }));
        return messages;
    }
    const result: DcpMessage[] = [];
    for (const [inputOrdinal, entry] of messages.entries()) {
        const blockId = entry.id ? stored.activeByAnchorMessageId.get(entry.id) : undefined;
        const block = blockId === undefined ? undefined : stored.blocksById.get(blockId);
        if (block?.active && block.summary) {
            trace?.push({ action: "insert", outputOrdinal: result.length, block: { blockId: block.blockId,
                compressCallId: block.compressCallId ?? null, compressMessageId: block.compressMessageId,
                anchorMessageId: block.anchorMessageId } });
            result.push(makeSyntheticSummaryEntry(block));
            logger.debug("Injected compress summary", { anchor: entry.id, blockId });
        }
        if (entry.id && (stored.byMessageId.get(entry.id)?.activeBlockIds.length ?? 0) > 0) {
            trace?.push({ action: "remove", inputOrdinal, entryId: entry.id,
                blockIds: [...stored.byMessageId.get(entry.id)!.activeBlockIds] });
            continue;
        }
        trace?.push({ action: "keep", inputOrdinal, outputOrdinal: result.length });
        result.push(entry);
    }
    return result;
}

let syntheticCounter = 0;
function makeSyntheticSummaryEntry(block: CompressionBlock): DcpMessage {
    const message: AgentMessage = { role: "user", content: block.summary, timestamp: block.createdAt || Date.now() };
    return { id: `dcp-summary-${block.blockId}-${++syntheticCounter}`, index: 0, message };
}

export function injectMessageIdTags(state: SessionState, messages: DcpMessage[]): void {
    for (const entry of messages) {
        if (isIgnoredUserMessage(entry) || entry.message.role === "compactionSummary" || assistantHasToolCall(entry)) continue;
        const ref = entry.id ? state.messageIds.byRawId.get(entry.id) : undefined;
        if (!ref) continue;
        injectIntoMessage(entry, formatMessageIdTag(ref));
    }
}

export function injectIntoMessage(entry: DcpMessage, text: string): void {
    if (!text.trim()) return;
    const message = entry.message;
    if (message.role === "user") {
        if (typeof message.content === "string") {
            message.content = appendText(message.content, text);
            return;
        }
        if (Array.isArray(message.content)) injectTextBlock(message.content, text);
    } else if (message.role === "assistant" && Array.isArray(message.content)) {
        if (!assistantHasToolCall(entry)) injectTextBlock(message.content, text);
    } else if (message.role === "toolResult" && Array.isArray(message.content)) {
        message.content.push({ type: "text", text: text.trim() });
    }
}

function injectTextBlock(content: Array<any>, text: string): void {
    for (let index = content.length - 1; index >= 0; index--) {
        const block = content[index];
        if (block?.type !== "text" || typeof block.text !== "string") continue;
        block.text = appendText(block.text, text);
        return;
    }
    content.push({ type: "text", text: text.trim() });
}

function appendText(existing: string, added: string): string {
    return `${existing.replace(/\n*$/, "")}\n\n${added.trim()}`;
}

export function stripHallucinations(text: string): string {
    return text
        .replace(/<dcp[^>]*>[\s\S]*?<\/dcp[^>]*>/gi, "")
        .replace(/<\/?dcp[^>]*>/gi, "")
        .replace(/\(dcp-system-reminder\b[\s\S]*?\n\)/gi, "")
        .replace(/\(dcp-msg-id\s+[^)\r\n]+\)/gi, "")
        .trim();
}
