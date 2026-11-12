// scripts/verify.ts
//
// 验收入口编排 CLI（不是新测试，不含行为断言，不创建 fixture，不发起模型请求）：
// - F1..F4：按明确清单运行仓库既有检查（tsc --noEmit 与九个既有 test-*.ts 脚本），
//   记录真实 exit code；文件缺失即失败，不做 glob 静默跳过。
// - F5/F6：只核对既有独立审阅证据（.evidence/audit/scope-review.json）与真实运行
//   证据（.evidence/runtime/acceptance.json）的存在性、status、必需 checks、引用
//   文件存在性与当前源码指纹；缺失/blocked/failed/指纹不匹配/引用不存在即 FAIL。
//
// 所有子进程 cwd 固定为仓库根；隔离仅通过环境变量 HOME、XDG_CONFIG_HOME、
// XDG_DATA_HOME、PI_CONFIG_DIR、PI_CODING_AGENT_DIR、TMPDIR 指向本次运行的独立
// 证据目录实现。证据以绝对路径写入 .evidence/runs/<runId>/（manifest.json、
// report.json、F*.log），并更新索引 .evidence/latest.json。
// 用法：npm run verify [-- --only F1[,F2,...]]

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const MAX_BUFFER = 64 * 1024 * 1024;

type ItemId = "F1" | "F2" | "F3" | "F4" | "F5" | "F6";
const ALL_ITEMS: ItemId[] = ["F1", "F2", "F3", "F4", "F5", "F6"];

// 明确清单：九个既有测试脚本（不允许 glob 空跑通过）。
const TEST_FILES = [
    "test-architecture.ts",
    "test-range.ts",
    "test-runtime.ts",
    "test-compress-tool-expansion.ts",
    "test-tool-transaction-integrity.ts",
    "test-tool-call-metadata-integrity.ts",
    "test-canonical-conversation.ts",
    "test-pi-invisible-messages.ts",
    "test-fork-inheritance.ts",
];

// 明确清单：本地工具链命令（禁止 npx 临时下载）。
const BINARIES = ["node_modules/.bin/tsc", "node_modules/.bin/tsx"];

// 明确清单：固定版本 Host / 依赖包（用于版本记录，必须已安装）。
const HOST_PACKAGES = [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "typebox",
    "typescript",
    "tsx",
    "@types/node",
];

// 指纹覆盖的固定文件；根 TS（含测试）与 scripts/*.ts 动态枚举。
// 排除 node_modules、.evidence、docs/plans，避免计划进度记录造成自失效。
const FIXED_MANIFEST_FILES = [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "dcp.schema.json",
    "README.md",
    "LICENSE",
    ".gitignore",
];

const F5_EVIDENCE_REL = ".evidence/audit/scope-review.json";
const F5_COMPANION_REL = ".evidence/audit/scope-review.md";
const F6_EVIDENCE_REL = ".evidence/runtime/acceptance.json";
const F5_CHECK_IDS = ["scope-1", "scope-2", "scope-3", "scope-4", "scope-5", "scope-6"];
const F6_CHECK_IDS = [
    "autonomous-compress",
    "projection",
    "continuation",
    "restart",
    "branch-isolation",
];

const tscBin = path.join(repoRoot, "node_modules", ".bin", "tsc");
const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");

interface CommandStep {
    kind: "command";
    name: string;
    command: string;
    args: string[];
}

interface AuditStep {
    kind: "audit";
    name: string;
    evidenceRel: string;
    companionRel?: string;
    requiredCheckIds: string[];
}

type Step = CommandStep | AuditStep;

function testStep(file: string): CommandStep {
    return { kind: "command", name: `tsx ${file}`, command: tsxBin, args: [file] };
}

