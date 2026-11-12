/**
 * DCP configuration (model-driven range-only fork).
 *
 * Small fixed configuration surface:
 *  - Search order is preserved: XDG_CONFIG_HOME/pi/dcp.jsonc|json (global) ->
 *    PI_CONFIG_DIR -> nearest project .pi directory. JSONC (comments and trailing
 *    commas) is supported at every layer.
 *  - Unknown keys (except "$schema"), wrong types and invalid values fail closed:
 *    loading throws with the file path and the offending key path, never echoing
 *    the config file content. A stale upstream config (for example
 *    compress.permission "deny") is therefore rejected instead of being silently
 *    ignored and accidentally enabling model-driven compression.
 *  - No default config file is ever created.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { AUDIT_DEFAULT_MAX_BYTES, type AuditConfig } from "./audit-types.ts";

export interface CompressConfig {
    /** Tool names/globs whose completed outputs are appended to compression summaries. */
    protectedTools: string[];
    protectTags: boolean;
    protectUserMessages: boolean;
}

export interface NudgeConfig {
    /** Percent of the model context window (finite, 0 < value < 100) for the single soft reminder. */
    thresholdPercent: number;
    /** Minimum number of valid canonical messages between two reminder anchors (positive integer). */
    minMessageInterval: number;
}

export interface PluginConfig {
    enabled: boolean;
    debug: boolean;
    protectedFilePatterns: string[];
    compress: CompressConfig;
    nudge: NudgeConfig;
    audit: AuditConfig;
}

/**
 * Tools whose completed outputs are appended to compression summaries.
 * For pi-subagents, the full subagent result text is already in the tool output,
 * so protecting "subagent" preserves it inside the summary.
 */
export const COMPRESS_DEFAULT_PROTECTED_TOOLS = ["subagent"];

function createDefaultConfig(): PluginConfig {
    return {
        enabled: true,
        debug: false,
        protectedFilePatterns: [],
        audit: { enabled: false, maxRunBytes: AUDIT_DEFAULT_MAX_BYTES },
        compress: {
            protectedTools: [...COMPRESS_DEFAULT_PROTECTED_TOOLS],
            protectTags: false,
            protectUserMessages: false,
        },
        nudge: {
            thresholdPercent: 60,
            minMessageInterval: 5,
        },
    };
}

const GLOBAL_CONFIG_DIR =
    process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "pi") : join(homedir(), ".config", "pi");
const GLOBAL_CONFIG_PATH_JSONC = join(GLOBAL_CONFIG_DIR, "dcp.jsonc");
const GLOBAL_CONFIG_PATH_JSON = join(GLOBAL_CONFIG_DIR, "dcp.json");

function findPiDir(startDir: string): string | null {
    let current = startDir;
    while (true) {
        const candidate = join(current, ".pi");
        if (existsSync(candidate) && statSync(candidate).isDirectory()) {
            return candidate;
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return null;
}

function getConfigPaths(cwd: string): {
    global: string | null;
    configDir: string | null;
    project: string | null;
} {
    const global = existsSync(GLOBAL_CONFIG_PATH_JSONC)
        ? GLOBAL_CONFIG_PATH_JSONC
        : existsSync(GLOBAL_CONFIG_PATH_JSON)
          ? GLOBAL_CONFIG_PATH_JSON
          : null;

    let configDir: string | null = null;
    const piConfigDir = process.env.PI_CONFIG_DIR;
    if (piConfigDir) {
        const jsonc = join(piConfigDir, "dcp.jsonc");
        const json = join(piConfigDir, "dcp.json");
        configDir = existsSync(jsonc) ? jsonc : existsSync(json) ? json : null;
    }

    let project: string | null = null;
    if (cwd) {
        const piDir = findPiDir(cwd);
        if (piDir) {
            const jsonc = join(piDir, "dcp.jsonc");
            const json = join(piDir, "dcp.json");
            project = existsSync(jsonc) ? jsonc : existsSync(json) ? json : null;
        }
    }

    return { global, configDir, project };
}

/** Strip JSONC comments and trailing commas without a heavy dependency. */
function stripJsonComments(input: string): string {
    let out = "";
    let i = 0;
    let inString = false;
    let stringChar = "";
    while (i < input.length) {
        const ch = input[i];
        const next = input[i + 1];

        if (inString) {
            out += ch;
            if (ch === "\\") {
                out += next ?? "";
                i += 2;
                continue;
            }
            if (ch === stringChar) inString = false;
            i++;
            continue;
        }

        if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            out += ch;
            i++;
            continue;
        }

        if (ch === "/" && next === "/") {
            while (i < input.length && input[i] !== "\n") i++;
            continue;
        }

        if (ch === "/" && next === "*") {
            i += 2;
            while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
            i += 2;
            continue;
        }

        out += ch;
        i++;
    }
    // remove trailing commas
    return out.replace(/,(\s*[}\]])/g, "$1");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Fail closed with file path and offending key path; never echoes config file content. */
function configError(filePath: string, keyPath: string, reason: string): Error {
    return new Error(
        `Invalid DCP config: "${keyPath}" ${reason} (file: ${filePath}). ` +
            "Refusing to load the DCP extension; fix or remove the offending key. " +
            "Config file content is intentionally not echoed.",
    );
}

