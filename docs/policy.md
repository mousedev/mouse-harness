# Permissions policy

The `permissions` block of `.mouse/policy.json`. Source: `parsePermissions` and `permissionRulesForTool` in `packages/core/src/policy.ts`; `bashPermission` and `MODE_PERMISSIONS` in `packages/opencode/src/config.ts`.

## The block

```json
{
  "permissions": {
    "bash": { "git push*": "deny", "rm -rf *": "deny", "curl *": "deny" },
    "write": "allow",
    "edit": { "*": "allow", "migrations/*": "ask" },
    "doom_loop": "allow"
  }
}
```

- `bash`, `write`, `edit`: either one action for every call (`allow`, `ask`, `deny`) or an object mapping a glob pattern to an action.
- `doom_loop`: one action.
- Anything else in the block, and any entry with an unknown action, is dropped.

## First match wins in Mouse

`permissionRulesForTool` turns a tool entry into an ordered list of `[pattern, action]` pairs. A single action becomes `[["*", action]]`. An object keeps its declaration order, which is what JSON gives you when you hand-edit the file. A host that answers permission requests walks the list from the top and stops at the first pattern that matches. Put specific patterns before general ones:

```json
"bash": { "git push origin/feature-*": "allow", "git push*": "deny", "*": "allow" }
```

## What reaches OpenCode, and why only denies

OpenCode's own `permission` config also takes pattern maps, but OpenCode resolves them last-match-wins. Feeding the same map through both readers would silently invert precedence whenever patterns overlap. So `buildOpencodeConfig` crosses over only the `bash` patterns whose action is `deny`, and places `"*"` first so it is the weakest rule under either reading:

```json
"bash": { "*": "allow", "git push*": "deny", "rm -rf *": "deny" }
```

A deny is safe under both first-match and last-match semantics, and it is enforced by OpenCode itself, structurally: the model cannot talk its way past it. `allow` and `ask` patterns, `write`, `edit`, and `doom_loop` from your policy are not sent to OpenCode in this release. They are parsed and kept for hosts that run their own permission loop, and for the interactive mode on the roadmap.

## The agent postures

Mouse configures every mode as an OpenCode agent with its own permission block; agent-level permissions override global ones. `mouse run` uses `build`.

| Mode | edit | bash |
|---|---|---|
| `ask` | deny | deny |
| `plan` | deny (only `.mouse/plans/*.md` allowed) | ask |
| `debug` | ask | allow |
| `build` | allow | allow (plus your deny patterns) |

Every agent also has `webfetch: deny` and `doom_loop: allow` (hosts run their own doom-loop detector), and the `webfetch`, `websearch`, `task`, and `skill` built-in tools are turned off. For the `build` agent nothing is `ask`, so with or without a terminal there is nothing for OpenCode to prompt for; the deny patterns are the only structural restriction.

## `--yolo` and the terminal

- `--yolo` passes `--dangerously-skip-permissions` to OpenCode. Treat it as unrestricted shell for the model. Whether OpenCode still honours the deny patterns under that flag is OpenCode's behaviour, not Mouse's; do not rely on it.
- Without a terminal on stdout, `mouse run` implies `--yolo` and prints one warning to stderr.
- With a terminal and without `--yolo`, OpenCode runs with the `build` agent's permission block as configured above.

## Not in this release

Interactive permission prompts routed to you, an `--auto` mode that answers prompts from this block with first-match-wins, a hard deny list in core, and the `mouse.permission` trace record are on the roadmap and are not shipped.
