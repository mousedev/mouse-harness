"""Pier agent for the Mouse harness.

FrontierHarness runs DeepSWE tasks through Pier (datacurve-pier), a Harbor
fork that lets an installed agent reach its model provider inside an
``allow_internet = false`` task. This mirrors ``evals/harbor/mouse_agent.py``
on Pier's base classes: same install, same trajectory parser, plus Mouse's
bundled harness driving ``opencode run``.

Written against datacurve-pier 0.3.1 from its source; verify on the runtime
with ``pier run --help`` before a full sweep.
"""

from __future__ import annotations

import os
import shlex
import sys
from pathlib import Path
from typing import Any

from pier.agents.installed.base import NonZeroAgentExitCodeError, with_prompt_template
from pier.agents.installed.opencode import OpenCode
from pier.environments.base import BaseEnvironment
from pier.models.agent.context import AgentContext
from pier.models.agent.network import NetworkAllowlist

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "harbor"))
from model_route import OPENCODE_VERSION, PROVIDER_HOSTS, PROVIDER_KEYS, normalize_model, provider_of  # noqa: E402
from mouse_logs import harness_fatal, mouse_summary  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
BUNDLE = REPO_ROOT / "packages" / "cli" / "dist" / "mouse.mjs"
REMOTE_DIR = "/mouse"
REMOTE_BUNDLE = f"{REMOTE_DIR}/mouse.mjs"
REMOTE_INSTRUCTION = f"{REMOTE_DIR}/instruction.md"
LOG_DIR = "/logs/agent"
HARNESS_LOG = f"{LOG_DIR}/mouse-harness.jsonl"

PASSTHROUGH_ENV = ("MOUSE_TOOL_OUTPUT_PRUNE",)

# DeepSWE tasks allow the agent 5400 s; the loop keeps a reserve.
MOUSE_KWARGS: dict[str, int] = {"max_wall_sec": 4800, "max_steps": 600, "non_progress_rounds": 3}


class MouseAgent(OpenCode):
    """OpenCode driven by Mouse's headless harness, for Pier."""

    def __init__(self, *args: Any, **kwargs: Any):
        self._mouse: dict[str, int] = {}
        for key, default in MOUSE_KWARGS.items():
            self._mouse[key] = int(kwargs.pop(key, default))
        if "model_name" in kwargs:
            kwargs["model_name"] = normalize_model(kwargs["model_name"])
        kwargs.setdefault("version", OPENCODE_VERSION)
        super().__init__(*args, **kwargs)
        self.model_name = normalize_model(self.model_name)

    @staticmethod
    def name() -> str:
        return "mouse"

    def get_version_command(self) -> str | None:
        return "[ -f ~/.nvm/nvm.sh ] && . ~/.nvm/nvm.sh; node /mouse/mouse.mjs --version"

    def parse_version(self, stdout: str) -> str:
        # "mouse/0.1.0 opencode/1.14.22": the leaderboard records the whole line.
        lines = [l for l in stdout.strip().splitlines() if l.strip()]
        return lines[-1] if lines else "unknown"

    async def install(self, environment: BaseEnvironment) -> None:
        await super().install(environment)
        if not BUNDLE.exists():
            raise FileNotFoundError(f"{BUNDLE} is missing; run `pnpm bundle`")
        await self.exec_as_root(
            environment,
            command=f"mkdir -p {REMOTE_DIR} {LOG_DIR} && chmod 777 {REMOTE_DIR} {LOG_DIR}",
        )
        await environment.upload_file(BUNDLE, REMOTE_BUNDLE)

    def network_allowlist(self) -> NetworkAllowlist:
        base = super().network_allowlist()
        extra = PROVIDER_HOSTS.get(provider_of(self.model_name), [])
        if not extra:
            return base
        domains = list(dict.fromkeys([*getattr(base, "domains", []), *extra]))
        try:
            return base.model_copy(update={"domains": domains})
        except Exception:  # noqa: BLE001 - older NetworkAllowlist shapes
            return NetworkAllowlist(domains=domains)

    def _mouse_env(self) -> dict[str, str]:
        env = self.build_process_env()
        key = PROVIDER_KEYS.get(provider_of(self.model_name))
        if key and (value := self._get_env(key)):
            env[key] = value
        env["OPENCODE_FAKE_VCS"] = "git"
        env["MOUSE_HARNESS_PROFILE"] = "bench"
        env["MOUSE_HARNESS_LOG"] = HARNESS_LOG
        env.setdefault("OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS", "600000")
        for k in PASSTHROUGH_ENV:
            if v := os.environ.get(k):
                env[k] = v
        return env

    def _mouse_flags(self) -> str:
        return (
            f"--max-wall-sec {self._mouse['max_wall_sec']} --max-steps {self._mouse['max_steps']} "
            f"--non-progress-rounds {self._mouse['non_progress_rounds']}"
        )

    @with_prompt_template
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        if not self.model_name or "/" not in self.model_name:
            raise ValueError("Model name must be in the format provider/model_name")
        env = self._mouse_env()

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
                ". ~/.nvm/nvm.sh; "
                f"node {REMOTE_BUNDLE} run --instruction-file {REMOTE_INSTRUCTION} --profile bench --yolo --format json "
                f"--model {shlex.quote(self.model_name)} --workspace \"$(pwd)\" "
                f"--log {HARNESS_LOG} {self._mouse_flags()} "
                f"2>>{LOG_DIR}/mouse-harness.stderr </dev/null | stdbuf -oL tee {LOG_DIR}/opencode.txt"
            ),
            env=env,
        )
        if fatal := harness_fatal(self.logs_dir):
            messages = self._error_messages()
            detail = ("; " + "; ".join(messages[:3])) if messages else ""
            raise NonZeroAgentExitCodeError(f"mouse-harness failed: {fatal}{detail}")

    def populate_context_post_run(self, context: AgentContext) -> None:
        super().populate_context_post_run(context)
        try:
            mouse = mouse_summary(self.logs_dir)
        except Exception:  # noqa: BLE001
            return
        if mouse:
            context.metadata = {**(context.metadata or {}), "mouse": mouse}
