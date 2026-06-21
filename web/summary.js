import * as endpoint from "./endpoint.js";
import { logger } from "./logger.js";

export const SUMMARIZE_EVERY = 20;
export const SUMMARIZE_FROM = "recursive";

export function shouldConsolidate(interactionCount) {
  return interactionCount > 0 && interactionCount % SUMMARIZE_EVERY === 0;
}

export async function consolidate(
  history,
  rollingSummary,
  interactionCount,
  endpointClient = endpoint,
) {
  if (!shouldConsolidate(interactionCount)) return rollingSummary;

  const recent = history.slice(-SUMMARIZE_EVERY).map(({ user, assistant }) => ({ user, assistant }));
  const payload =
    SUMMARIZE_FROM === "recursive" && rollingSummary
      ? [{ type: "summary", content: rollingSummary }, ...recent]
      : recent;
  const inputSize = new TextEncoder().encode(JSON.stringify(payload)).byteLength;

  try {
    const nextSummary = await endpointClient.summarize(payload);
    logger.info("memory.consolidated", {
      triggerCount: interactionCount,
      inputSize,
      summaryLength: nextSummary.length,
      source: SUMMARIZE_FROM,
    });
    return nextSummary;
  } catch (error) {
    logger.warn("memory.consolidation_failed", {
      triggerCount: interactionCount,
      inputSize,
      summaryLength: rollingSummary?.length ?? 0,
      source: SUMMARIZE_FROM,
      error: error.message,
    });
    return rollingSummary;
  }
}

