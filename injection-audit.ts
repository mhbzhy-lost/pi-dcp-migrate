import type { DcpMessage } from "./conversation.ts";
import { auditSnapshot } from "./audit-projection.ts";
import type { AuditProjectionTrace, AuditRecorder, AuditSnapshot } from "./audit-types.ts";

// 按真实处理阶段记录正文，不从消息中的标记猜测注入来源。
export function injectionSnapshot(audit: AuditRecorder | undefined, messages: DcpMessage[], trace?: AuditProjectionTrace[]): AuditSnapshot | undefined {
    if (!audit?.active) return;
    try { return auditSnapshot(messages, trace); }
    catch (error) { audit.pause("serialization", error); return; }
}

export function recordInjectionStage(
    audit: AuditRecorder | undefined,
    pass: number,
    phase: "compression-summary" | "context-reminder" | "message-id",
    before: AuditSnapshot | undefined,
    after: AuditSnapshot | undefined,
    details: unknown,
    insertedOrdinals?: number[],
): void {
    if (!audit?.active || !after) return;
    try {
        const inserted = new Set(insertedOrdinals);
        const injections = after.entries.flatMap((entry, ordinal) => {
            const previous = before?.entries[ordinal];
            if (insertedOrdinals ? !inserted.has(ordinal) : !previous || previous.sha256 === entry.sha256) return [];
            return [{ outputOrdinal: ordinal, before: insertedOrdinals ? null : previous,
                after: entry }];
        });
        // 空数组也是证据：该阶段运行过，但未新增或重放任何注入。
        audit.capture("injection", { phase, details, injections, outputMessageCount: after.messageCount }, pass);
    } catch (error) { audit.pause("serialization", error, pass); }
}
