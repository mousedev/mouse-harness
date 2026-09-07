/** Harness version, kept in lockstep across the three packages by scripts/release.mjs. */
export const MOUSE_VERSION = "0.1.0";

/** The line benchmark runners record as the harness version. */
export function versionLine(opencode: string | null): string {
  return `mouse/${MOUSE_VERSION} opencode/${opencode ?? "unavailable"}`;
}
