import Anthropic from "@anthropic-ai/sdk";
import type { EvidenceBundle } from "@/server/archaeology";
import { ANSWER_JSON_SCHEMA, INSUFFICIENT_MESSAGE } from "./schema";
import type { ExplainResult, ModelAnswer } from "./schema";
import { renderEvidence, SYSTEM_PROMPT } from "./prompt";
import { validateAnswer } from "./validate";

export { INSUFFICIENT_MESSAGE } from "./schema";
export type { ExplainResult, Claim, TimelineEntry } from "./schema";

// Default path (founder-approved 2026-07-06): Sonnet 4.6, thinking off,
// output-capped prompt — 35.7s / ~$0.08 vs 84s / ~$0.25 on Opus adaptive,
// with narrative parity on the eval region. Opus stays one env flip away;
// the A/B on truthfulness happens on feedback data once it accumulates.
const MODEL = () => process.env.TRACE_MODEL ?? "claude-sonnet-4-6";

/** Cost per query in USD from actual token usage. Prices per MTok. */
const PRICING: Array<{ match: RegExp; inPerM: number; outPerM: number }> = [
  { match: /opus/, inPerM: 5, outPerM: 25 },
  { match: /sonnet/, inPerM: 3, outPerM: 15 },
  { match: /haiku/, inPerM: 1, outPerM: 5 },
];

export function costUsd(model: string, usage: { inputTokens: number; outputTokens: number }): number {
  const p = PRICING.find((x) => x.match.test(model)) ?? PRICING[1];
  return (usage.inputTokens * p.inPerM + usage.outputTokens * p.outPerM) / 1_000_000;
}

let _client: Anthropic | null = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  // maxRetries 2 (SDK default, made explicit): only transient errors
  // (429/5xx) are retried — failed requests are not billed, and hard
  // failures like exhausted credit (400) or bad keys (401) are never retried.
  _client ??= new Anthropic({ maxRetries: 2 });
  return _client;
}

/**
 * Fail-safe wrapper for narration outages: exhausted Anthropic credit, rate
 * limits, overload, auth problems. Carries a user-safe message; the real
 * cause is logged server-side only. BYOK auth failures get an actionable
 * message since the fix is in the user's hands.
 */
export class NarrationUnavailableError extends Error {
  constructor(kind: "outage" | "byok_auth" = "outage") {
    super(
      kind === "byok_auth"
        ? "Your Anthropic API key was rejected — check it and try again."
        : "Narration is temporarily unavailable — your evidence is unaffected; try again shortly.",
    );
    this.name = "NarrationUnavailableError";
  }
}

export type ExplainOptions = {
  /**
   * Bring-your-own-key: when set, this key authenticates the Anthropic call
   * instead of the house key. Used for the request only — never cached,
   * never stored, never logged.
   */
  apiKey?: string;
};

/**
 * Evidence bundle → validated answer.
 *
 * The insufficient gate is checked BEFORE any model interaction: a POOR
 * region returns the literal message and the LLM is never invoked — the
 * model does not get a chance to narrate thin evidence. This ordering is a
 * product invariant, not an optimization.
 */
export async function explainRegion(
  bundle: EvidenceBundle,
  opts: ExplainOptions = {},
): Promise<ExplainResult> {
  if (bundle.quality.insufficient) {
    return { kind: "insufficient", message: INSUFFICIENT_MESSAGE, gated: true };
  }

  const byok = !!opts.apiKey;
  const anthropic = byok ? new Anthropic({ apiKey: opts.apiKey, maxRetries: 2 }) : client();

  let response;
  try {
    response = await anthropic.messages.create({
    model: MODEL(),
    max_tokens: 16000,
    // Thinking off by default (latency: it burned 20-25s invisibly in the M4
    // experiments). TRACE_THINKING=adaptive re-enables for quality A/Bs.
    thinking: process.env.TRACE_THINKING === "adaptive" ? { type: "adaptive" } : { type: "disabled" },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: renderEvidence(bundle) }],
      output_config: {
        // "medium" halves thinking depth vs the default "high" — latency
        // lever; revisit against feedback data if quality measurably drops.
        effort: "medium",
        format: { type: "json_schema", schema: ANSWER_JSON_SCHEMA as unknown as Record<string, unknown> },
      },
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      // Exhausted credit surfaces as a 400; bad key 401; overload 429/529.
      // Log the cause (never the key), return a safe message.
      console.error(`[explain] Anthropic API error ${err.status} (byok=${byok}): ${err.message}`);
      throw new NarrationUnavailableError(byok && err.status === 401 ? "byok_auth" : "outage");
    }
    throw err;
  }

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
