import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands.ts";
import { getConfig, type PluginConfig } from "./config.ts";
import { registerCompressTool } from "./compress.ts";
import { resetOnCompaction } from "./compression-state.ts";
import { injectCompressNudges } from "./context-nudges.ts";
import {
    injectMessageIdTags,
    pruneMessages,
    stripHallucinations,
} from "./context-render.ts";
import { Logger } from "./logger.ts";
import { saveSessionState } from "./persistence.ts";
import { buildProtectedToolsExtension, renderSystemPrompt, RUNTIME_PROMPTS } from "./prompts.ts";
import {
    buildCanonicalConversation,
    conversationFromContext,
    loadStateForSession,
    reconcileConversation,
    sessionKeyFor,
} from "./session-runtime.ts";
import { createSessionState, resetSessionState, type SessionState } from "./types.ts";
import { createAuditRecorder } from "./audit-storage.ts";
import { auditSnapshot, diffAuditProjection } from "./audit-projection.ts";
import { observeAudit, type AuditRecorder, type AuditProjectionTrace } from "./audit-types.ts";

interface DcpRuntime {
    config: PluginConfig;
    logger: Logger;
    state: SessionState;
    audit?: AuditRecorder;
}

export class DcpController {
    private readonly runtime: DcpRuntime;
    private contextPass = 0;
    private auditNotify: ((message: string) => void) | undefined;

    constructor(private readonly pi: ExtensionAPI, cwd = process.cwd()) {
        const config = getConfig(cwd);
        const logger = new Logger(config.debug);
        this.runtime = {
            config,
            logger,
            state: createSessionState(),
        };
    }

    install(): void {
        const { config, logger, state } = this.runtime;
        if (!config.enabled) return;
        this.runtime.audit = createAuditRecorder({ config: config.audit,
            warn: (message) => { if (this.auditNotify) this.auditNotify(message); else console.error(message); } });
        registerCompressTool({ pi: this.pi, state, config, logger, audit: this.runtime.audit, prompts: () => RUNTIME_PROMPTS });
        registerCommands({ pi: this.pi });
        this.pi.on("context", (event, ctx) => this.processContext(event.messages, ctx));
        this.pi.on("before_agent_start", (event) => this.processBeforeAgentStart(event.systemPrompt));
        this.pi.on("message_end", (event) => this.stripAssistantMetadata(event.message));
        this.pi.on("session_start", async (event, ctx) => {
            await this.startSession(ctx);
            await this.recordLifecycle(ctx, event.type, { reason: event.reason, previousSessionFile: event.previousSessionFile });
        });
        this.pi.on("model_select", (event) => { state.modelContextLimit = event.model.contextWindow; });
        this.pi.on("session_compact", async (event, ctx) => {
            this.handleCompaction();
            await this.recordLifecycle(ctx, event.type, { reason: event.reason, compactionEntryId: event.compactionEntry.id });
        });
        this.pi.on("session_tree", async (event, ctx) => {
            logger.debug("Tree navigation; DCP state will reconcile on next context event");
            await this.recordLifecycle(ctx, event.type, { newLeafId: event.newLeafId, oldLeafId: event.oldLeafId });
        });
        this.pi.on("session_before_fork", async (event, ctx) => {
            await this.recordLifecycle(ctx, event.type, { entryId: event.entryId, position: event.position });
        });
        this.pi.on("session_before_switch", async (event, ctx) => {
            await this.recordLifecycle(ctx, event.type, { reason: event.reason, targetSessionFile: event.targetSessionFile });
        });
        this.pi.on("session_shutdown", async (event, ctx) => {
            // Async handler: the Host awaits session_shutdown handlers before process
            // exit, so the sidecar write completes instead of being truncated by
            // process.exit. saveSessionState catches and logs its own errors.
            if (state.sessionKey) await saveSessionState(state, logger);
            await this.recordLifecycle(ctx, event.type, { reason: event.reason, targetSessionFile: event.targetSessionFile });
            await this.runtime.audit?.flush();
        });
    }

