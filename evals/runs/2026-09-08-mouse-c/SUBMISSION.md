# Mouse 0.1.0 on FrontierHarness Eval: Runta run 2026-09-08-mouse-c

Submitted for reproduction and verification per "Evaluate your own harness" in
frontier-harness-eval/eval.

Contents of this directory:

| File | What it is |
| --- | --- |
| `report/REPORT.md`, `report/index.html`, `report/chart.svg` | Report built by FH's `build-report.mjs` / `generate-chart.mjs` (unmodified) |
| `candidate.json`, `run.json` | Scored candidate and run record from `normalize-results.mjs`; `methodology_notes` lists every deviation |
| `checkpoint-manifest.json` | The golden checkpoint's manifest (harness commit, topology, Harbor/Pier pins, DeepSWE ref, resources, runc workaround) |
| `trials/<task>/` | Per-task `trial.json`, `completion.json`, `manifest.json`, restore/transport/runner logs, and the Harbor/Pier job directory (agent trajectory, `opencode.txt` event stream, `mouse-harness.jsonl`, verifier output, `model.patch`); the SHA-256 of the runtime-side evidence archive is in `transport.log` |
| `attempts/<task>/<ts>-*/` | Every invalid attempt, retained (nothing deleted) |
| `logs/` | Driver and worker stdout, task split lists, finisher and watchdog scripts |
| `eval-repo-local-changes.patch` | The complete diff against frontier-harness-eval/eval e837a70 |
| `stub-verification.txt` | README step 4 check on a fresh restore of the checkpoint: the runtime only sees `runta-secret-stub` |
| `NOTES.md` | Incident log |
| `REDACTIONS.md` | The three redactions applied to this shared copy |

Redactions applied to the shared copy are listed in `REDACTIONS.md` (a Fireworks account slug in
412 error bodies, a local home path, and the omitted duplicate `evidence.tar.gz` archives). The
committed copy in mousedev/mouse-harness additionally omits job directories and redacts
token-shaped strings (several tasks plant fake credentials). The full run is
`fh-run-2026-09-08-mouse-c-full.tar.gz` (SHA-256 5e8117e2e7977c9b031bfac7ecfc9ef1a581fb8064388e1c55e2829f970d1708).

## Result

| Metric | Value |
| --- | --- |
| Pass rate | 83.3% (25 / 30), all 30 trials valid, 0 infra_invalid |
| Effective cost per pass | $2.79 (total $69.76 at the frozen kimi-k3-2026-08-20 table) |
| Median cost per task / per success | $0.27 / $0.18 |
| Median cache hit rate | 90.6% (25/25 successes measured) |
| Mean turns | 57.5 |
| Median time per successful task | 6m 24s |
| Termination anomalies | 4, see below; each is scored on its verifier verdict per the accounting rules |

By suite: datacurve 8/9, terminal-bench 17/21. Three tasks passed that no published baseline
configuration passed (scc-bounded-memory-spilling, kv-store-grpc, largest-eigenval); the report
flags these as observed results from an unranked run.

Termination anomalies (`completed_with_agent_exception`):

