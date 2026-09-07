/** Events the loop reports while it runs. A host renders them; the CLI traces them. */
export type LoopEvent =
  | {
      type: "check_status";
      name: string;
      conclusion: "success" | "failure";
      detail?: string;
      retryable?: boolean;
    }
  | { type: "notice"; message: string; level?: "info" | "warn" };
