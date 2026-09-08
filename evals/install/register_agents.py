#!/usr/bin/env python3
"""Register `mouse` as a named agent in Harbor's and Pier's agent registries.

FrontierHarness's trial driver passes one `--harness` value to both runners:
Harbor takes `-a <name>` and Pier takes `--agent <name>`, and Pier's `--agent`
only accepts names from its AgentName enum. Their reference says to register a
custom agent in both registries from the install script; this is that step.
Idempotent; edits the installed packages in the uv tool environments.
"""
import glob, pathlib, sys

IMPORT_HARBOR = "evals.harbor.mouse_agent:MouseAgent"


def patch(path: str, edits: list[tuple[str, str]], marker: str) -> str:
    p = pathlib.Path(path); s = p.read_text()
    if marker in s:
        return f"already registered: {path}"
    for anchor, insert in edits:
        if anchor not in s:
            sys.exit(f"anchor not found in {path}: {anchor!r}")
        s = s.replace(anchor, insert, 1)
    p.write_text(s)
    return f"registered mouse in {path}"


def site(tool: str, rel: str) -> str:
    hits = glob.glob(f"{pathlib.Path.home()}/.local/share/uv/tools/{tool}/lib/python*/site-packages/{rel}")
    if not hits:
        sys.exit(f"{tool}: {rel} not found")
    return hits[0]


# Harbor: enum member plus an import-path entry in the factory map.
print(patch(site("harbor", "harbor/models/agent/name.py"),
            [('    OPENCODE = "opencode"\n', '    OPENCODE = "opencode"\n    MOUSE = "mouse"\n')], 'MOUSE = "mouse"'))
print(patch(site("harbor", "harbor/agents/factory.py"),
            [('        AgentName.OPENCODE: "harbor.agents.installed.opencode:OpenCode",\n',
              '        AgentName.OPENCODE: "harbor.agents.installed.opencode:OpenCode",\n'
              f'        AgentName.MOUSE: "{IMPORT_HARBOR}",\n')], "AgentName.MOUSE"))

# Pier: enum member plus the class in the _AGENTS list (imported lazily inside the
# module so a missing checkout fails at use, not at every pier invocation).
print(patch(site("datacurve-pier", "pier/models/agent/name.py"),
            [('    OPENCODE = "opencode"\n', '    OPENCODE = "opencode"\n    MOUSE = "mouse"\n')], 'MOUSE = "mouse"'))
print(patch(site("datacurve-pier", "pier/agents/factory.py"),
            [('from pier.agents.installed.opencode import OpenCode\n',
              'from pier.agents.installed.opencode import OpenCode\nfrom evals.pier.mouse_agent import MouseAgent as MouseHarnessAgent  # registered by mouse-harness\n'),
             ('        OpenCode,\n    ]\n', '        OpenCode,\n        MouseHarnessAgent,\n    ]\n')], "MouseHarnessAgent"))
