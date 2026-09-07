/**
 * Per-result tool-output cap, DSH's pruner shape: anything over the threshold
 * keeps its head and tail. Applied when the result is produced, never by
 * rewriting history, so the cached prefix stays intact. Parameters come from
 * `.mouse/policy.json -> context.prune`.
 */
import type { PrunePolicy } from "@mousedev/harness-core";

export const PRUNE_PLUGIN_FILENAME = "mouse-prune.mjs";

export function prunePluginSource(p: PrunePolicy): string {
  return `// Written by the Mouse harness from .mouse/policy.json (context.prune).
const THRESHOLD = ${p.thresholdChars}, HEAD = ${p.headChars}, TAIL = ${p.tailChars};
export default {
  name: "mouse-prune",
  events: {
    "tool.execute.after": async (_input, output) => {
      if (!output || typeof output.output !== "string") return;
      const s = output.output;
      if (s.length <= THRESHOLD) return;
      output.output = s.slice(0, HEAD) + "\\n\\n[... " + (s.length - HEAD - TAIL) + " chars omitted by mouse-prune ...]\\n\\n" + s.slice(-TAIL);
    },
  },
};
`;
}
