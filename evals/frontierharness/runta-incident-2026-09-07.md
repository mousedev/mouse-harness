# Runta checkpoint failure report (tenant of pete@mcgrathracing.com), 2026-09-07

**Summary.** From 11:47 UTC on 2026-09-07, checkpoint restore and checkpoint create stopped working for this tenant while runtimes, exec, secrets, and egress kept working. Nothing changed on our side between the last working restore (11:33 UTC) and the first failure. The error strings are not in Runta's docs, CLI help, or API reference, and CLI 0.2.0 and 0.2.1 behave the same.

**Identity.** owner_user_id `b5b761c1-c1ad-48bb-8d0c-c187e61babf0`. Checkpoints: `fh-golden-mouse-v1` (`01a07a56-c9f4-7fe2-8f94-5d7fd2cbb2fc`, created 05:28 UTC), `fh-golden-mouse-v2` (`01a07b9b-ddf7-79df-8562-f729ffa4a749`, created 11:23 UTC). Runtime used for a create attempt: `fh-work` (`01a07bbd-321e-7412-be62-19277a097714`), 4 vCPU, 8192 MiB, 100 GiB, secret configuration carrying FIREWORKS_API_KEY with one header rule for api.fireworks.ai.

**Timeline (UTC).**
- 05:28 v1 checkpoint created; 11:23 v2 created; both restored successfully several times (last good restore 11:33, runtime restored and ran a full trial).
- 11:47 first failed restore. Every restore since, from either checkpoint, returns:
  `FAILED_PRECONDITION: checkpoint access snapshot is missing; repair it before restoring, or supply explicit non-empty secret and repository configurations`
- 11:50 to 11:57 all API calls, including `checkpoint ls` and `secret list`, returned `not authorized`; those recovered by 11:57.
- Since 11:52 every `runta checkpoint create <runtime> <name>` returns `PERMISSION_DENIED: caller is not authorized` (hint: token authenticated but isn't authorized for this resource), including on a freshly created 1 vCPU runtime.
- 13:13 both checkpoints still list as `ready`; only `checkpoint ls --all` returns an empty list.

**What works.** `runta run`, `exec`, `cp`, `rm`, `shutdown`, `secret list/describe/rule set`, `egress set/describe`, `inspect`.

**Questions.** Was an "access snapshot" requirement deployed today, and can existing checkpoints be repaired or re-created? Why is checkpoint create now denied for this tenant? Both checkpoints still list as `ready`; are they intact?

**Context.** This is the FrontierHarness evaluation run on Runta credits; the benchmark's method requires one golden checkpoint and a fresh restore per task, so the run is blocked until checkpoints work again. A full trial ran end to end on a fresh restore at 11:33 (regex-log, passed), so the setup itself is fine.