const ITEMS: Record<ItemId, { title: string; steps: Step[] }> = {
    F1: {
        title: "类型检查与既有架构门禁",
        steps: [
            { kind: "command", name: "tsc --noEmit", command: tscBin, args: ["--noEmit"] },
            testStep("test-architecture.ts"),
        ],
    },
    F2: {
        title: "既有 range / runtime / compress-tool-expansion 场景",
        steps: [testStep("test-range.ts"), testStep("test-runtime.ts"), testStep("test-compress-tool-expansion.ts")],
    },
    F3: {
        title: "既有事务完整性 / 元数据 / canonical / invisible 场景",
        steps: [
            testStep("test-tool-transaction-integrity.ts"),
            testStep("test-tool-call-metadata-integrity.ts"),
            testStep("test-canonical-conversation.ts"),
            testStep("test-pi-invisible-messages.ts"),
        ],
    },
    F4: {
        title: "既有 fork 继承 / 持久化场景",
        steps: [testStep("test-fork-inheritance.ts")],
    },
    F5: {
        title: "独立范围审阅证据核对（不运行 LLM）",
        steps: [
            {
                kind: "audit",
                name: "核对 scope-review.json",
                evidenceRel: F5_EVIDENCE_REL,
                companionRel: F5_COMPANION_REL,
                requiredCheckIds: F5_CHECK_IDS,
            },
        ],
    },
    F6: {
        title: "真实运行验收证据核对（不制造行为数据）",
        steps: [
            {
                kind: "audit",
                name: "核对 acceptance.json",
                evidenceRel: F6_EVIDENCE_REL,
                requiredCheckIds: F6_CHECK_IDS,
            },
        ],
    },
};

interface StepResult {
    name: string;
    status: "PASS" | "FAIL";
    exit: number | null;
    detail?: string;
}

interface ItemResult {
    id: ItemId;
    title: string;
    status: "PASS" | "FAIL";
    exit: number | null;
    log: string;
    steps: StepResult[];
}

