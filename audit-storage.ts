import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { AUDIT_STATUS_MAX_BYTES } from "./audit-types.ts";
import type { AuditAttachment, AuditEvent, AuditIdentity, AuditRecorder, AuditRecorderOptions,
    AuditRecord, AuditRunManifest, AuditStatus } from "./audit-types.ts";

export function auditRoot(): string {
    return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "pi", "dcp-audit", "v1");
}
export function auditSessionHash(identity: AuditIdentity): string {
    return digest(identity.sessionFile ?? `in-memory:${identity.sessionId}`);
}
function digest(text: string): string { return createHash("sha256").update(text).digest("hex"); }
interface Run {
    identity: AuditIdentity; directory: string; seq: number; used: number; initialized: boolean;
    paused: boolean; currentPass: number | null; lastPass: number | null; metadataBytes: number;
}
function productionSource(): Pick<AuditRunManifest, "versions" | "productionSourceFingerprint" | "productionFiles"> {
    const root = import.meta.dirname;
    const names = readdirSync(root).filter((name) => name.endsWith(".ts") && !name.startsWith("test-"));
    names.push("package.json", "dcp.schema.json");
    const productionFiles = Object.fromEntries(names.sort().map((name) => [name, digest(readFileSync(join(root, name), "utf8"))]));
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const pi = JSON.parse(readFileSync(join(dirname(piEntry), "..", "package.json"), "utf8"));
    return { versions: { node: process.version, pi: pi.version, package: pkg.version }, productionFiles,
        productionSourceFingerprint: digest(Object.entries(productionFiles).map(([name, hash]) => `${name}:${hash}`).join("\n") + "\n") };
}
// 禁用时不执行源码扫描或任何文件写入。capture 同步冻结，flush 等待串行队列。
export function createAuditRecorder(options: AuditRecorderOptions): AuditRecorder | undefined {
    if (!options.config.enabled) return undefined;
    const processRunId = randomUUID();
    const runs = new Map<string, Run>();
    let current: Run | undefined;
    let queue: Promise<void> = Promise.resolve();
    let warned = false;
    let source: ReturnType<typeof productionSource> | undefined;
    function warn(): void {
        if (warned) return;
        warned = true;
        try { options.warn("DCP 本地审计已暂停，记录可能不完整；压缩和会话继续正常运行。请检查审计目录、预算及报告状态。"); } catch { /* UI 失败不能影响会话。 */ }
    }
    async function initialize(run: Run): Promise<void> {
        if (run.initialized) return;
        source ??= productionSource();
        const manifest: AuditRunManifest = { formatVersion: 1, processRunId, sessionHash: auditSessionHash(run.identity),
            startedAt: new Date().toISOString(), identity: run.identity, maxRunBytes: options.config.maxRunBytes,
            ...source, boundary: "DCP context handler; not provider request" };
        const text = JSON.stringify(manifest, null, 2) + "\n";
        // run manifest 与一次终态共用额外 64 KiB 元数据额度；不挤占正文预算。
        if (Buffer.byteLength(text) > AUDIT_STATUS_MAX_BYTES / 2) throw new Error("Audit manifest metadata exceeds limit");
        await mkdir(run.directory, { recursive: true, mode: 0o700 });
        await writeFile(join(run.directory, "run.json"), text, { mode: 0o600, flag: "wx" });
        run.metadataBytes = Buffer.byteLength(text);
        run.initialized = true;
    }
    async function terminate(run: Run, reason: AuditStatus["reason"], error?: unknown): Promise<void> {
        run.paused = true;
        warn();
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : null;
        const status: AuditStatus = { formatVersion: 1, processRunId, status: "paused", reason, errorCode: code,
            time: new Date().toISOString(), lastCompleteContextPassId: run.lastPass, currentContextPassId: run.currentPass,
            usedBytes: run.used, metadataBytes: run.metadataBytes,
            remainingBytes: Math.max(0, options.config.maxRunBytes - run.used), nextSeq: run.seq };
        try {
            await initialize(run);
            const text = JSON.stringify(status, null, 2) + "\n";
            if (Buffer.byteLength(text) + run.metadataBytes <= AUDIT_STATUS_MAX_BYTES) await writeFile(join(run.directory, "status.json"), text, { mode: 0o600, flag: "wx" });
        } catch { /* IO 不可用时警告仍可见，不能伪称记录完整。 */ }
    }
    function pause(reason: AuditStatus["reason"], error?: unknown, contextPassId?: number): void {
        const run = current;
        if (!run || run.paused) return;
        if (contextPassId !== undefined) run.currentPass = contextPassId;
        run.paused = true;
        warn();
        queue = queue.then(() => terminate(run, reason, error));
    }
    function record(event: AuditEvent, attachments: Record<string, unknown>, pass?: number): void {
        const run = current;
        if (!run || run.paused) return;
        if (pass !== undefined) run.currentPass = pass;
        let encoded: Record<string, string>;
        try {
            encoded = Object.fromEntries(Object.entries(attachments).map(([name, value]) => {
                if (!/^[a-z][a-z-]*$/.test(name)) throw new Error("Invalid attachment name");
                const text = JSON.stringify(value);
                if (text === undefined) throw new Error("Non-JSON audit value");
                return [name, text + "\n"];
            }));
        } catch (error) { pause("serialization", error, pass); return; }
        const seq = ++run.seq;
        const refs: Record<string, AuditAttachment> = Object.fromEntries(Object.entries(encoded).map(([name, text]) =>
            [name, { path: `${name}.json`, bytes: Buffer.byteLength(text), sha256: digest(text) }]));
        const entry: AuditRecord = { formatVersion: 1, processRunId, seq, time: new Date().toISOString(),
            identity: { ...run.identity }, event, contextPassId: pass ?? null, attachments: refs };
        const recordText = JSON.stringify(entry, null, 2) + "\n";
        const size = Buffer.byteLength(recordText) + Object.values(refs).reduce((total, ref) => total + ref.bytes, 0);
        queue = queue.then(async () => {
            // 已冻结的排队事件仍按顺序写入；预算/IO 故障后不再发布后续正文。
            if (run.paused) return;
            try {
                await initialize(run);
                if (run.used + size > options.config.maxRunBytes) { await terminate(run, "budget"); return; }
                const name = String(seq).padStart(8, "0");
                const partial = join(run.directory, `.partial-${name}`);
                await mkdir(partial, { mode: 0o700 });
                for (const [key, text] of Object.entries(encoded)) await writeFile(join(partial, `${key}.json`), text, { mode: 0o600, flag: "wx" });
                await writeFile(join(partial, "record.json"), recordText, { mode: 0o600, flag: "wx" });
                await rename(partial, join(run.directory, name));
                run.used += size;
                if (event === "context" && pass !== undefined) run.lastPass = pass;
            } catch (error) { await terminate(run, "io", error); }
        });
    }
    return {
        get active() { return !!current && !current.paused; },
        setIdentity(identity) {
            const key = auditSessionHash(identity);
            if (!runs.has(key)) runs.set(key, { identity: { ...identity }, directory: join(auditRoot(), key, processRunId),
                seq: 0, used: 0, metadataBytes: 0, initialized: false, paused: false, currentPass: null, lastPass: null });
            current = runs.get(key)!;
            current.identity = { ...identity };
        },
        capture(event, body, pass) { record(event, { [event === "request" ? "request" : "body"]: body }, pass); },
        context(attachments, pass) { record("context", attachments, pass); },
        pause,
        async flush() { await queue; },
    };
}
