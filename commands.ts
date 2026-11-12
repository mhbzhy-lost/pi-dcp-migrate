import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface CommandContext {
    pi: ExtensionAPI;
}

export function registerCommands(ctx: CommandContext): void {
    ctx.pi.registerCommand("dcp-compress", {
        description: "Send one compression request for the model to evaluate: /dcp-compress [focus]",
        handler: async (args) => {
            const focus = (args || "").trim();
            const body = focus
                ? `[Compression request] Please evaluate the conversation and use the compress tool on closed ranges. Focus: ${focus}`
                : "[Compression request] Please evaluate the conversation and use the compress tool on closed ranges.";
            ctx.pi.sendUserMessage(body);
        },
    });
}
