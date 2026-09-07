export type InferenceFailureKind = "transient" | "model_route" | "other";

/** Stable string form of provider/SDK errors for classification. */
export function stringifyInferenceUnknown(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

/**
 * Classify provider / engine failures for bounded retry and model fallback.
 * Conservative: prefer "other" when unsure so callers never loop on a
 * non-retryable error.
 */
export function classifyInferenceFailure(message: string, raw?: unknown): InferenceFailureKind {
  const blob = `${message}\n${stringifyInferenceUnknown(raw)}`.toLowerCase();

  if (
    /\b429\b/.test(blob) ||
    /\b503\b/.test(blob) ||
    /\b502\b/.test(blob) ||
    blob.includes("rate limit") ||
    blob.includes("ratelimit") ||
    blob.includes("too many requests") ||
    blob.includes("overload") ||
    blob.includes("overloaded") ||
    blob.includes("econnreset") ||
    blob.includes("etimedout") ||
    blob.includes("timed out") ||
    blob.includes("timeout") ||
    blob.includes("temporarily unavailable") ||
    blob.includes("service unavailable") ||
    blob.includes("please retry") ||
    blob.includes("retry your request")
  ) {
    return "transient";
  }

  if (
    blob.includes("model_not_found") ||
    blob.includes("model not found") ||
    blob.includes("invalid model") ||
    blob.includes("no such model") ||
    blob.includes("unknown model") ||
    (blob.includes("does not exist") && blob.includes("model")) ||
    (blob.includes("not available") && (blob.includes("model") || blob.includes("provider"))) ||
    blob.includes("model id") ||
    blob.includes("unsupported model")
  ) {
    return "model_route";
  }

  return "other";
}
