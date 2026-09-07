# Security

## Trust boundary

Mouse runs within the security boundary of the user who launched it. It has no sandbox of its own. Everything Mouse or the model does happens with your user account, your environment variables, your credentials on disk, and your network access.

A `mouse run` does the following on your machine:

- Starts the `opencode` binary as a child process in the workspace, with Mouse's configuration, and lets the model edit files and run shell commands there.
- Executes the repository's detected checks after each turn: `package.json` scripts (`build` or `typecheck`, `test`, `lint`), `pytest`, `go test ./...`, `cargo test`, and `make test`. Detection is described in [docs/config.md](docs/config.md). A repository can replace the detected checks with any commands it likes by declaring `verify.checks` in `.mouse/policy.json`, and Mouse runs those commands as written.
- Runs `git` and `find` in the workspace to fingerprint it and to scan for deleted test, spec, and workflow files.
- Writes a JSONL trace under `~/.mouse/runs/`. With `--profile bench` it also writes `opencode.json` into the OpenCode config home, and with `context.prune.enabled` it writes a plugin file there.

Consequences:

- Cloning a repository and running `mouse run` in it executes that repository's build and test commands, and its `.mouse/policy.json` checks, as you. Treat an untrusted repository the way you would treat running its test suite by hand: do it in a container or a throwaway VM.
- `--yolo` passes `--dangerously-skip-permissions` to OpenCode. This is unrestricted shell access for the model. When `mouse run` has no terminal attached (CI, cron, a pipe), it behaves as if `--yolo` was passed and prints a warning, because there is nobody to answer a permission prompt.
- Without `--yolo` and with a terminal, OpenCode enforces the permission block Mouse configures for the `build` agent. The `bash` deny patterns from `.mouse/policy.json` are part of that block. See [docs/policy.md](docs/policy.md) for exactly what reaches OpenCode.
- Model providers see your task text, your file contents as the model reads them, and command output. Mouse itself makes no network calls; OpenCode talks to the provider you selected.

## Out of scope

The following are not considered vulnerabilities in Mouse:

- Prompt injection: a repository, a file, a test output, or a web page instructing the model to do something harmful. Mouse is a harness that hands your instruction and your repository to a model. It does not, and cannot, distinguish malicious text from legitimate task input.
- Malicious or mistaken model output: a model deleting files, running a destructive command, or producing insecure code. The completion loop blocks a run when verification files are deleted; it does not police everything the model does.
- Anything that requires the attacker to already run code as your user.
- Vulnerabilities in OpenCode, in a model provider, or in the repository under test. Report those upstream.

## Reporting

Report security issues privately to security@mousedev.dev. This is the intended address for the project and needs to be confirmed as live before the first public release; until then, open a GitHub security advisory on `mousedev/mouse-harness` as the fallback.

Include the version (`mouse --version`), the operating system, the command you ran, and the smallest reproduction you have. Please do not open a public issue for something you believe is exploitable.

No telemetry, install ping, or update check exists in Mouse, so there is no data collection to report on.
