import type { PluginConfig } from "./config.ts";
import { getCurrentTokenUsage } from "./compression-state.ts";
import { isIgnoredUserMessage, type DcpMessage } from "./conversation.ts";
import { injectIntoMessage, messageHasCompress } from "./context-render.ts";
import type { Logger } from "./logger.ts";
import { assistantHasToolCall, findLastToolResultForAssistant } from "./tool-transactions.ts";
import type { SessionState } from "./types.ts";

export interface NudgeRuntime {
    contextNudge: string;
}

/**
 * Single soft reminder. Compression stays a model decision: this only surfaces a
 * throttled hint when the most recent valid usage reaches `thresholdPercent` of the
 * model context window and at least `minMessageInterval` effective canonical messages
 * have passed since the last anchor. Unknown window or missing usage simply skips the
 * reminder; the model may still call `compress` on its own at any time.
 */
export function injectCompressNudges(
    state: SessionState,
    config: PluginConfig,
    logger: Logger,
    messages: DcpMessage[],
    prompts: NudgeRuntime,
): void {
    const lastAssistant = [...messages].reverse().find((entry) => entry.message.role === "assistant");
    if (lastAssistant && messageHasCompress(lastAssistant)) {
        // A compress call just completed or is in flight: drop stale anchors.
        if (clearAnchors(state)) void saveQuietly(state, logger);
        return;
    }

    const window = state.modelContextLimit;
    const current = getCurrentTokenUsage(state, messages);
    let changed = false;
    if (window !== undefined && window > 0 && current > 0) {
        const percent = (current / window) * 100;
        if (percent >= config.nudge.thresholdPercent) {
            const candidate = findNudgeCandidate(messages);
            if (candidate) {
                changed = addAnchor(
                    state.nudges.contextLimitAnchors,
                    candidate,
                    messages,
                    config.nudge.minMessageInterval,
                );
            }
        }
    }
    applyAnchoredNudges(state, messages, prompts);
    if (changed) void saveQuietly(state, logger);
}

/**
 * The anchor candidate is the most recent effective (non-ignored) canonical entry.
 * If it is an assistant carrying tool calls, the reminder must land after the complete
 * transaction; while the last tool result is still pending, skip this round entirely.
 */
function findNudgeCandidate(messages: DcpMessage[]): DcpMessage | null {
    for (let index = messages.length - 1; index >= 0; index--) {
        const entry = messages[index]!;
        if (isIgnoredUserMessage(entry)) continue;
        if (assistantHasToolCall(entry) && !findLastToolResultForAssistant(messages, entry)) return null;
        return entry;
    }
    return null;
}

function addAnchor(
    anchors: Set<string>,
    candidate: DcpMessage,
    messages: DcpMessage[],
    interval: number,
): boolean {
    if (!candidate.id || anchors.has(candidate.id)) return false;
    const candidateIndex = messages.findIndex((entry) => entry.id === candidate.id);
    if (candidateIndex < 0) return false;
    let latestIndex = -1;
    for (let index = messages.length - 1; index >= 0; index--) {
        const id = messages[index]!.id;
        if (id && anchors.has(id)) { latestIndex = index; break; }
    }
    if (latestIndex >= 0 && countEffectiveBetween(messages, latestIndex, candidateIndex) < interval) return false;
    anchors.add(candidate.id);
    return true;
}

function countEffectiveBetween(messages: DcpMessage[], fromExclusive: number, toInclusive: number): number {
    let count = 0;
    for (let index = fromExclusive + 1; index <= toInclusive; index++) {
        if (!isIgnoredUserMessage(messages[index]!)) count++;
    }
    return count;
}

function applyAnchoredNudges(state: SessionState, messages: DcpMessage[], prompts: NudgeRuntime): void {
    injectAnchors(messages, state.nudges.contextLimitAnchors, appendGuidance(prompts.contextNudge, blockGuidance(state)));
}

function injectAnchors(messages: DcpMessage[], anchors: Set<string>, text: string): void {
    if (!text.trim()) return;
    const targets = new Set<DcpMessage>();
    for (const entry of messages) {
        if (!anchors.has(entry.id)) continue;
        // Never inject text into an assistant that carries tool calls: relocate to the
        // last tool result of its transaction, or skip while that result is pending.
        const target = assistantHasToolCall(entry) ? findLastToolResultForAssistant(messages, entry) : entry;
        if (target) targets.add(target);
    }
    for (const target of targets) injectIntoMessage(target, text);
}

function blockGuidance(state: SessionState): string {
    const refs = [...state.prune.messages.activeBlockIds].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b).map((id) => `b${id}`);
    return ["Compressed block context:", `- Active compressed blocks in this session: ${refs.length} (${refs.join(", ") || "none"})`, "- If your selected compression range includes any listed block, include each required placeholder exactly once in the summary using `(bN)`."].join("\n");
}

function appendGuidance(nudge: string, guidance: string): string {
    if (!guidance.trim()) return nudge;
    const trimmed = nudge.trimEnd();
    if (!trimmed.startsWith("(dcp-system-reminder") || !trimmed.endsWith(")")) return nudge;
    return `${trimmed.slice(0, -1).trimEnd()}\n\n${guidance}\n)${nudge.slice(trimmed.length)}`;
}

function clearAnchors(state: SessionState): boolean {
    const changed = state.nudges.contextLimitAnchors.size > 0;
    state.nudges.contextLimitAnchors.clear();
    return changed;
}

async function saveQuietly(state: SessionState, logger: Logger): Promise<void> {
    const { saveSessionState } = await import("./persistence.ts");
    await saveSessionState(state, logger);
}