function sha256File(absPath: string): string {
    return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

function isFile(rel: string): boolean {
    const abs = path.join(repoRoot, rel);
    return existsSync(abs) && statSync(abs).isFile();
}

function probe(command: string, args: string[], env: NodeJS.ProcessEnv): { text: string; exit: number | null } {
    const res = spawnSync(command, args, { cwd: repoRoot, env, encoding: "utf8", maxBuffer: MAX_BUFFER });
    if (res.error) return { text: `error: ${res.error.message}`, exit: res.status ?? null };
    const text = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
    return { text, exit: res.status ?? null };
}

function packageVersion(name: string): string | null {
    const pkgPath = path.join(repoRoot, "node_modules", name, "package.json");
    if (!existsSync(pkgPath)) return null;
    try {
        const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
        return typeof parsed.version === "string" ? parsed.version : null;
    } catch {
        return null;
    }
}

interface SourceManifest {
    files: Record<string, string>;
    fingerprint: string;
}

function buildSourceManifest(): SourceManifest {
    const rels: string[] = [];
    for (const name of readdirSync(repoRoot).sort()) {
        if (!name.endsWith(".ts")) continue;
        if (isFile(name)) rels.push(name);
    }
    const scriptsDir = path.join(repoRoot, "scripts");
    if (existsSync(scriptsDir) && statSync(scriptsDir).isDirectory()) {
        for (const name of readdirSync(scriptsDir).sort()) {
            if (!name.endsWith(".ts")) continue;
            const rel = `scripts/${name}`;
            if (isFile(rel)) rels.push(rel);
        }
    }
    rels.push(...FIXED_MANIFEST_FILES);
    const unique = [...new Set(rels)].sort();
    const files: Record<string, string> = {};
    for (const rel of unique) files[rel] = sha256File(path.join(repoRoot, rel));
    const canonical = Object.entries(files)
        .map(([rel, hash]) => `${rel}:${hash}`)
        .join("\n");
    const fingerprint = createHash("sha256").update(`${canonical}\n`).digest("hex");
    return { files, fingerprint };
}

interface AuditOutcome {
    ok: boolean;
    reasons: string[];
    notes: string[];
}

function auditEvidence(step: AuditStep, currentFingerprint: string): AuditOutcome {
    const reasons: string[] = [];
    const notes: string[] = [];
    const abs = path.join(repoRoot, step.evidenceRel);
    if (!existsSync(abs)) {
        reasons.push(`证据文件缺失: ${abs}`);
        return { ok: false, reasons, notes };
    }
    if (step.companionRel) {
        const companionAbs = path.join(repoRoot, step.companionRel);
        notes.push(existsSync(companionAbs) ? `伴随说明存在: ${companionAbs}` : `伴随说明缺失（仅记录，不据此失败）: ${companionAbs}`);
    }
    let doc: unknown;
    try {
        doc = JSON.parse(readFileSync(abs, "utf8"));
    } catch (error) {
        reasons.push(`证据 JSON 解析失败: ${abs}: ${error instanceof Error ? error.message : String(error)}`);
        return { ok: false, reasons, notes };
    }
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
        reasons.push("证据顶层必须是 JSON 对象");
        return { ok: false, reasons, notes };
    }
    const obj = doc as Record<string, unknown>;

    if (obj.status !== "passed") {
        reasons.push(`status=${JSON.stringify(obj.status ?? null)}（要求 "passed"；blocked/failed/缺失均不通过）`);
    }

    if (typeof obj.sourceFingerprint !== "string") {
        reasons.push(`sourceFingerprint 缺失或非字符串: ${JSON.stringify(obj.sourceFingerprint ?? null)}`);
    } else if (obj.sourceFingerprint !== currentFingerprint) {
        reasons.push(`sourceFingerprint 不匹配: 证据=${obj.sourceFingerprint} 当前=${currentFingerprint}（证据不对应当前交付版本）`);
    }

    if (!Array.isArray(obj.checks)) {
        reasons.push("checks 缺失或不是数组");
        return { ok: reasons.length === 0, reasons, notes };
    }

    const checksById = new Map<string, Record<string, unknown>>();
    for (const entry of obj.checks) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
            reasons.push(`checks 含非对象条目: ${JSON.stringify(entry)}`);
            continue;
        }
        const check = entry as Record<string, unknown>;
        const id = typeof check.id === "string" ? check.id : null;
        if (id === null) {
            reasons.push(`checks 含缺失 id 的条目: ${JSON.stringify(check)}`);
            continue;
        }
        checksById.set(id, check);
    }

    for (const requiredId of step.requiredCheckIds) {
        if (!checksById.has(requiredId)) reasons.push(`缺少必需 check: ${requiredId}`);
    }

    for (const [id, check] of checksById) {
        if (check.status !== "passed") {
            reasons.push(`check ${id} status=${JSON.stringify(check.status ?? null)}（要求 "passed"）`);
        }
        const evidence = check.evidence;
        if (!Array.isArray(evidence) || evidence.length === 0) {
            reasons.push(`check ${id} 缺少非空 evidence 引用列表`);
            continue;
        }
        for (const ref of evidence) {
            if (typeof ref !== "object" || ref === null || Array.isArray(ref)) {
                reasons.push(`check ${id} 的 evidence 含非对象条目: ${JSON.stringify(ref)}`);
                continue;
            }
            const refObj = ref as Record<string, unknown>;
            if (typeof refObj.path !== "string" || refObj.path.length === 0) {
                reasons.push(`check ${id} 的 evidence 条目缺少 path: ${JSON.stringify(ref)}`);
                continue;
            }
            if (typeof refObj.locator !== "string" || refObj.locator.length === 0) {
                reasons.push(`check ${id} 的 evidence 条目缺少 locator: ${JSON.stringify(ref)}`);
            }
            const refAbs = path.isAbsolute(refObj.path) ? refObj.path : path.join(repoRoot, refObj.path);
            if (!existsSync(refAbs)) {
                reasons.push(`check ${id} 引用的证据不存在: ${refAbs}`);
            }
        }
    }

    return { ok: reasons.length === 0, reasons, notes };
}

