export type CompressionMode = "range" | "message";

export interface CompressionBlock {
    blockId: number;
    runId: number;
    active: boolean;
    deactivatedByUser: boolean;
    invalidated?: boolean;
    compressedTokens: number;
    summaryTokens: number;
    durationMs: number;
    mode?: CompressionMode;
    topic: string;
    batchTopic?: string;
    startId: string;
    endId: string;
    anchorMessageId: string;
    compressMessageId: string;
    compressCallId?: string;
    includedBlockIds: number[];
    consumedBlockIds: number[];
    parentBlockIds: number[];
    directMessageIds: string[];
    directToolIds: string[];
    effectiveMessageIds: string[];
    effectiveToolIds: string[];
    createdAt: number;
    deactivatedAt?: number;
    deactivatedByBlockId?: number;
    summary: string;
}

export interface PrunedMessageEntry {
    tokenCount: number;
    allBlockIds: number[];
    activeBlockIds: number[];
}

export interface PruneMessagesState {
    byMessageId: Map<string, PrunedMessageEntry>;
    blocksById: Map<number, CompressionBlock>;
    activeBlockIds: Set<number>;
    activeByAnchorMessageId: Map<string, number>;
    nextBlockId: number;
    nextRunId: number;
}

export interface ToolMeta {
    tool: string;
    arguments: any;
    status: "completed" | "error" | "running";
    assistantEntryId: string;
    resultEntryId?: string;
}

export interface MessageIdState {
    byRawId: Map<string, string>;
    byRef: Map<string, string>;
    nextRef: number;
}

/**
 * Anchors for the single soft context reminder. Legacy turn/iteration anchor sets
 * were removed; the sidecar keeps neutral placeholders for them in persistence.ts.
 */
export interface Nudges {
    contextLimitAnchors: Set<string>;
}

export interface SessionState {
    sessionKey: string | null;
    prune: {
        messages: PruneMessagesState;
    };
    nudges: Nudges;
    toolMeta: Map<string, ToolMeta>;
    messageIds: MessageIdState;
    lastCompaction: number;
    modelContextLimit: number | undefined;
}

export function createPruneMessagesState(): PruneMessagesState {
    return {
        byMessageId: new Map(),
        blocksById: new Map(),
        activeBlockIds: new Set(),
        activeByAnchorMessageId: new Map(),
        nextBlockId: 1,
        nextRunId: 1,
    };
}

export function createSessionState(): SessionState {
    return {
        sessionKey: null,
        prune: {
            messages: createPruneMessagesState(),
        },
        nudges: {
            contextLimitAnchors: new Set(),
        },
        toolMeta: new Map(),
        messageIds: { byRawId: new Map(), byRef: new Map(), nextRef: 1 },
        lastCompaction: 0,
        modelContextLimit: undefined,
    };
}

export function resetSessionState(state: SessionState): void {
    state.sessionKey = null;
    state.prune = { messages: createPruneMessagesState() };
    state.nudges = { contextLimitAnchors: new Set() };
    state.toolMeta.clear();
    state.messageIds = { byRawId: new Map(), byRef: new Map(), nextRef: 1 };
    state.lastCompaction = 0;
}
