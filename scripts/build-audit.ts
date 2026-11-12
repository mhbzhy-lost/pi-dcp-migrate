#!/usr/bin/env node
// Node 不会擦除 node_modules 中的 TypeScript；随包交付离线 CLI 的预编译产物。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const sources = ["audit-types.ts", "audit-projection.ts", "audit-report.ts", "audit-html.ts", "scripts/dcp-audit.ts"];
const check = process.argv.slice(2).includes("--check");
if (process.argv.slice(2).some((arg) => arg !== "--check")) throw new Error("仅支持 --check");
const outputs = new Set(sources.map((file) => resolve(root, "dist", file.replace(/\.ts$/, ".js"))));
for (const file of sources) {
    const result = ts.transpileModule(await readFile(resolve(root, file), "utf8"), {
        fileName: file,
        reportDiagnostics: true,
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            rewriteRelativeImportExtensions: true,
        },
    });
    const errors = result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
        getCurrentDirectory: () => root, getCanonicalFileName: (name) => name, getNewLine: () => "\n",
    }));
    const target = resolve(root, "dist", file.replace(/\.ts$/, ".js"));
    const header = "// 由 scripts/build-audit.ts 生成；请修改 TypeScript 源码后重新构建。\n";
    const code = result.outputText.startsWith("#!")
        ? result.outputText.replace(/^(#![^\n]*\n)/, `$1${header}`) : header + result.outputText;
    for (const match of code.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
        const specifier = match[1]!;
        if (!specifier.startsWith("node:") && !outputs.has(resolve(dirname(target), specifier))) {
            throw new Error(`离线 CLI 出现未随包交付的运行时依赖：${file} → ${specifier}`);
        }
    }
    if (check) {
        if (await readFile(target, "utf8") !== code) throw new Error(`构建产物过期：${target}`);
    } else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, code);
    }
}
console.log(check ? "离线 CLI 构建产物与源码一致" : "已构建 dist/ 离线 CLI（仅依赖 Node 内置模块）");
