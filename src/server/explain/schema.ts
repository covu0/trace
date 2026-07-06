/**
 * Answer types + the JSON schema the model is constrained to. One claim = one
 * sentence = one unit of validation. The model cannot emit prose outside this
 * structure, which is what makes sentence-level citation enforcement possible.
 */

export type CitationRef = {
  type: "commit" | "pr" | "issue";
  /** commit: sha (≥7 hex chars); pr/issue: the number as a string. */
  ref: string;
};

export type Claim = {
  text: string;
  /** "explicit": stated in the evidence. "inferred": deduced from diffs/timing. */
  kind: "explicit" | "inferred";
  citations: CitationRef[];
};

export type TimelineEntry = {
  evidence: CitationRef;
  summary: string;
};

/** Raw model output shape (pre-validation). */
export type ModelAnswer = {
  insufficient_evidence: boolean;
  verdict: Claim | null;
  claims: Claim[];
  timeline: TimelineEntry[];
};

export const INSUFFICIENT_MESSAGE = "Not enough evidence to answer confidently";

/** What the API returns after validation. */
export type ExplainResult =
  | {
      kind: "answer";
      verdict: Claim;
      claims: Claim[];
      timeline: TimelineEntry[];
      /** Validator transparency: how much the model said vs. what survived. */
      dropped: { claims: number; timeline: number; citations: number };
      model: string;
      usage: { inputTokens: number; outputTokens: number };
    }
  | {
      kind: "insufficient";
      message: typeof INSUFFICIENT_MESSAGE;
      /** True when the gate short-circuited and no LLM call was made. */
      gated: boolean;
    };

const citationSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["commit", "pr", "issue"] },
    ref: { type: "string" },
  },
  required: ["type", "ref"],
  additionalProperties: false,
} as const;

const claimSchema = {
  type: "object",
  properties: {
    text: { type: "string", description: "Exactly one sentence." },
    kind: { type: "string", enum: ["explicit", "inferred"] },
    citations: { type: "array", items: citationSchema },
  },
  required: ["text", "kind", "citations"],
  additionalProperties: false,
} as const;

export const ANSWER_JSON_SCHEMA = {
  type: "object",
  properties: {
    insufficient_evidence: {
      type: "boolean",
      description: "True if the evidence cannot support a confident answer.",
    },
    verdict: {
      anyOf: [claimSchema, { type: "null" }],
      description: "The one-or-two sentence answer to WHY, with citations.",
    },
    claims: {
      type: "array",
      items: claimSchema,
      description: "The narrative, one sentence per claim, each cited.",
    },
    timeline: {
      type: "array",
      items: {
        type: "object",
        properties: {
          evidence: citationSchema,
          summary: { type: "string", description: "One line: what changed and why." },
        },
        required: ["evidence", "summary"],
        additionalProperties: false,
      },
      description: "Chronological evolution, oldest first, each entry tied to evidence.",
    },
  },
  required: ["insufficient_evidence", "verdict", "claims", "timeline"],
  additionalProperties: false,
} as const;