function loadConfigFile(configPath: string): Record<string, unknown> | null {
    let fileContent: string;
    try {
        fileContent = readFileSync(configPath, "utf-8");
    } catch (error) {
        throw configError(configPath, "(file)", `cannot be read (${errorMessage(error)})`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(stripJsonComments(fileContent));
    } catch (error) {
        throw configError(configPath, "(file)", `is not valid JSON/JSONC (${errorMessage(error)})`);
    }
    if (parsed === null || parsed === undefined) return null;
    if (!isPlainObject(parsed)) throw configError(configPath, "(root)", "must be a JSON object");
    return parsed;
}

const ROOT_KEYS = new Set(["$schema", "enabled", "debug", "protectedFilePatterns", "compress", "nudge", "audit"]);
const COMPRESS_KEYS = new Set(["protectedTools", "protectTags", "protectUserMessages"]);
const NUDGE_KEYS = new Set(["thresholdPercent", "minMessageInterval"]);

function rejectUnknownKeys(
    filePath: string,
    data: Record<string, unknown>,
    allowed: Set<string>,
    prefix: string,
): void {
    for (const key of Object.keys(data)) {
        if (allowed.has(key)) continue;
        throw configError(
            filePath,
            `${prefix}${key}`,
            `is not a recognized configuration key; unknown keys are rejected (allowed: ${[...allowed].join(", ")})`,
        );
    }
}

function mergeBoolean(filePath: string, keyPath: string, value: unknown): boolean {
    if (typeof value !== "boolean") throw configError(filePath, keyPath, "must be a boolean");
    return value;
}

/** Deduplicated union merge into the target array (keeps defaults, appends new entries). */
function mergeStringArray(filePath: string, keyPath: string, target: string[], value: unknown): void {
    if (!Array.isArray(value)) throw configError(filePath, keyPath, "must be an array of strings");
    value.forEach((item, index) => {
        if (typeof item !== "string") throw configError(filePath, `${keyPath}[${index}]`, "must be a string");
        if (!target.includes(item)) target.push(item);
    });
}

function mergeLayer(config: PluginConfig, data: Record<string, unknown>, filePath: string, trusted: boolean): void {
    rejectUnknownKeys(filePath, data, ROOT_KEYS, "");
    if ("audit" in data) {
        if (!trusted) throw configError(filePath, "audit", "is allowed only in global configuration or PI_CONFIG_DIR, not project .pi");
        if (!isPlainObject(data.audit)) throw configError(filePath, "audit", "must be an object");
        rejectUnknownKeys(filePath, data.audit, new Set(["enabled", "maxRunBytes"]), "audit.");
        if ("enabled" in data.audit) config.audit.enabled = mergeBoolean(filePath, "audit.enabled", data.audit.enabled);
        if ("maxRunBytes" in data.audit) {
            const value = data.audit.maxRunBytes;
            if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
                throw configError(filePath, "audit.maxRunBytes", "must be a positive safe integer");
            }
            config.audit.maxRunBytes = value;
        }
    }
    if ("$schema" in data && typeof data.$schema !== "string") {
        throw configError(filePath, "$schema", "must be a string");
    }
    if ("enabled" in data) config.enabled = mergeBoolean(filePath, "enabled", data.enabled);
    if ("debug" in data) config.debug = mergeBoolean(filePath, "debug", data.debug);
    if ("protectedFilePatterns" in data) {
        mergeStringArray(filePath, "protectedFilePatterns", config.protectedFilePatterns, data.protectedFilePatterns);
    }
    if ("compress" in data) {
        const compress = data.compress;
        if (!isPlainObject(compress)) throw configError(filePath, "compress", "must be an object");
        rejectUnknownKeys(filePath, compress, COMPRESS_KEYS, "compress.");
        if ("protectedTools" in compress) {
            mergeStringArray(filePath, "compress.protectedTools", config.compress.protectedTools, compress.protectedTools);
        }
        if ("protectTags" in compress) {
            config.compress.protectTags = mergeBoolean(filePath, "compress.protectTags", compress.protectTags);
        }
        if ("protectUserMessages" in compress) {
            config.compress.protectUserMessages = mergeBoolean(
                filePath,
                "compress.protectUserMessages",
                compress.protectUserMessages,
            );
        }
    }
    if ("nudge" in data) {
        const nudge = data.nudge;
        if (!isPlainObject(nudge)) throw configError(filePath, "nudge", "must be an object");
        rejectUnknownKeys(filePath, nudge, NUDGE_KEYS, "nudge.");
        if ("thresholdPercent" in nudge) {
            const value = nudge.thresholdPercent;
            if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 100) {
                throw configError(filePath, "nudge.thresholdPercent", "must be a finite number with 0 < value < 100");
            }
            config.nudge.thresholdPercent = value;
        }
        if ("minMessageInterval" in nudge) {
            const value = nudge.minMessageInterval;
            if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
                throw configError(filePath, "nudge.minMessageInterval", "must be a positive integer");
            }
            config.nudge.minMessageInterval = value;
        }
    }
}

export function getConfig(cwd: string): PluginConfig {
    const config = createDefaultConfig();
    const paths = getConfigPaths(cwd);
    for (const [path, trusted] of [[paths.global, true], [paths.configDir, true], [paths.project, false]] as const) {
        if (!path) continue;
        const data = loadConfigFile(path);
        if (!data) continue;
        mergeLayer(config, data, path, trusted);
    }
    return config;
}
