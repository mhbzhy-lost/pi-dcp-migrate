import type { LoadedAuditSession, LoadedAuditRecord } from "./audit-types.ts";
import { auditSessionIssues } from "./audit-report.ts";

export function escapeAuditHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function full(title: string, value: unknown): string {
    return `<details><summary>${escapeAuditHtml(title)}</summary><pre>${escapeAuditHtml(JSON.stringify(value, null, 2))}</pre></details>`;
}
const eventLabels: Record<string, string> = { request: "模型原始请求", requested: "边界解析/当时映射",
    plans: "事务扩展与合并", materialization: "模型摘要 → 旧块展开 → 保护追加 → 最终回填",
    commit: "内存提交（不等于落盘/应用）", "tool-complete": "工具完成", "tool-error": "工具失败（此前提交未回滚）",
    context: "DCP 上下文应用", lifecycle: "生命周期" };
function bodyObject(entry: LoadedAuditRecord): Record<string, any> {
    const value = entry.data.body;
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function blockKey(session: string, block: Record<string, any>): string {
    return `${session}:${block.blockId}:${block.compressMessageId}:${block.compressCallId ?? ""}`;
}
export function renderAuditHtml(session: LoadedAuditSession): string {
    const issues = auditSessionIssues(session);
    const committed = new Map<string, { label: string; applications: number }>();
    const applications = new Map<string, number>();
    const sections: string[] = [];
    for (const run of session.runs) {
        const identity = run.manifest.identity;
        // 同文件重启可跨 run 关联；fork 用自己的 session 身份，不能把同名 bN 当同一个块。
        const sessionKey = identity.sessionFile ?? identity.sessionId;
        const events: string[] = [];
        for (const entry of run.records) {
            const { record, data } = entry;
            const id = `${record.processRunId}-${record.seq}`;
            const body = bodyObject(entry);
            let note = "";
            let comparison = "";
            if (record.event === "commit" && body.block) {
                committed.set(blockKey(sessionKey, body.block), { label: `b${body.block.blockId} / ${id}`, applications: 0 });
            }
            if (record.event === "context" && data.meta && typeof data.meta === "object" && !Array.isArray(data.meta)) {
                const diff = data.diff as Record<string, any> | undefined;
                const blocks = Array.isArray(diff?.inserted) ? diff.inserted.map((item: any) => item.block) : [];
                note = blocks.map((block: any) => {
                    const key = blockKey(sessionKey, block);
                    const count = (applications.get(key) ?? 0) + 1;
                    applications.set(key, count);
                    const commit = committed.get(key);
                    if (commit) commit.applications++;
                    return `b${block.blockId}: ${count === 1 ? "本组记录首次" : "重复"} DCP 输出应用；` +
                        (commit ? "已关联录制的提交" : "预存块/请求未录制或其他分支继承，不能推断从未请求");
                }).join("\n");
                if (diff) {
                    comparison = full("本次真实字节量 / 新增移除 / 插入 / 保留 / 提醒ID差异", diff);
                    const before = data.before as Record<string, any>;
                    const projection = data.projection as Record<string, any>;
                    for (const removed of diff.removed ?? []) {
                        comparison += `<div id="${id}-entry-${escapeAuditHtml(removed.entryId ?? String(removed.inputOrdinal))}">` +
                            full(`本次移除：${removed.entryId ?? "unbound"}（input ${removed.inputOrdinal}）`, before.entries[removed.inputOrdinal]) + "</div>";
                    }
                    for (const inserted of diff.inserted ?? []) {
                        comparison += `<div id="${id}-block-${inserted.block.blockId}">` +
                            full(`实际回填：b${inserted.block.blockId}（output ${inserted.outputOrdinal}，origin 见下）`, projection.entries[inserted.outputOrdinal]) + "</div>";
                    }
                }
            }
            events.push(`<article id="${id}"><h3>${record.seq}. ${escapeAuditHtml(eventLabels[record.event] || record.event)}</h3>` +
                `<p>${escapeAuditHtml(record.time)} · contextPass=${record.contextPassId ?? "无"} · leaf=${escapeAuditHtml(record.identity.leafId ?? "无")}</p>` +
                (note ? `<pre>${escapeAuditHtml(note)}</pre>` : "") + comparison + full("记录身份与附件校验值", record) +
                Object.entries(data).map(([name, value]) => full(name, value)).join("") + "</article>");
        }
        sections.push(`<section><h2>录制进程 ${escapeAuditHtml(run.manifest.processRunId)}</h2>` +
            full("会话 / parent / 版本 / production-only 源码指纹", run.manifest) +
            (run.status ? full("录制暂停：后续未知，不是压缩失败", run.status) : "") + events.join("") + "</section>");
    }
    const pending = [...committed.values()].filter((entry) => !entry.applications).map((entry) => entry.label);
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">` +
        `<meta name="referrer" content="no-referrer"><title>DCP 本地压缩审计</title>` +
        `<style>body{max-width:1100px;margin:2em auto;padding:0 1em;font-family:system-ui;line-height:1.5}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:1em}article{border-top:1px solid #bbb;margin:2em 0}summary{cursor:pointer}h1,h2,h3{overflow-wrap:anywhere}</style></head><body>` +
        `<h1>DCP 本地压缩审计</h1><p>会话 hash：${escapeAuditHtml(session.sessionHash)}</p>` +
        `<p>边界：DCP context handler 输入 → 摘要投影 → DCP 输出。不是最终 provider 请求，不证明模型已收到。contextPassId 不是 HTTP 请求 ID。</p>` +
        `<p>所有附件原文完整折叠展示，不静默截断。字节量为 JSON UTF-8 实际字节，不是 token、账单、缓存或语义质量评分。原文可能包含敏感信息，请勿分享。</p>` +
        full(issues.length ? "记录缺口 / 暂停 / 完整性问题" : "未发现文件完整性缺口（不代表摘要语义正确）", issues) +
        full("已提交但尚未观察到同会话应用；存在缺口时是否应用未知", pending) + sections.join("") + "</body></html>";
}
