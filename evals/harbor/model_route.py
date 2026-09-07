"""Model route helpers shared by the Harbor and Pier adapters.

FrontierHarness's scripts pass LiteLLM routes (``fireworks_ai/accounts/...``)
because Harbor, Pier, and mini-swe-agent expect them. Mouse hands the model
string to ``opencode run --model``, which wants OpenCode's own provider ids
(``fireworks-ai/accounts/...``). Normalising here means the FrontierHarness
default invocation works unchanged, so a reproduction by their team needs no
extra flags. Unknown prefixes pass through untouched.
"""

from __future__ import annotations

# OpenCode engine version installed in every task container. Pinning it keeps
# a reproduction on the same engine; ``--ak version=X`` still overrides.
OPENCODE_VERSION = "1.14.22"

LITELLM_TO_OPENCODE = {
    "fireworks_ai": "fireworks-ai",
    "together_ai": "togetherai",
    "moonshot": "moonshotai",
}

# Keyed by OpenCode provider id (post-normalisation).
PROVIDER_HOSTS = {
    "openrouter": ["openrouter.ai"],
    "fireworks-ai": ["api.fireworks.ai"],
    "moonshotai": ["api.moonshot.ai"],
    "togetherai": ["api.together.xyz"],
}
PROVIDER_KEYS = {
    "openrouter": "OPENROUTER_API_KEY",
    "fireworks-ai": "FIREWORKS_API_KEY",
    "moonshotai": "MOONSHOT_API_KEY",
    "togetherai": "TOGETHER_API_KEY",
}


def normalize_model(model: str | None) -> str | None:
    if not model or "/" not in model:
        return model
    provider, rest = model.split("/", 1)
    return f"{LITELLM_TO_OPENCODE.get(provider, provider)}/{rest}"


def provider_of(model: str | None) -> str:
    return (model or "").split("/", 1)[0]
