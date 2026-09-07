"""Harbor agent for the Mouse harness.

Subclasses Harbor's shipped OpenCode adapter: same install (pinned
``opencode-ai``), same trajectory parser (``opencode run --format=json`` lines
in ``opencode.txt``), plus Mouse's bundled headless harness, which owns the
engine config, the agent prompt, and the completion loop.

Run one task:

    harbor run -d terminal-bench@2.0 -i sanitize-git-repo \
      --agent evals.harbor.mouse_agent:MouseAgent \
      --model fireworks-ai/accounts/fireworks/models/kimi-k3 \
      --ak max_wall_sec=780

Build the bundle first: ``pnpm bundle``.
Written against Harbor 0.22; agent kwargs arrive through ``__init__``.
"""

from __future__ import annotations

import os
import shlex
import sys
from pathlib import Path
from typing import Any, override

from harbor.agents.installed.base import NonZeroAgentExitCodeError, with_prompt_template
from harbor.agents.installed.opencode import OpenCode
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_route import OPENCODE_VERSION, PROVIDER_KEYS, normalize_model  # noqa: E402
from mouse_logs import harness_fatal, mouse_summary  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
BUNDLE = REPO_ROOT / "packages" / "cli" / "dist" / "mouse.mjs"
REMOTE_DIR = "/mouse"
REMOTE_BUNDLE = f"{REMOTE_DIR}/mouse.mjs"
REMOTE_INSTRUCTION = f"{REMOTE_DIR}/instruction.md"
LOG_DIR = "/logs/agent"
HARNESS_LOG = f"{LOG_DIR}/mouse-harness.jsonl"

# Terminal-Bench tasks allow the agent 900 s; DeepSWE tasks 5400 s. The loop
# needs a reserve to finish its last probe, so the defaults sit under those.
TB_WALL_SEC = 780
DEEPSWE_WALL_SEC = 4800

PASSTHROUGH_ENV = (*PROVIDER_KEYS.values(), "MOUSE_TOOL_OUTPUT_PRUNE")

# --ak key=value options this agent understands, with defaults.
MOUSE_KWARGS: dict[str, int] = {
    "max_wall_sec": TB_WALL_SEC,
    "max_steps": 600,
    "non_progress_rounds": 3,
}


class MouseAgent(OpenCode):
    """OpenCode driven by Mouse's headless harness."""

    def __init__(self, *args: Any, **kwargs: Any):
        self._mouse: dict[str, int] = {}
        for key, default in MOUSE_KWARGS.items():
            raw = kwargs.pop(key, default)
            self._mouse[key] = int(raw)
        # FrontierHarness passes LiteLLM routes; OpenCode wants its own ids.
        if "model_name" in kwargs:
            kwargs["model_name"] = normalize_model(kwargs["model_name"])
        kwargs.setdefault("version", OPENCODE_VERSION)
        super().__init__(*args, **kwargs)
        self.model_name = normalize_model(self.model_name)

    @staticmethod
    @override
    def name() -> str:
        return "mouse"

    @override
    def get_version_command(self) -> str | None:
        # Leaderboard provenance comes from this; report Mouse's version, not the engine's.
        return "[ -f ~/.nvm/nvm.sh ] && . ~/.nvm/nvm.sh; node /mouse/mouse.mjs --version"

    def parse_version(self, stdout: str) -> str:
        # "mouse/0.1.0 opencode/1.18.27": the leaderboard records the whole line.
        lines = [l for l in stdout.strip().splitlines() if l.strip()]
        return lines[-1] if lines else "unknown"

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        await super().install(environment)
        if not BUNDLE.exists():
            raise FileNotFoundError(
                f"{BUNDLE} is missing; run `pnpm bundle` first"
            )
        await self.exec_as_root(
            environment,
            command=f"mkdir -p {REMOTE_DIR} {LOG_DIR} && chmod 777 {REMOTE_DIR} {LOG_DIR}",
        )
        await environment.upload_file(BUNDLE, REMOTE_BUNDLE)

    def _mouse_env(self) -> dict[str, str]:
        env = dict(self.model_connection.env)
        env["OPENCODE_FAKE_VCS"] = "git"
        env["XDG_DATA_HOME"] = f"{LOG_DIR}/opencode/xdg-data"
        env["XDG_STATE_HOME"] = f"{LOG_DIR}/opencode/xdg-state"
        env["MOUSE_HARNESS_PROFILE"] = "bench"
        env["MOUSE_HARNESS_LOG"] = HARNESS_LOG
        env.setdefault("OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS", "600000")
        for key in PASSTHROUGH_ENV:
            value = os.environ.get(key)
            if value:
                env[key] = value
        return env

    def _mouse_flags(self) -> str:
        return (
            f"--max-wall-sec {self._mouse['max_wall_sec']} "
            f"--max-steps {self._mouse['max_steps']} "
            f"--non-progress-rounds {self._mouse['non_progress_rounds']}"
        )

    @override
    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        self._instruction = instruction
        if not self.model_name or "/" not in self.model_name:
            raise ValueError("Model name must be in the format provider/model_name")

        env = self._mouse_env()

        # Harbor's own provider/model registration (custom base URL, MCP) goes
        # into the config home first; mouse-harness then writes opencode.json
        # with Mouse's engine config on top.
        config_command = self._build_register_config_command()
        if config_command:
            await self.exec_as_agent(environment, command=config_command, env=env)

        await self.exec_as_agent(
            environment,
            command=f"printf %s {shlex.quote(instruction)} > {REMOTE_INSTRUCTION}",
            env=env,
        )

        await self.exec_as_agent(
            environment,
            command=(
                "[ -f ~/.nvm/nvm.sh ] && . ~/.nvm/nvm.sh; "
                f"node {REMOTE_BUNDLE} run --instruction-file {REMOTE_INSTRUCTION} --profile bench --yolo --format json "
                f"--model {shlex.quote(self.model_name)} --workspace \"$(pwd)\" "
                f"--log {HARNESS_LOG} {self._mouse_flags()} "
                f"2>>{LOG_DIR}/mouse-harness.stderr </dev/null | stdbuf -oL tee {LOG_DIR}/opencode.txt"
            ),
            env=env,
        )

        # Raise only when the harness itself crashed. OpenCode error events
        # the completion loop recovered from are part of a finished trial,
        # and raising would make Harbor retry it and discard the work.
        if fatal := harness_fatal(self.logs_dir):
            messages = self._error_messages()
            detail = ("; " + "; ".join(messages[:3])) if messages else ""
            raise NonZeroAgentExitCodeError(f"mouse-harness failed: {fatal}{detail}")

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        super().populate_context_post_run(context)
        try:
            mouse = mouse_summary(self.logs_dir)
        except Exception:  # noqa: BLE001 - metadata is best-effort
            return
        if mouse:
            context.metadata = {**(context.metadata or {}), "mouse": mouse}
