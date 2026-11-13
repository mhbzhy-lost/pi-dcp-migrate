import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PluginConfig } from "./config.ts";
import type { Logger } from "./logger.ts";
import type { RuntimePrompts } from "./prompts.ts";
import type { SessionState } from "./types.ts";
import type { AuditObserver, AuditRecorder } from "./audit-types.ts";

export interface CompressionRuntime {
    state: SessionState;
    config: PluginConfig;
    logger: Logger;
    audit?: AuditObserver;
}

export interface CompressContext extends CompressionRuntime {
    pi: ExtensionAPI;
    prompts: () => RuntimePrompts;
    audit?: AuditRecorder;
}

export interface RangeCompressArgs {
    topic: string;
    content: Array<{ startId: string; endId: string; summary: string }>;
}
