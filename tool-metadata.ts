import { type DcpMessage } from "./conversation.ts";
import { isMessageCompacted } from "./compression-state.ts";
import { type SessionState, type ToolMeta } from "./types.ts";

/**
 * Build per-tool-call metadata needed to protect file outputs during compression.
 *
 * Only the fields consumed by compression-summary.ts's protected-content path are
 * recorded: the tool name and arguments (matched against protectedFilePatterns),
 * the completion status, and the assistant/result entry IDs. Rule-based pruning
 * (deduplication, error purging, tool-age protection) has been removed, so this
 * metadata no longer drives any rewriting of the outbound context.
 */
export function buildToolMeta(state: SessionState, messages: DcpMessage[]): void {
    state.toolMeta.clear();
    const resultByCallId = new Map<string, DcpMessage>();
    for (const entry of messages) {
        if (entry.message.role === "toolResult") resultByCallId.set(entry.message.toolCallId, entry);
    }

    for (const entry of messages) {
        if (entry.message.role !== "assistant") continue;
        if (isMessageCompacted(state, entry)) continue;
        for (const block of entry.message.content) {
            if (block.type !== "toolCall") continue;
            const result = resultByCallId.get(block.id);
            const status: ToolMeta["status"] = result?.message.role === "toolResult" && result.message.isError
                ? "error"
                : result ? "completed" : "running";
            state.toolMeta.set(block.id, {
                tool: block.name,
                arguments: block.arguments,
                status,
                assistantEntryId: entry.id,
                resultEntryId: result?.id,
            });
        }
    }
}
