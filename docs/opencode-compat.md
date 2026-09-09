# OpenCode compatibility

Mouse is not a fork of OpenCode. It drives the `opencode` binary as a child process and depends on `@opencode-ai/sdk` (pinned to 1.14.22) for the config types. That means OpenCode releases can change things Mouse relies on: the `permission` config shape, the `compaction` keys, the `--dangerously-skip-permissions` flag, and the event shapes `opencode run --format=json` prints. The compat manifest records which versions Mouse has been run against.

## The manifest

`packages/opencode/src/compat/opencode-compat.json`, loaded by `loadCompatManifest()`:

```json
{
  "$comment": "OpenCode versions the Mouse harness has been run against. `supported` versions are exercised in CI (mouse doctor + mouse config --profile bench); `tested` carries what was verified on that version. Anything else prints a warning from `mouse doctor` and fails `--strict-compat`.",
  "supported": [
    "1.18.27",
    "1.14.22"
  ],
  "tested": {
    "1.18.27": {
      "benchmark": "FrontierHarness Eval, Kimi K3 via Fireworks, under the benchmark's unmodified run-trials.sh on golden checkpoint fh-golden-mouse-v3",
      "result": "25/30 (datacurve 8/9, terminal-bench 17/21), run 2026-09-08-mouse-c, harness commit 315e2b8, all 30 trials valid; an earlier self-run through Harbor on 2026-09-03 scored 24/30",
      "notes": "The version both runs used: the adapter installed opencode-ai@latest, which was 1.18.27 on 2026-09-03, and the adapters have pinned it since."
    },
    "1.14.22": {
      "benchmark": "none",
      "result": "CI compat job only: mouse doctor --strict-compat and a bench config write succeed",
      "notes": "The version the hosted product's SDK pins. No benchmark run on it."
    }
  },
  "notes": {
    "1.18.19": "FrontierHarness pinned 1.18.19 for its stock OpenCode control. Not run; 1.18.27 is the same minor line."
  }
}
```

- `supported`: versions the harness has been run against end to end and that the compat check is meant to exercise (`mouse doctor` and `mouse config --profile bench` against a downloaded binary). Every supported version must have a `tested` entry; a unit test enforces that.
- `tested`: the benchmark result recorded on that version, so a number is always tied to an engine version.
- `notes`: what is known about other versions. 1.18.19 is the version FrontierHarness pinned for its stock OpenCode control; it has not been run with Mouse yet, and the items listed there need checking before it is added.

## `mouse doctor`

`doctor` locates the binary (`--opencode-bin`, `MOUSE_OPENCODE_BIN`, `PATH`, then `node_modules/.bin/opencode` above the workspace), runs `opencode --version`, and classifies the result with `checkCompat`:

| Verdict | Printed as | Meaning |
|---|---|---|
| `supported` | `compat 1.18.27: supported` | The version is in `supported`. |
| `untested` | `compat 1.18.19: untested (supported: 1.18.27, 1.14.22)` | A version was found but is not in the manifest. Mouse will run; nothing is promised. |
| `unknown` | `compat unknown` | The binary was not found or did not print a version. `doctor` exits 1. |

`--strict-compat` makes an `untested` verdict exit 1 as well. Use it in CI and in benchmark provisioning so a silent engine upgrade fails loudly.

`mouse --version` prints `mouse/<version> opencode/<version>`; the benchmark adapters record that whole line as the harness version.

## Adding a version

1. Run `mouse doctor --strict-compat` and `mouse config --profile bench` against the new binary.
2. Run at least the smoke tasks (`evals/frontierharness/smoke-tasks.txt`) and check that `opencode.txt` still parses and the trace ends in `mouse.done`.
3. Add the version to `supported` and a `tested` entry with the result. Say what was run; do not copy a result from another version.

Version parsing (`parseOpencodeVersion`) accepts a bare semver or a prefixed line such as `opencode 1.18.29`, including prerelease suffixes.
