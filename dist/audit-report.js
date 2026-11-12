// 由 scripts/build-audit.ts 生成；请修改 TypeScript 源码后重新构建。
import { readFile, readdir, realpath, stat, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, isAbsolute, join, sep } from "node:path";
import { homedir } from "node:os";
import { diffAuditProjection, auditHash } from "./audit-projection.js";
export function reportRoot() {
    return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "pi", "dcp-audit", "v1");
}
function contained(base, path) {
    const rel = relative(base, path);
    return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
async function safePath(base, rel) {
    if (isAbsolute(rel) || !rel || rel.split(/[\\/]/).includes(".."))
        throw new Error(`附件路径非法: ${rel}`);
    const target = resolve(base, rel);
    if (!contained(resolve(base), target))
        throw new Error("附件路径越界");
    const actual = await realpath(target);
    if (!contained(await realpath(base), actual))
        throw new Error("附件 realpath 越界");
    return actual;
}
async function readJson(base, rel, expected) {
    const target = await safePath(base, rel);
    const info = await stat(target);
    if (!info.isFile())
        throw new Error(`非普通文件: ${rel}`);
    if (expected && (!Number.isSafeInteger(expected.bytes) || expected.bytes < 0 || info.size !== expected.bytes))
        throw new Error(`附件字节数不符: ${rel}`);
    const bytes = await readFile(target);
    if (expected && createHash("sha256").update(bytes).digest("hex") !== expected.sha256)
        throw new Error(`附件 SHA256 不符: ${rel}`);
    return JSON.parse(bytes.toString("utf8"));
}
function object(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
async function dirs(path) {
    try {
        return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    }
    catch (error) {
        if (error.code === "ENOENT")
            return [];
        throw error;
    }
}
export async function listAuditSessions() {
    const result = [];
    for (const sessionHash of await dirs(reportRoot())) {
        if (!/^[a-f0-9]{64}$/.test(sessionHash))
            continue;
        const session = await loadAuditSession(sessionHash);
        result.push({ sessionHash, runs: session.runs.length,
            paused: session.runs.filter((run) => run.status).length,
            incomplete: session.issues.length + session.runs.reduce((sum, run) => sum + run.issues.length, 0) });
    }
    return result;
}
export async function loadAuditSession(sessionHash, runId) {
    if (!/^[a-f0-9]{64}$/.test(sessionHash))
        throw new Error("session 必须是索引列出的 64 位 hash");
    if (runId && !/^[a-f0-9-]{36}$/.test(runId))
        throw new Error("run 必须是索引中的 processRunId");
    const root = reportRoot();
    const session = { sessionHash, runs: [], issues: [] };
    const names = await dirs(join(root, sessionHash));
    for (const name of runId ? names.filter((name) => name === runId) : names) {
        try {
            const path = await safePath(root, `${sessionHash}/${name}`);
            const run = await loadRun(path, sessionHash, name);
            session.runs.push(run);
        }
        catch (error) {
            session.issues.push(`${name}: ${error.message}`);
        }
    }
    if (!names.length || (runId && !session.runs.length))
        session.issues.push("没有匹配的录制 run；不能证明审计完整");
    session.runs.sort((left, right) => left.manifest.startedAt.localeCompare(right.manifest.startedAt));
    return session;
}
async function loadRun(directory, sessionHash, runId) {
    const manifest = await readJson(directory, "run.json");
    if (!object(manifest) || manifest.formatVersion !== 1 || manifest.processRunId !== runId || manifest.sessionHash !== sessionHash ||
        !object(manifest.identity) || !object(manifest.versions) || !object(manifest.productionFiles) ||
        typeof manifest.startedAt !== "string" || !Number.isSafeInteger(manifest.maxRunBytes) || manifest.maxRunBytes < 1 ||
        manifest.boundary !== "DCP context handler; not provider request")
        throw new Error("run manifest 格式/身份不符");
    const run = { directory, manifest: manifest, status: null, records: [], issues: [] };
    let previous = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith(".partial-"))
            run.issues.push(`未发布的 partial: ${entry.name}`);
        if (entry.isSymbolicLink())
            run.issues.push(`不读取符号链接: ${entry.name}`);
    }
    for (const name of (await dirs(directory)).filter((name) => /^\d{8}$/.test(name))) {
        try {
            const recordDirectory = await safePath(directory, name);
            const record = await readJson(recordDirectory, "record.json");
            const allowed = ["request", "requested", "plans", "materialization", "commit", "tool-complete", "tool-error", "context", "lifecycle", "injection"];
            if (!object(record) || record.formatVersion !== 1 || record.processRunId !== runId || record.seq !== Number(name) ||
                !allowed.includes(record.event) || !object(record.attachments) || !object(record.identity) ||
                record.identity.sessionId !== manifest.identity.sessionId || record.identity.sessionFile !== manifest.identity.sessionFile ||
                !(record.contextPassId === null || (Number.isSafeInteger(record.contextPassId) && record.contextPassId > 0)))
                throw new Error("record 格式/身份不符");
            if (record.seq !== previous + 1)
                run.issues.push(`序号缺口: ${previous} → ${record.seq}`);
            previous = record.seq;
            const data = {};
            if (!Object.keys(record.attachments).length)
                throw new Error("缺少附件");
            for (const [key, ref] of Object.entries(record.attachments)) {
                if (!object(ref) || typeof ref.path !== "string" || typeof ref.sha256 !== "string")
                    throw new Error("附件引用格式不符");
                data[key] = await readJson(recordDirectory, ref.path, ref);
            }
            if (record.event === "context")
                checkContext(data);
            else
                checkEvent(record.event, data);
            run.records.push({ directory: recordDirectory, record: record, data });
        }
        catch (error) {
            run.issues.push(`${name}: ${error.message}`);
        }
    }
    try {
        await lstat(join(directory, "status.json"));
        const value = await readJson(directory, "status.json");
        if (!object(value) || value.formatVersion !== 1 || value.status !== "paused" || value.processRunId !== runId ||
            !["budget", "io", "serialization"].includes(value.reason))
            throw new Error("status 格式不符");
        run.status = value;
    }
    catch (error) {
        if (error.code !== "ENOENT")
            run.issues.push(`status: ${error.message}`);
    }
    const last = run.records.at(-1);
    const lastBody = last?.data.body;
    if (!run.status && !(last?.record.event === "lifecycle" && object(lastBody) && lastBody.event === "session_shutdown")) {
        run.issues.push("未观察到正常关闭或暂停终态；可能仍在录制或退出时不完整");
    }
    return run;
}
function checkEvent(event, data) {
    const body = event === "request" ? data.request : data.body;
    if (!object(body))
        throw new Error("事件正文缺失或不是 JSON 对象");
    if (event === "request" && (typeof body.compressCallId !== "string" || !object(body.args)))
        throw new Error("request 身份/参数缺失");
    if (["requested", "plans", "tool-complete", "tool-error"].includes(event) && typeof body.compressCallId !== "string")
        throw new Error("缺少 compressCallId");
    if (event === "plans" && !Array.isArray(body.plans))
        throw new Error("缺少最终 plans");
    if (event === "materialization" && (!Number.isSafeInteger(body.blockId) ||
        ["modelCombined", "oldBlocksExpanded", "protectedSummary", "finalSummary"].some((key) => typeof body[key] !== "string") ||
        !Array.isArray(body.provenance)))
        throw new Error("物化阶段/provenance 缺失");
    if (event === "commit" && (!object(body.block) || !Number.isSafeInteger(body.block.blockId) || typeof body.block.summary !== "string" ||
        typeof body.block.compressMessageId !== "string" || typeof body.block.compressCallId !== "string" || body.phase !== "in-memory-only"))
        throw new Error("内存提交事实格式不符");
    if (event === "injection") {
        if (body.phase === "system-prompt") {
            if (typeof body.appendedText !== "string" || typeof body.systemPrompt !== "string"
                || !body.systemPrompt.endsWith(body.appendedText))
                throw new Error("系统提示注入正文不符");
        }
        else if (body.phase === "compression-request") {
            if (body.delivery !== "queued-via-sendUserMessage" || !object(body.message)
                || body.message.role !== "user" || typeof body.message.content !== "string")
                throw new Error("命令注入正文不符");
        }
        else {
            if (!["compression-summary", "context-reminder", "message-id"].includes(body.phase)
                || !Array.isArray(body.injections) || !Number.isSafeInteger(body.outputMessageCount)
                || body.outputMessageCount < 0)
                throw new Error("消息注入阶段格式不符");
            const ordinals = new Set();
            for (const item of body.injections) {
                if (!object(item) || !Number.isSafeInteger(item.outputOrdinal) || item.outputOrdinal < 0
                    || item.outputOrdinal >= body.outputMessageCount || ordinals.has(item.outputOrdinal))
                    throw new Error("注入位置不符");
                ordinals.add(item.outputOrdinal);
                if (body.phase === "compression-summary" ? item.before !== null : !object(item.before))
                    throw new Error("注入前正文格式不符");
                if (!object(item.after))
                    throw new Error("注入后正文缺失");
                for (const entry of [item.before, item.after]) {
                    if (entry === null)
                        continue;
                    if (!object(entry) || entry.ordinal !== item.outputOrdinal || entry.sha256 !== auditHash(entry.message)
                        || entry.bytes !== Buffer.byteLength(JSON.stringify(entry.message)))
                        throw new Error("注入正文哈希/字节数不符");
                }
            }
        }
    }
    if (event === "lifecycle" && typeof body.event !== "string")
        throw new Error("缺少生命周期名称");
}
function validateSnapshot(value) {
    if (!object(value) || !Array.isArray(value.entries) || value.messageCount !== value.entries.length)
        throw new Error("快照格式/条数不符");
    for (const [index, entry] of value.entries.entries()) {
        if (!object(entry) || entry.ordinal !== index || entry.sha256 !== auditHash(entry.message) ||
            entry.bytes !== Buffer.byteLength(JSON.stringify(entry.message)))
            throw new Error(`快照消息哈希/字节数不符: ${index}`);
    }
    if (value.messageBytes !== Buffer.byteLength(JSON.stringify(value.entries.map((entry) => entry.message))))
        throw new Error("快照总字节数不符");
}
function checkContext(data) {
    const meta = data.meta;
    if (!object(meta) || !Array.isArray(meta.activeBlocks))
        throw new Error("缺少 context 元数据");
    if (!meta.activeBlocks.length)
        return;
    validateSnapshot(data.before);
    validateSnapshot(data.projection);
    validateSnapshot(data.output);
    if (!Array.isArray(data.trace) || !Array.isArray(data.annotations))
        throw new Error("缺少投影 trace/annotations");
    const diff = diffAuditProjection(data.before, data.projection, data.output, data.trace, data.annotations);
    if (JSON.stringify(diff) !== JSON.stringify(data.diff))
        throw new Error("同次投影差异重算不符");
    if (diff.unknown.length || diff.retained.some((item) => !item.unchanged) || diff.outputChanges.some((item) => item.classification === "unknown"))
        throw new Error("投影存在 unknown 或保留消息改变");
}
export function auditSessionIssues(session) {
    return [...session.issues, ...session.runs.flatMap((run) => [...run.issues.map((issue) => `${run.manifest.processRunId}: ${issue}`),
            ...(run.status ? [`${run.manifest.processRunId}: 录制暂停 (${run.status.reason})，记录不完整`] : [])])];
}
