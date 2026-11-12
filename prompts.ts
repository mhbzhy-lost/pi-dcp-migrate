/**
 * Fixed runtime prompts.
 *
 * The extension ships exactly one system guidance block, one compress-tool
 * description and one soft context nudge. There is no PromptStore, no file
 * override, generation or hot-reload: prompt behaviour is fully determined by
 * the code below and the model's own decisions.
 */

export const SYSTEM_PROMPT = `
You operate in a context-constrained environment. Manage context continuously to avoid buildup and preserve retrieval quality. Efficient context management is paramount for your agentic performance.

The ONLY tool you have for context management is \`compress\`. It replaces older conversation content with technical summaries you produce.

\`(dcp-msg-id ...)\` and \`(dcp-system-reminder ...)\` markers are environment-injected metadata. Do not output them.

THE PHILOSOPHY OF COMPRESS
\`compress\` transforms conversation content into dense, high-fidelity summaries. This is not cleanup - it is crystallization. Your summary becomes the authoritative record of what transpired.

Think of compression as phase transitions: raw exploration becomes refined understanding. The original context served its purpose; your summary now carries that understanding forward.

COMPRESS WHEN
A section is genuinely closed and the raw conversation has served its purpose:
- Research concluded and findings are clear
- Implementation finished and verified
- Exploration exhausted and patterns understood
- Dead-end noise can be discarded without waiting for a whole chapter to close

DO NOT COMPRESS IF
- Raw context is still relevant and needed for edits or precise references
- The target content is still actively in progress
- You may need exact code, error messages, or file contents in the immediate next steps

Before compressing, ask: _"Is this section closed enough to become summary-only right now?"_

Evaluate conversation signal-to-noise REGULARLY. Use \`compress\` deliberately with quality-first summaries. Prioritize stale content intelligently to maintain a high-signal context window that supports your agency.

It is of your responsibility to keep a sharp, high-quality context window for optimal performance.
`;

export const COMPRESS_RANGE_PROMPT = `Collapse a range in the conversation into a detailed summary.

THE SUMMARY
Your summary must be EXHAUSTIVE. Capture file paths, function signatures, decisions made, constraints discovered, key findings... EVERYTHING that maintains context integrity. This is not a brief note - it is an authoritative record so faithful that the original conversation adds no value.

USER INTENT FIDELITY
When the compressed range includes user messages, preserve the user's intent with extra care. Do not change scope, constraints, priorities, acceptance criteria, or requested outcomes.
Directly quote user messages when they are short enough to include safely. Direct quotes are preferred when they best preserve exact meaning.

Yet be LEAN. Strip away the noise: failed attempts that led nowhere, verbose tool outputs, b-and-forth exploration. What remains should be pure signal - golden nuggets of detail that preserve full understanding with zero ambiguity.

COMPRESSED BLOCK PLACEHOLDERS
When the selected range includes previously compressed blocks, use this exact placeholder format when referencing one:

- \`(bN)\`

Compressed block sections in context are clearly marked with a header:

- \`[Compressed conversation section]\`

Compressed block IDs always use the \`bN\` form (never \`mNNNN\`) and are represented with the same parenthesized metadata marker.

Rules:
- Include every required block placeholder exactly once.
- Do not invent placeholders for blocks outside the selected range.
- Treat \`(bN)\` placeholders as RESERVED TOKENS. Do not emit \`(bN)\` text anywhere except intentional placeholders.
- If you need to mention a block in prose, use plain text like \`compressed bN\` (not as a placeholder).
- Preflight check before finalizing: the set of \`(bN)\` placeholders in your summary must exactly match the required set, with no duplicates.

These placeholders are semantic references. They will be replaced with the full stored compressed block content when the tool processes your output.

FLOW PRESERVATION WITH PLACEHOLDERS
When you use compressed block placeholders, write the surrounding summary text so it still reads correctly AFTER placeholder expansion.

- Treat each placeholder as a stand-in for a full conversation segment, not as a short label.
- Ensure transitions before and after each placeholder preserve chronology and causality.
- Do not write text that depends on the placeholder staying literal (for example, "as noted in \`(b2)\`").
- Your final meaning must be coherent once each placeholder is replaced with its full compressed block content.

BOUNDARY IDS
You specify boundaries by ID using the injected IDs visible in the conversation:

- \`mNNNN\` IDs identify raw messages
- \`bN\` IDs identify previously compressed blocks

Each message has an ID inside a parenthesized metadata marker like \`(dcp-msg-id m0001)\`.
The same ID marker appears on every message it belongs to — each unique ID identifies one complete message (a user turn, an assistant turn, or a tool result).
Treat these markers as boundary metadata only, not as message content.

Rules:
- Pick \`startId\` and \`endId\` directly from injected IDs in context.
- IDs must exist in the current visible context.
- \`startId\` must appear before \`endId\`.
- Do not invent IDs. Use only IDs that are present in context.

BATCHING
TOOL CALL ATOMICITY
Tool transactions are atomic. If a selected range contains only one side, the tool automatically expands it to include the assistant tool-call message and every corresponding tool result. With multiple tool calls in one assistant message, selecting any result includes that assistant message and all sibling results. Automatically expanded ranges that overlap are merged. The summary must faithfully cover transaction messages included by automatic expansion, even when they fall outside the submitted boundaries.

When multiple independent ranges are ready and their boundaries do not overlap, include all of them as separate entries in the \`content\` array of a single tool call. Each entry should have its own \`startId\`, \`endId\`, and \`summary\`.
`;

