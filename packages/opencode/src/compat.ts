import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface CompatManifest {
  supported: string[];
  tested: Record<string, { benchmark: string; result: string; notes?: string }>;
  notes?: Record<string, string>;
}

export function loadCompatManifest(): CompatManifest {
  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "compat",
    "opencode-compat.json",
  );
  return JSON.parse(readFileSync(file, "utf8")) as CompatManifest;
}

export type CompatVerdict =
  | { level: "supported"; version: string }
  | { level: "untested"; version: string; supported: string[] }
  | { level: "unknown"; version: null };

/** `opencode --version` prints a bare semver; some builds prefix it. */
export function parseOpencodeVersion(output: string): string | null {
  const m = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(output);
  return m?.[1] ?? null;
}

export function checkCompat(
  versionOutput: string | null,
  manifest = loadCompatManifest(),
): CompatVerdict {
  const version = versionOutput ? parseOpencodeVersion(versionOutput) : null;
  if (!version) return { level: "unknown", version: null };
  if (manifest.supported.includes(version)) return { level: "supported", version };
  return { level: "untested", version, supported: manifest.supported };
}
