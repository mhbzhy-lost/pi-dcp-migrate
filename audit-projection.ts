import { createHash } from "node:crypto";
import type { DcpMessage } from "./conversation.ts";
import type { AuditProjectionDiff, AuditProjectionTrace, AuditSnapshot, AuditSnapshotEntry, Json } from "./audit-types.ts";

export function auditJson(value: unknown): Json {
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error("Audit value has no JSON representation");
    return JSON.parse(text) as Json;
}
export function auditHash(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function auditSnapshot(messages: DcpMessage[], trace: AuditProjectionTrace[] = []): AuditSnapshot {
    const inserted = new Map(trace.filter((item) => item.action === "insert").map((item) => [item.outputOrdinal, item.block]));
    const entries: AuditSnapshotEntry[] = messages.map((entry, ordinal) => {
        const message = auditJson(entry.message);
        const text = JSON.stringify(message);
        const block = inserted.get(ordinal) ?? null;
        return { ordinal, entryId: block ? null : entry.id || null, ref: entry.ref ?? null,
            binding: block ? "synthetic-summary" : entry.id ? "host-entry" : "unbound", block,
            sha256: auditHash(message), bytes: Buffer.byteLength(text), message };
    });
    return { entries, messageCount: entries.length,
        messageBytes: Buffer.byteLength(JSON.stringify(entries.map((entry) => entry.message))) };
}
// 差异只来自同一次 before/projection 和实际 skip/push trace，不用块的历史覆盖集合。
export function diffAuditProjection(before: AuditSnapshot, projection: AuditSnapshot, output: AuditSnapshot,
    trace: AuditProjectionTrace[], annotations: Array<{ ordinal: number; kind: "reminder-or-message-id" }> = []): AuditProjectionDiff {
    const result: AuditProjectionDiff = { removed: [], inserted: [], retained: [], outputChanges: [], unknown: [],
        messageBytes: { before: before.messageBytes, projection: projection.messageBytes, output: output.messageBytes,
            removedMinusInserted: before.messageBytes - projection.messageBytes } };
    const inputs = new Set<number>();
    const outputs = new Set<number>();
    let lastRetained = -1;
    for (const item of trace) {
        if (item.action === "insert") {
            const entry = projection.entries[item.outputOrdinal];
            if (!entry || outputs.has(item.outputOrdinal)) { result.unknown.push(`Invalid insertion ${item.outputOrdinal}`); continue; }
            outputs.add(item.outputOrdinal);
            result.inserted.push({ outputOrdinal: item.outputOrdinal, block: item.block, sha256: entry.sha256 });
        } else {
            const entry = before.entries[item.inputOrdinal];
            if (!entry || inputs.has(item.inputOrdinal)) { result.unknown.push(`Invalid input ${item.inputOrdinal}`); continue; }
            inputs.add(item.inputOrdinal);
            if (item.action === "remove") {
                result.removed.push({ inputOrdinal: item.inputOrdinal, entryId: entry.entryId, sha256: entry.sha256, blockIds: item.blockIds });
            } else {
                const kept = projection.entries[item.outputOrdinal];
                const unchanged = !!kept && entry.entryId === kept.entryId && entry.sha256 === kept.sha256;
                result.retained.push({ inputOrdinal: item.inputOrdinal, outputOrdinal: item.outputOrdinal, unchanged });
                if (!unchanged || item.outputOrdinal <= lastRetained || outputs.has(item.outputOrdinal)) result.unknown.push(`Retained entry changed/order invalid: ${item.inputOrdinal}`);
                outputs.add(item.outputOrdinal);
                lastRetained = item.outputOrdinal;
            }
        }
    }
    if (inputs.size !== before.entries.length || outputs.size !== projection.entries.length) result.unknown.push("Projection trace does not cover both snapshots");
    const marked = new Set(annotations.map((item) => item.ordinal));
    if (projection.entries.length !== output.entries.length) result.unknown.push("Post-projection message count changed");
    projection.entries.forEach((entry, ordinal) => {
        const after = output.entries[ordinal];
        if (!after) return;
        if (entry.sha256 !== after.sha256) result.outputChanges.push({ ordinal, beforeHash: entry.sha256, afterHash: after.sha256,
            classification: marked.has(ordinal) ? "reminder-or-message-id" : "unknown" });
        if (entry.entryId !== after.entryId) result.unknown.push(`Post-projection identity changed: ${ordinal}`);
    });
    return result;
}
