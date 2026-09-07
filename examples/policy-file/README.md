# Example: a `.mouse/policy.json`

The only file Mouse reads from a repository. Every block is optional and every field has a default; `mouse init` writes a skeleton. This example declares its checks explicitly instead of letting Mouse detect them, gives long tasks an hour, turns on tool-output pruning, and denies three shell patterns structurally (OpenCode enforces them; the model cannot talk its way past).

Run it:

```bash
cd examples/policy-file
mouse doctor          # shows the declared checks and the policy source
mouse run "..." --model provider/model
```

Field reference: [docs/config.md](../../docs/config.md).
