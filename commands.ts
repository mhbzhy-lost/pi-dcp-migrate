import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { observeAudit, type AuditRecorder } from "./audit-types.ts";

export interface CommandContext {
    pi: ExtensionAPI;
    audit?: (ctx: ExtensionContext) => AuditRecorder | undefined;
}

export function registerCommands(ctx: CommandContext): void {
    ctx.pi.registerCommand("dcp-compress", {
        description: "Send one compression request for the model to evaluate: /dcp-compress [focus]",
        handler: async (args, commandCtx) => {
            const focus = (args || "").trim();
            const body = focus
                ? `[Compression request] Please evaluate the conversation and use the compress tool on closed ranges. Focus: ${focus}`
                : "[Compression request] Please evaluate the conversation and use the compress tool on closed ranges.";
            const audit = ctx.audit?.(commandCtx);
            ctx.pi.sendUserMessage(body);
            observeAudit(audit, "injection", () => ({ phase: "compression-request",
                delivery: "queued-via-sendUserMessage", message: { role: "user", content: body },
                model: { provider: commandCtx.model?.provider ?? null, id: commandCtx.model?.id ?? null,
                    contextWindow: commandCtx.model?.contextWindow ?? null } }));
            await audit?.flush();
        },
    });
}