function parseArgs(argv: string[]): ItemId[] {
    const selected = new Set<ItemId>();
    let sawOnly = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--only") {
            const value = argv[++i];
            if (value === undefined) throw new Error("--only 需要参数值（F1..F6，可逗号分隔）");
            sawOnly = true;
            for (const part of value.split(",")) {
                const id = part.trim().toUpperCase() as ItemId;
                if (!ALL_ITEMS.includes(id)) throw new Error(`未知 F 项: ${part}（允许 F1..F6）`);
                selected.add(id);
            }
        } else if (arg.startsWith("--only=")) {
            const value = arg.slice("--only=".length);
            sawOnly = true;
            for (const part of value.split(",")) {
                const id = part.trim().toUpperCase() as ItemId;
                if (!ALL_ITEMS.includes(id)) throw new Error(`未知 F 项: ${part}（允许 F1..F6）`);
                selected.add(id);
            }
        } else {
            throw new Error(`未知参数: ${arg}（用法: npm run verify [-- --only F1[,F2,...]]）`);
        }
    }
    if (!sawOnly) return [...ALL_ITEMS];
    return ALL_ITEMS.filter((id) => selected.has(id));
}

function checkPreconditions(): string[] {
    const missing: string[] = [];
    for (const rel of [...BINARIES, ...TEST_FILES, ...FIXED_MANIFEST_FILES]) {
        if (!isFile(rel)) missing.push(rel);
    }
    for (const pkg of HOST_PACKAGES) {
        const rel = path.join("node_modules", pkg, "package.json");
        if (!isFile(rel)) missing.push(rel);
    }
    return missing;
}

