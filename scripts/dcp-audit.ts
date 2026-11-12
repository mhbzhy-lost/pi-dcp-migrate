#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { listAuditSessions, loadAuditSession, auditSessionIssues } from "../audit-report.ts";
import { renderAuditHtml } from "../audit-html.ts";

async function main(): Promise<number> {
    let session: string | undefined;
    let run: string | undefined;
    let out: string | undefined;
    let check = false;
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--check") check = true;
        else if (["--session", "--run", "--out"].includes(arg!)) {
            const value = args[++index];
            if (!value || value.startsWith("--")) throw new Error(`${arg} 缺少参数`);
            if (arg === "--session") session = value;
            if (arg === "--run") run = value;
            if (arg === "--out") out = value;
        } else if (arg === "--help") {
            console.log("node dist/scripts/dcp-audit.js [--session <hash> [--run <processRunId>] [--check] [--out <report.html>]]");
            return 0;
        } else throw new Error(`未知参数: ${arg}`);
    }
    if (!session) {
        if (out || run || check) throw new Error("--out/--run/--check 需要 --session");
        const entries = await listAuditSessions();
        if (!entries.length) console.log("无记录（审计默认关闭；不会创建录制目录）");
        for (const entry of entries) {
            console.log(`${entry.sessionHash} runs=${entry.runs} paused=${entry.paused} incomplete=${entry.incomplete}`);
            console.log(`node dist/scripts/dcp-audit.js --session ${entry.sessionHash} --check`);
            console.log(`npm run audit:report -- --session ${entry.sessionHash} --out report.html`);
        }
        return 0;
    }
    const loaded = await loadAuditSession(session, run);
    const issues = auditSessionIssues(loaded);
    if (check) {
        console.log(JSON.stringify({ sessionHash: session, runs: loaded.runs.length,
            records: loaded.runs.reduce((sum, item) => sum + item.records.length, 0), issues }, null, 2));
    }
    if (out) {
        const target = resolve(out);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        // 不覆盖未知已有文件；报告也是敏感原文，独占新建保证权限。
        await writeFile(target, renderAuditHtml(loaded), { mode: 0o600, flag: "wx" });
        console.log(`报告：${target}`);
    }
    if (!check && !out) throw new Error("指定 session 后请选择 --check 或 --out");
    if (issues.length) { console.error(issues.join("\n")); return 1; }
    return 0;
}
main().then((code) => { process.exitCode = code; }).catch((error) => { console.error((error as Error).message); process.exitCode = 1; });