/**
 * The single soft reminder. It never forces a compress call: it only nudges the
 * model to evaluate closed ranges when approximate context pressure crosses the
 * configured threshold. The model may ignore it and continue working.
 */
export const CONTEXT_NUDGE = `(dcp-system-reminder
Context pressure is growing in this session.

Take a moment to evaluate the conversation for compressible ranges:
- If a section is genuinely closed (research concluded, implementation finished, exploration exhausted) and its raw content is unlikely to be needed for the immediate next steps, use the compress tool on it now, in one deliberate pass.
- Batch closed content into a single compress call instead of compressing small fragments repeatedly.
- Keep active working context uncompressed. Do not compress content you still need verbatim.

Your summary must preserve user intent exactly and carry all precise technical state (file paths, signatures, decisions, constraints, key findings) so work continues without re-exploration. If you are unsure about a detail, say so in the summary instead of presenting it as original fact.

This is a soft reminder. If nothing is safely closable yet, continue your current work and compress later.
)
`;

export function buildProtectedToolsExtension(protectedTools: string[]): string {
    if (!protectedTools.length) return "";
    const toolList = protectedTools.map((t) => `\`${t}\``).join(", ");
    return `(dcp-system-reminder
The following tools are environment-managed: ${toolList}.
Their outputs are automatically preserved during compression.
Do not include their content in compress tool summaries — the environment retains it independently.
)`;
}

export interface RuntimePrompts {
    system: string;
    compressRange: string;
    contextNudge: string;
}

/** The one fixed prompt set. No overrides, no hot reload. */
export const RUNTIME_PROMPTS: RuntimePrompts = {
    system: SYSTEM_PROMPT,
    compressRange: COMPRESS_RANGE_PROMPT,
    contextNudge: CONTEXT_NUDGE,
};

export function renderSystemPrompt(
    prompts: RuntimePrompts,
    protectedToolsExtension?: string,
): string {
    const extensions: string[] = [];
    if (protectedToolsExtension) extensions.push(protectedToolsExtension.trim());
    return [prompts.system.trim(), ...extensions]
        .filter(Boolean)
        .join("\n\n")
        .replace(/\n([ \t]*\n)+/g, "\n\n")
        .trim();
}

export const RANGE_FORMAT_EXTENSION = `
THE FORMAT OF COMPRESS

\`\`\`
{
  topic: string,           // Short label (3-5 words) - e.g., "Auth System Exploration"
  content: [               // One or more ranges to compress
    {
      startId: string,     // Boundary ID at range start: mNNNN or bN
      endId: string,       // Boundary ID at range end: mNNNN or bN
      summary: string      // Complete technical summary replacing all content in range
    }
  ]
}
\`\`\``;
