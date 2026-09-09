# Redactions applied to this shared copy

The run directory is shared exactly as produced by the FrontierHarness scripts except for:

1. The Fireworks account slug that appears in the HTTP 412 "account suspended" error bodies
   logged by the agent during the 2026-09-09 02:05Z incident is replaced with
   `FIREWORKS-ACCOUNT-REDACTED` (agent logs, trajectories, exception texts, trial records of the
   affected attempts, and the meriyah canonical trial whose final attempts hit the 412).
2. The local home directory in `transport.log` copy messages is replaced with `/Users/REDACTED`.
3. The per-trial `evidence.tar.gz` (the runtime-side archive whose SHA-256 the driver verified
   before deleting the runtime; see each `transport.log`) is omitted because it would otherwise
   carry the unredacted bytes. Its extracted contents are the `jobs/`, `completion.json`,
   `runner.log`, and `manifest.json` files present in every trial directory.

No task outcome, usage record, cost, timestamp, or verifier output was altered. The fake
credentials that appear in trajectories (AKIA1234..., hf_..., ghp_..., an AWS secret, a private
key) are fixtures planted by the sanitize-git-repo, vulnerable-secret, git-leak-recovery, and
openssl-selfsigned-cert tasks themselves and are left as-is.
