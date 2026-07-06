import Anthropic from "@anthropic-ai/sdk";
import type { EvidenceBundle } from "@/server/archaeology";
import { ANSWER_JSON_SCHEMA, INSUFFICIENT_MESSAGE } from "./schema";
import type { ExplainResult, ModelAnswer } from "./schema";
import { renderEvidence, SYSTEM_PROMPT } from "./prompt";
import { validateAnswer } from "./validate";

export { INSUFFICIENT_MESSAGE } from "./schema";
export type { ExplainResult, Claim, TimelineEntry } from "./schema";

const MODEL = () => process.env.TRACE_MODEL ?? "claude-opus-4-8";

let _client: Anthropic | null = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  _client ??= new Anthropic();
  return _client;
}

/**
 * Evidence bundle → validated answer.
 *
 * The insufficient gate is checked BEFORE any model interaction: a POOR
 * region returns the literal message and the LLM is never invoked — the
 * model does not get a chance to narrate thin evidence. This ordering is a
 * product invariant, not an optimization.
 */
export async function explainRegion(bundle: EvidenceBundle): Promise<ExplainResult> {
  if (bundle.quality.insufficient) {
    return { kind: "insufficient", message: INSUFFICIENT_MESSAGE, gated: true };
  }

  const response = await client().messages.create({
    model: MODEL(),
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: renderEvidence(bundle) }],
    output_config: {
      format: { type: "json_schema", schema: ANSWER_JSON_SCHEMA as unknown as Record<string, unknown> },
    },
  });

  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error(`model returned no text block (stop: ${response.stop_reason})`);
  const raw = JSON.parse(text) as ModelAnswer;

  // The model may declare insufficiency even when the gate allowed narration.
  if (raw.insufficient_evidence) {
    return { kind: "insufficient", message: INSUFFICIENT_MESSAGE, gated: false };
  }

  const validated = validateAnswer(raw, bundle);
  // If validation gutted the answer (no verdict and no claims survived),
  // honesty wins over output: report insufficiency, never a hollow narrative.
  if (!validated.verdict && validated.claims.length === 0) {
    return { kind: "insufficient", message: INSUFFICIENT_MESSAGE, gated: false };
  }

  return {
    kind: "answer",
    verdict: validated.verdict ?? validated.claims[0],
    claims: validated.claims,
    timeline: validated.timeline,
    dropped: validated.dropped,
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