    private async processContext(
        rawMessages: AgentMessage[],
        ctx: ExtensionContext,
    ): Promise<{ messages: AgentMessage[] } | void> {
        if (!rawMessages.length) return;
        const { state, config, logger } = this.runtime;
        const canonical = await buildCanonicalConversation(ctx);
        const messages = await conversationFromContext(rawMessages, ctx, canonical);
        const key = sessionKeyFor(ctx);
        if (state.sessionKey !== key) {
            resetSessionState(state);
            state.sessionKey = key;
        }
        reconcileConversation(state, logger, canonical);
        const audit = this.prepareAudit(ctx);
        const pass = ++this.contextPass;
        const trace: AuditProjectionTrace[] | undefined = audit?.active ? [] : undefined;
        const before = audit?.active && state.prune.messages.activeBlockIds.size
            ? this.freezeAudit(() => auditSnapshot(messages)) : undefined;
        const rendered = pruneMessages(state, logger, messages, trace);
        const projection = before ? this.freezeAudit(() => auditSnapshot(rendered, trace)) : undefined;
        injectCompressNudges(state, config, logger, rendered, RUNTIME_PROMPTS);
        injectMessageIdTags(state, rendered);
        if (audit?.active) {
            this.freezeAudit(() => {
                const meta = { contextPassId: pass, messageRefs: [...state.messageIds.byRawId],
                    activeBlocks: [...state.prune.messages.activeBlockIds].map((id) => {
                        const block = state.prune.messages.blocksById.get(id)!;
                        return { blockId: id, compressCallId: block.compressCallId ?? null,
                            compressMessageId: block.compressMessageId, anchorMessageId: block.anchorMessageId };
                    }), inputCount: messages.length, outputCount: rendered.length };
                if (before && projection && trace) {
                    const output = auditSnapshot(rendered, trace);
                    // 这两个调用之间只有本扩展原有的提醒/ID 注入；不从正文标题猜来源。
                    const annotations = projection.entries.flatMap((entry, ordinal) => entry.sha256 !== output.entries[ordinal]?.sha256
                        ? [{ ordinal, kind: "reminder-or-message-id" as const }] : []);
                    const diff = diffAuditProjection(before, projection, output, trace, annotations);
                    audit.context({ meta, before, projection, output, trace, annotations, diff }, pass);
                } else audit.context({ meta }, pass);
            });
            await audit.flush();
        }
        return { messages: rendered.map((entry) => entry.message) };
    }

    private prepareAudit(ctx: ExtensionContext): AuditRecorder | undefined {
        const audit = this.runtime.audit;
        if (!audit) return;
        this.auditNotify = (message) => ctx.ui.notify(message, "warning");
        audit.setIdentity({ sessionId: ctx.sessionManager.getSessionId(), sessionKey: sessionKeyFor(ctx),
            sessionFile: ctx.sessionManager.getSessionFile() ?? null,
            parentSession: ctx.sessionManager.getHeader()?.parentSession ?? null,
            leafId: ctx.sessionManager.getLeafId() });
        return audit;
    }

    private freezeAudit<T>(read: () => T): T | undefined {
        try { return read(); }
        catch (error) { this.runtime.audit?.pause("serialization", error, this.contextPass); return undefined; }
    }

    private async recordLifecycle(ctx: ExtensionContext, event: string, details: unknown): Promise<void> {
        const audit = this.prepareAudit(ctx);
        observeAudit(audit, "lifecycle", () => ({ event, details }));
        await audit?.flush();
    }

    private processBeforeAgentStart(systemPrompt: string): { systemPrompt: string } | void {
        if (isInternalAgent(systemPrompt)) return;
        const { config } = this.runtime;
        const extension = renderSystemPrompt(
            RUNTIME_PROMPTS,
            buildProtectedToolsExtension(config.compress.protectedTools),
        );
        return extension ? { systemPrompt: `${systemPrompt}\n\n${extension}` } : undefined;
    }

    private stripAssistantMetadata(message: AgentMessage): { message: AgentMessage } | void {
        if (message.role !== "assistant" || !Array.isArray(message.content)) return;
        let changed = false;
        const content = message.content.map((block) => {
            if (block.type !== "text" || typeof block.text !== "string") return block;
            const text = stripHallucinations(block.text);
            if (text === block.text) return block;
            changed = true;
            return { ...block, text };
        });
        return changed ? { message: { ...message, content } } : undefined;
    }

    private async startSession(ctx: ExtensionContext): Promise<void> {
        const { state, logger } = this.runtime;
        const key = sessionKeyFor(ctx);
        if (state.sessionKey !== key) {
            resetSessionState(state);
            state.sessionKey = key;
            await loadStateForSession(state, ctx, logger);
        }
        if (ctx.model?.contextWindow) state.modelContextLimit = ctx.model.contextWindow;
    }

    private handleCompaction(): void {
        resetOnCompaction(this.runtime.state);
        this.runtime.state.lastCompaction = Date.now();
        this.runtime.logger.info("Compaction detected via session_compact event; reset DCP state");
    }
}

const INTERNAL_AGENT_SIGNATURES = ["you are a context summarization assistant"];

function isInternalAgent(systemPrompt: string): boolean {
    const lower = systemPrompt.toLowerCase();
    return INTERNAL_AGENT_SIGNATURES.some((signature) => lower.includes(signature));
}
