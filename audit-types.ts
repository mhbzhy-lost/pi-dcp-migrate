// 审计 v1 契约；运行时依赖仅限 Node，不能把审计内容回填给模型。
export const AUDIT_FORMAT_VERSION = 1;
export const AUDIT_DEFAULT_MAX_BYTES = 268435456;
export const AUDIT_STATUS_MAX_BYTES = 65536;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface AuditConfig { enabled: boolean; maxRunBytes: number }
export interface AuditIdentity {
    sessionId: string;
    sessionKey: string | null;
    sessionFile: string | null;
    parentSession: string | null;
    leafId: string | null;
}
export interface AuditBlockIdentity {
    blockId: number;
    compressCallId: string | null;
    compressMessageId: string;
    anchorMessageId: string;
}
export type AuditEvent = "request" | "requested" | "plans" | "materialization" | "commit" |
    "tool-complete" | "tool-error" | "context" | "lifecycle";
export interface AuditAttachment { path: string; bytes: number; sha256: string }
export interface AuditRecord {
    formatVersion: 1;
    processRunId: string;
    seq: number;
    time: string;
    identity: AuditIdentity;
    event: AuditEvent;
    contextPassId: number | null;
    attachments: Record<string, AuditAttachment>;
}
export interface AuditRunManifest {
    formatVersion: 1;
    processRunId: string;
    sessionHash: string;
    startedAt: string;
    identity: AuditIdentity;
    maxRunBytes: number;
    versions: { node: string; pi: string; package: string };
    productionSourceFingerprint: string;
    productionFiles: Record<string, string>;
    boundary: "DCP context handler; not provider request";
}
export interface AuditStatus {
    formatVersion: 1;
    processRunId: string;
    status: "paused";
    reason: "budget" | "io" | "serialization";
    errorCode: string | null;
    time: string;
    lastCompleteContextPassId: number | null;
    currentContextPassId: number | null;
    usedBytes: number;
    metadataBytes: number;
    remainingBytes: number;
    nextSeq: number;
}
// 同步 observer 只冻结和排队；异步文件写入由 recorder.flush 等待。
export interface AuditObserver {
    readonly active: boolean;
    capture(event: AuditEvent, body: unknown, contextPassId?: number): void;
    pause(reason: AuditStatus["reason"], error?: unknown, contextPassId?: number): void;
}
export interface AuditRecorder extends AuditObserver {
    setIdentity(identity: AuditIdentity): void;
    context(attachments: Record<string, unknown>, contextPassId: number): void;
    pause(reason: AuditStatus["reason"], error?: unknown, contextPassId?: number): void;
    flush(): Promise<void>;
    readonly active: boolean;
}
export interface AuditRecorderOptions {
    config: AuditConfig;
    warn: (message: string) => void;
}
export interface AuditSnapshotEntry {
    ordinal: number;
    entryId: string | null;
    ref: string | null;
    binding: "host-entry" | "unbound" | "synthetic-summary";
    block: AuditBlockIdentity | null;
    sha256: string;
    bytes: number;
    message: Json;
}
export interface AuditSnapshot {
    entries: AuditSnapshotEntry[];
    messageCount: number;
    messageBytes: number;
}
export type AuditProjectionTrace =
    | { action: "remove"; inputOrdinal: number; entryId: string; blockIds: number[] }
    | { action: "keep"; inputOrdinal: number; outputOrdinal: number }
    | { action: "insert"; outputOrdinal: number; block: AuditBlockIdentity };
export interface AuditProjectionDiff {
    removed: Array<{ inputOrdinal: number; entryId: string | null; sha256: string; blockIds: number[] }>;
    inserted: Array<{ outputOrdinal: number; block: AuditBlockIdentity; sha256: string }>;
    retained: Array<{ inputOrdinal: number; outputOrdinal: number; unchanged: boolean }>;
    outputChanges: Array<{ ordinal: number; beforeHash: string; afterHash: string;
        classification: "reminder-or-message-id" | "unknown" }>;
    unknown: string[];
    messageBytes: { before: number; projection: number; output: number; removedMinusInserted: number };
}
export interface AuditProvenance {
    kind: "old-block-placeholder" | "old-block-boundary" | "old-block-required" |
        "protected-user" | "protected-tag" | "protected-tool";
    entryId?: string;
    toolCallId?: string;
    blockId?: number;
    origin?: AuditBlockIdentity;
    text: string;
}
export interface LoadedAuditRecord { directory: string; record: AuditRecord; data: Record<string, Json> }
export interface LoadedAuditRun {
    directory: string;
    manifest: AuditRunManifest;
    status: AuditStatus | null;
    records: LoadedAuditRecord[];
    issues: string[];
}
export interface LoadedAuditSession { sessionHash: string; runs: LoadedAuditRun[]; issues: string[] }
export interface AuditSessionIndex { sessionHash: string; runs: number; paused: number; incomplete: number }

export function observeAudit(observer: AuditObserver | undefined, event: AuditEvent, body: () => unknown): void {
    if (!observer?.active) return;
    try { observer.capture(event, body()); }
    catch (error) { try { observer.pause("serialization", error); } catch { /* 旁路错误不能干预压缩。 */ } }
}