| Task | What happened | Scored as |
| --- | --- | --- |
| datacurve/python-statemachine-state-data-scoping | Mouse stopped on its own 4800 s wall budget (exit 3 = budget) after 216 steps; Pier treats non-zero exit as an agent exception; verifier passed | success |
| datacurve/meriyah-explicit-resource-declarations | Same budget stop, then Pier's 5400 s task timeout (exit 124); verifier failed | failure |
| terminal-bench/dna-insert | Mouse stopped on its 780 s wall budget (exit 3) after 23 steps; verifier failed | failure |
| terminal-bench/largest-eigenval | Harbor's 900 s agent timeout fired (Mouse's 780 s budget did not stop the final tool call in time); verifier passed | success | Comparability is `methodology_comparable: false`
per the current policy (new runs record their egress allowlist; a matched control is FH's call).

## Configuration

- Harness: Mouse 0.1.0, https://github.com/mousedev/mouse-harness at commit 315e2b8 (public, MIT).
  Topology `container-cli` (the default; recorded in the checkpoint manifest).
  Runs OpenCode 1.18.27 under Mouse's completion loop; bench profile; `--yolo --format json`.
  Harbor agent `mouse` (`evals/harbor/mouse_agent.py`), Pier agent `mouse`
  (`evals/pier/mouse_agent.py`), both registered by `install-mouse.sh` (the
  `--install-script`). Per-task limits: max-wall 780 s (Terminal-Bench) / 4800 s (DeepSWE),
  max-steps 600, non-progress-rounds 3, identical to the harness's self-reported 2026-09-03 run.
- Model: Kimi K3 via Fireworks (`fireworks_ai/accounts/fireworks/models/kimi-k3`), key injected
  by Runta's egress secret rule; the harness never sees it.
- Eval tooling: frontier-harness-eval/eval at e837a70 (post PR #11). Harbor 0.22.0, Pier 0.3.1.
- Golden checkpoint `fh-golden-mouse-v3`: built once with the upstream
  `provision-golden-checkpoint.sh` (4 vCPU, 8192 MiB, 50 GiB; warm-up on terminal-bench-sample
  only); every trial is a fresh restore of it at the same size. No formal task ran before the freeze.
- Trial driver: the upstream `run-trials.sh`, unmodified, with `--provider fireworks`
  `--checkpoint fh-golden-mouse-v3 --harness mouse --run-id 2026-09-08-mouse-c` and the retry
  knobs `FH_TRANSPORT_ATTEMPTS=48 FH_RETRY_DELAY=5` (Runta runtimes report "provisioning is not
  ready" for ~2 minutes after restore). Egress policy as recorded in `run.json`.

## Deviations from the pristine scripts (all disclosed, see eval-repo-local-changes.patch)

1. `providers.sh` allowlist: added `nodejs.org`, `*.nodejs.org`, `docker.io`, `*.docker.io`,
   `*.docker.com`, `deb.nodesource.com`. Harbor's OpenCode agent installs Node via nvm and the
   Pier agent image builds pull from Docker Hub; without these the first smoke trial was
   infra_invalid. The applied allowlist is recorded in `run.json`.
2. `usage_details.py`: one registry line, `"mouse": ("opencode.txt", _opencode)`. Mouse tees
   OpenCode's `--format json` stream to `agent/opencode.txt`, which the existing OpenCode parser
   reads (turn counts and first-call cache reads verified against trajectory.json for every task).
   reference.md says custom harnesses need this entry. Without it cost_first_cold_usd is null.
3. Concurrency: the first four tasks ran under one sequential driver; the rest under four
   concurrent copies of the same driver on disjoint `--tasks` lists (16 of the tenant's 32 vCPUs),
   as permitted by SKILL.md "Runtime quota and concurrency". Per-trial resources were unchanged.
4. Host-side watchdog (`logs/runta-watchdog.sh`, not part of the eval repo): the Runta CLI has no
   client-side timeout and three drivers sat 6.5-7.5 h inside a hung `runta exec`; the watchdog
   kills any `runta exec`/`runta cp` older than 15 min so the driver's own retry/retain paths
   take over. Trials left `recovery: true` were collected by re-running the same command.

## Incidents (details in NOTES.md)

- 2026-09-09 02:05Z Fireworks suspended the account (HTTP 412, monthly spending limit). Five trials
  that were mid-run were recorded by the driver as `failure` but their agent logs show the 412 on
  the final attempts; they were moved to `attempts/<slug>/<ts>-fireworks-412-suspended/` and
  re-run as fresh restores after billing was restored. Sixteen later trials were infra_invalid on
  the same cause and were retried by the driver.
- Five terminal-bench trials were infra_invalid in Harbor's apt install (intermittent 502 from
  archive.ubuntu.com through the egress proxy while four trials ran concurrently); retried.
- Every task's canonical attempt is the first valid one; `attempts/` retains all invalid attempts.

## Reproduce

```
git clone https://github.com/mousedev/mouse-harness && git -C mouse-harness checkout 315e2b8
# in frontier-harness-eval/eval at e837a70, with eval-repo-local-changes.patch applied:

env FH_TRANSPORT_ATTEMPTS=48 FH_RETRY_DELAY=5 bash skills/frontierharness-eval/scripts/run-trials.sh \
  --checkpoint fh-golden-mouse-v3 --harness mouse --provider fireworks --run-id <id> --out runs
node scripts/normalize-results.mjs --run runs/<id> --label Mouse && node scripts/generate-chart.mjs --run runs/<id> && node scripts/build-report.mjs --run runs/<id>
```

Contact: Pete McGrath, pete@mcgrathracing.com. Related: frontier-harness-eval/eval#12.