function main(): number {
    let requested: ItemId[];
    try {
        requested = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 2;
    }

    const missing = checkPreconditions();
    if (missing.length > 0) {
        console.error("PRECONDITION FAILED: 以下明确清单文件缺失（拒绝 glob 静默跳过）:");
        for (const rel of missing) console.error(`- ${path.join(repoRoot, rel)}`);
        return 2;
    }

    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const runDir = path.join(repoRoot, ".evidence", "runs", runId);
    const envDir = path.join(runDir, "env");
    const isolation: Record<string, string> = {
        HOME: path.join(envDir, "home"),
        XDG_CONFIG_HOME: path.join(envDir, "xdg-config"),
        XDG_DATA_HOME: path.join(envDir, "xdg-data"),
        PI_CONFIG_DIR: path.join(envDir, "pi-config"),
        PI_CODING_AGENT_DIR: path.join(envDir, "pi-coding-agent"),
        TMPDIR: path.join(envDir, "tmp"),
    };
    for (const dir of [runDir, ...Object.values(isolation)]) mkdirSync(dir, { recursive: true });
    const isolatedEnv: NodeJS.ProcessEnv = { ...process.env, ...isolation };

    const gitHead = probe("git", ["rev-parse", "HEAD"], isolatedEnv);
    const gitStatus = probe("git", ["status", "--porcelain"], isolatedEnv);
    const tscVersion = probe(tscBin, ["--version"], isolatedEnv);
    const tsxVersion = probe(tsxBin, ["--version"], isolatedEnv);

    const manifest = buildSourceManifest();
    const packageVersions: Record<string, string | null> = {};
    for (const pkg of HOST_PACKAGES) packageVersions[pkg] = packageVersion(pkg);

    const versions = {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        tsc: tscVersion.text,
        tsx: tsxVersion.text,
        packages: packageVersions,
    };

    const manifestDoc = {
        runId,
        generatedAt: new Date().toISOString(),
        repoRoot,
        git: { head: gitHead.text.trim() || null, headExit: gitHead.exit, dirty: gitStatus.text.trim() || "" },
        versions,
        isolation,
        sourceFingerprint: manifest.fingerprint,
        files: manifest.files,
    };
    writeFileSync(path.join(runDir, "manifest.json"), `${JSON.stringify(manifestDoc, null, 2)}\n`);

    console.log(`verify run: ${runId}`);
    console.log(`run dir: ${runDir}`);
    console.log(`source fingerprint: ${manifest.fingerprint}`);

    const results: ItemResult[] = [];
    for (const id of requested) {
        const item = ITEMS[id];
        const logLines: string[] = [
            `# ${id} ${item.title}`,
            `runId: ${runId}`,
            `generatedAt: ${new Date().toISOString()}`,
            `repoRoot(cwd for all subprocesses): ${repoRoot}`,
            `node: ${versions.node} (${versions.platform})`,
            `tsc: ${versions.tsc}`,
            `tsx: ${versions.tsx}`,
            `sourceFingerprint: ${manifest.fingerprint}`,
            `isolation: ${JSON.stringify(isolation)}`,
            "",
        ];
        const stepResults: StepResult[] = [];
        let itemExit: number | null = 0;

        for (const step of item.steps) {
            if (step.kind === "command") {
                const res = spawnSync(step.command, step.args, {
                    cwd: repoRoot,
                    env: isolatedEnv,
                    encoding: "utf8",
                    maxBuffer: MAX_BUFFER,
                });
                const exit = res.status ?? null;
                const passed = exit === 0;
                logLines.push(
                    `## step: ${step.name}`,
                    `command: ${step.command} ${step.args.join(" ")}`,
                    `cwd: ${repoRoot}`,
                    `exit: ${exit === null ? `null (error: ${res.error?.message ?? "spawn failed"})` : exit}`,
                    "--- stdout+stderr ---",
                    `${res.stdout ?? ""}${res.stderr ?? ""}`,
                    "--- end ---",
                    "",
                );
                stepResults.push({ name: step.name, status: passed ? "PASS" : "FAIL", exit });
                if (!passed && itemExit === 0) itemExit = exit === null ? 1 : exit;
            } else {
                const outcome = auditEvidence(step, manifest.fingerprint);
                const abs = path.join(repoRoot, step.evidenceRel);
                logLines.push(
                    `## step: ${step.name}`,
                    `evidence: ${abs}`,
                    `requiredCheckIds: ${step.requiredCheckIds.join(", ")}`,
                    `currentSourceFingerprint: ${manifest.fingerprint}`,
                    `result: ${outcome.ok ? "PASS" : "FAIL"}`,
                );
                for (const note of outcome.notes) logLines.push(`note: ${note}`);
                for (const reason of outcome.reasons) logLines.push(`reason: ${reason}`);
                logLines.push("");
                stepResults.push({
                    name: step.name,
                    status: outcome.ok ? "PASS" : "FAIL",
                    exit: outcome.ok ? 0 : 1,
                    detail: outcome.reasons.join("; ") || undefined,
                });
                if (!outcome.ok && itemExit === 0) itemExit = 1;
            }
        }

        const itemPassed = stepResults.every((s) => s.status === "PASS");
        const status: "PASS" | "FAIL" = itemPassed ? "PASS" : "FAIL";
        const logPath = path.join(runDir, `${id}.log`);
        writeFileSync(logPath, `${logLines.join("\n")}\n`);
        const result: ItemResult = { id, title: item.title, status, exit: itemPassed ? 0 : itemExit, log: logPath, steps: stepResults };
        results.push(result);
        console.log(`${id} ${status} exit=${result.exit} evidence=${logPath}`);
        for (const s of stepResults) {
            console.log(`  - ${s.name}: ${s.status} exit=${s.exit}${s.detail ? ` (${s.detail})` : ""}`);
        }
    }

    const allPassed = results.every((r) => r.status === "PASS");
    const reportDoc = {
        runId,
        generatedAt: new Date().toISOString(),
        repoRoot,
        requested,
        git: manifestDoc.git,
        versions,
        sourceFingerprint: manifest.fingerprint,
        items: results,
        allPassed,
    };
    writeFileSync(path.join(runDir, "report.json"), `${JSON.stringify(reportDoc, null, 2)}\n`);

    const latestPath = path.join(repoRoot, ".evidence", "latest.json");
    writeFileSync(
        latestPath,
        `${JSON.stringify(
            {
                runId,
                dir: runDir,
                generatedAt: reportDoc.generatedAt,
                requested,
                allPassed,
                sourceFingerprint: manifest.fingerprint,
                items: results.map((r) => ({ id: r.id, status: r.status, exit: r.exit, log: r.log })),
                manifest: path.join(runDir, "manifest.json"),
                report: path.join(runDir, "report.json"),
            },
            null,
            2,
        )}\n`,
    );

    console.log(`allPassed: ${allPassed}`);
    console.log(`latest index: ${latestPath}`);
    return allPassed ? 0 : 1;
}

process.exit(main());
