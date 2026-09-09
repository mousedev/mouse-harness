import { MOUSE_VERSION } from "@mousedev/harness-core";

/** The line benchmark runners record as the harness version. */
export function versionLine(opencode: string | null): string {
  return `mouse/${MOUSE_VERSION} opencode/${opencode ?? "unavailable"}`;
}
