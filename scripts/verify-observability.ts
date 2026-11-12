#!/usr/bin/env node
// 仅编排既有门禁、领域 CLI 实录诊断和证据核验，不制造消息/fixture 或发起模型请求。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, relative, isAbsolute, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const evidence = join(root, ".evidence", "observability");
const ids = ["O1", "O2", "O3", "O4", "O5", "O6", "O7"];
const checks: Record<string, string[]> = {
    O2: ["request-materialization"], O3: ["projection-diff", "next-context-link"], O4: ["lifecycle"],
    O5: ["opt-in", "budget", "io-failure"], O6: ["report"],
    O7: ["scope-identity", "scope-projection", "scope-storage", "scope-privacy", "scope-report", "scope-regression"],
};
function hash(text: Buffer | string): string { return createHash("sha256").update(text).digest("hex"); }
function manifest() {
    const files = [...readdirSync(root).filter((name) => name.endsWith(".ts")),
        ...readdirSync(join(root, "scripts")).filter((name) => name.endsWith(".ts")).map((name) => `scripts/${name}`),
        "package.json", "package-lock.json", "tsconfig.json", "dcp.schema.json", "README.md", "LICENSE", ".gitignore"];
    const hashes = Object.fromEntries([...new Set(files)].sort().map((name) => [name, hash(readFileSync(join(root, name)))]));
    return { files: hashes, sourceFingerprint: hash(Object.entries(hashes).map(([name, value]) => `${name}:${value}`).join("\n") + "\n") };
}
function verifyEvidence(path: string, fingerprint: string, required: string[]): { reasons: string[]; doc?: any } {
    const reasons: string[] = [];
    try {
        const doc = JSON.parse(readFileSync(path, "utf8"));
        if (doc.status !== "passed") reasons.push(`status=${doc.status}，要求 passed`);
        if (doc.sourceFingerprint !== fingerprint) reasons.push("源码指纹缺失或过期");
        if (!Array.isArray(doc.checks)) throw new Error("缺少 checks 数组");
        for (const id of required) {
            const matches = doc.checks.filter((item: any) => item.id === id);
            if (matches.length !== 1 || matches[0].status !== "passed") { reasons.push(`${id} 非唯一 passed`); continue; }
            const refs = matches[0].evidence;
            if (!Array.isArray(refs) || !refs.length) { reasons.push(`${id} 缺少引用`); continue; }
            for (const ref of refs) {
                if (typeof ref.path !== "string" || !ref.path || typeof ref.locator !== "string" || !ref.locator || !existsSync(resolve(root, ref.path))) {
                    reasons.push(`${id} 引用不存在或 locator 缺失`);
                }
            }
        }
        return { reasons, doc };
    } catch (error) { reasons.push(`证据不可用: ${(error as Error).message}`); return { reasons }; }
}
function main(): number {
    const args = process.argv.slice(2);
    let selected = ids;
    if (args.length) {
        if (args.length !== 2 || args[0] !== "--only") throw new Error("用法：npm run verify:observability [-- --only O1,O2,...]");
        const chosen = args[1]!.split(",");
        if (!chosen.length || chosen.some((id) => !ids.includes(id))) throw new Error("未知 O 项");
        selected = ids.filter((id) => chosen.includes(id));
    }
    const source = manifest();
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const runDir = join(evidence, "runs", runId);
    mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const version = JSON.parse(readFileSync(join(root, "node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8")).version;
    writeFileSync(join(runDir, "manifest.json"), JSON.stringify({ runId, ...source, node: process.version, pi: version }, null, 2) + "\n");
    const results: Array<{ id: string; status: string; exit: number; log: string }> = [];
    for (const id of selected) {
        const lines: string[] = [`${id} sourceFingerprint=${source.sourceFingerprint}`];
        let exit = 0;
        if (id === "O1") {
            const result = spawnSync(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), "scripts/verify.ts", "--only", "F1,F2,F3,F4"],
                { cwd: root, env: process.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
            lines.push(`exit=${result.status}`, result.stdout, result.stderr, result.error?.message ?? "");
            exit = result.status ?? 1;
        } else {
            const path = join(evidence, id === "O7" ? "review" : "runtime", "acceptance.json");
            const audit = verifyEvidence(path, source.sourceFingerprint, checks[id]!);
            lines.push(path, ...audit.reasons);
            if (audit.reasons.length) exit = 1;
            if (id === "O6" && audit.doc?.report) {
                const report = audit.doc.report;
                const dataHome = resolve(root, report.dataHome ?? "");
                const rel = relative(join(evidence, "runtime"), dataHome);
                if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !/^[a-f0-9]{64}$/.test(report.sessionHash)) {
                    lines.push("报告诊断位置/会话 hash 不合法"); exit = 1;
                } else {
                    const result = spawnSync(process.execPath, ["scripts/dcp-audit.ts", "--session", report.sessionHash, "--check"],
                        { cwd: root, env: { ...process.env, XDG_DATA_HOME: dataHome }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
                    lines.push(`Node CLI exit=${result.status}`, result.stdout, result.stderr);
                    if (result.status !== 0) exit = result.status ?? 1;
                }
            } else if (id === "O6") { lines.push("缺少真实 report 诊断定位"); exit = 1; }
        }
        const log = join(runDir, `${id}.log`);
        writeFileSync(log, lines.join("\n") + "\n");
        const result = { id, status: exit === 0 ? "PASS" : "FAIL", exit, log };
        results.push(result);
        console.log(`${id} ${result.status} exit=${exit} evidence=${log}`);
    }
    const allPassed = results.every((item) => item.exit === 0);
    const report = { runId, sourceFingerprint: source.sourceFingerprint, requested: selected, allPassed, items: results,
        manifest: join(runDir, "manifest.json"), directory: runDir };
    writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
    writeFileSync(join(evidence, "latest.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(`observability allPassed=${allPassed}; sourceFingerprint=${source.sourceFingerprint}`);
    return allPassed ? 0 : 1;
}
try { process.exitCode = main(); } catch (error) { console.error((error as Error).message); process.exitCode = 2; }
