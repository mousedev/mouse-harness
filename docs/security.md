# Security

The full statement, including the reporting address and what is out of scope, is [SECURITY.md](../SECURITY.md) at the repository root. This page is the short version.

- Mouse runs within the security boundary of the user who launched it. No sandbox.
- A run executes the repository's detected checks (`package.json` scripts, `pytest`, `go test`, `cargo test`, `make test`) and any commands declared in `.mouse/policy.json` `verify.checks`, as you.
- The model edits files and runs shell commands through OpenCode, in your workspace, with your environment.
- `--yolo` is unrestricted shell for the model; without a terminal `mouse run` implies it and warns once.
- Run untrusted repositories in a container or a throwaway VM.
- Prompt injection and malicious or mistaken model output are out of scope.
- Mouse makes no network calls of its own and has no telemetry, install ping, or update check.

Report privately to pete@mouse.dev, or open a GitHub security advisory on `mousedev/mouse-harness`.
