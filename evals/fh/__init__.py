"""One import path for both FrontierHarness runners.

FrontierHarness's ``run-trials.sh`` passes the same ``--harness`` name to
Harbor (Terminal-Bench tasks) and Pier (DeepSWE tasks). The two run in
separate ``uv tool`` environments, so this module resolves to whichever runner
is importing it. Pier's environment also contains ``harbor`` (Pier is a Harbor
fork that depends on it), so Pier is tried first: in Harbor's environment the
``pier`` import fails and the Harbor adapter wins.
Use ``--harness evals.fh:MouseAgent`` (Harbor ``-a``, Pier ``--agent-import-path``).
"""

try:
    from evals.pier.mouse_agent import MouseAgent  # noqa: F401
except ImportError:
    from evals.harbor.mouse_agent import MouseAgent  # noqa: F401

__all__ = ["MouseAgent"]
