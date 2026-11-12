import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
    assignMessageRefs,
    collectEntryIds,
    findLastCompactionTimestamp,
    projectConversationMessages,
    toDcpMessages,
    type DcpMessage,
} from "./conversation.ts";
import { resetOnCompaction, syncCompressionBlocks } from "./compression-state.ts";
import type { Logger } from "./logger.ts";
import { buildToolMeta } from "./tool-metadata.ts";
import type { SessionState } from "./types.ts";

export function sessionKeyFor(ctx: ExtensionContext): string {
    const file = ctx.sessionManager.getSessionFile();
    return file ? file.split("/").pop()!.replace(/\.jsonl$/, "") : ctx.sessionManager.getSessionId() ?? "inmemory";
}

export function reconcileConversation(
    state: SessionState,
    logger: Logger,
    messages: DcpMessage[],
): void {
    const compaction = findLastCompactionTimestamp(messages);
    if (compaction > state.lastCompaction) {
        state.lastCompaction = compaction;
        resetOnCompaction(state);
        logger.info("Detected compaction in context; reset stale state", { timestamp: compaction });
    }
    assignMessageRefs(state, messages);
    syncCompressionBlocks(state, logger, messages);
    buildToolMeta(state, messages);
}

export async function conversationFromContext(
    messages: AgentMessage[],
    ctx: ExtensionContext,
    canonical?: DcpMessage[],
): Promise<DcpMessage[]> {
    return projectConversationMessages(
        messages,
        canonical ?? await buildCanonicalConversation(ctx),
    );
}

export async function buildConversationForTool(ctx: ExtensionContext): Promise<DcpMessage[]> {
    return buildCanonicalConversation(ctx);
}

export async function buildCanonicalConversation(ctx: ExtensionContext): Promise<DcpMessage[]> {
    const { buildSessionContext } = await import("@earendil-works/pi-coding-agent");
    const entries = ctx.sessionManager.getBranch();
    const leafId = ctx.sessionManager.getLeafId();
    const built = buildSessionContext(entries, leafId);
    return toDcpMessages(built.messages, collectEntryIds(entries, leafId));
}

export async function loadStateForSession(state: SessionState, ctx: ExtensionContext, logger: Logger): Promise<void> {
    const { loadOrInheritSessionState } = await import("./persistence.ts");
    await loadOrInheritSessionState(state, {
        sessionKey: sessionKeyFor(ctx),
        sessionFile: ctx.sessionManager.getSessionFile(),
        presentEntryIds: () => new Set(ctx.sessionManager.getEntries().map((entry) => entry.id)),
    }, logger);
}
