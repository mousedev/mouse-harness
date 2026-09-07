#!/bin/bash
# FrontierHarness `--install-script`. provision-golden-checkpoint.sh copies this
# file to /work/install-harness.sh and runs it with the harness checkout as cwd
# (/work/harness). It builds packages/cli/dist/mouse.mjs, prints its sha256 for
# the manifest, and makes `evals.fh:MouseAgent` importable by both runners.
#
#   provision-golden-checkpoint.sh ... --repo https://github.com/mousedev/mouse-harness \
#     --commit <sha> --harness evals.fh:MouseAgent --install-script ./install-mouse.sh
set -euo pipefail
if [ -f "$PWD/evals/fh/__init__.py" ]; then root=$PWD; else root=$(cd "$(dirname "$0")" && pwd); fi
cd "$root"
[ -f evals/fh/__init__.py ] || { echo "install-mouse: $root is not a mouse-harness checkout" >&2; exit 1; }

NODE_VERSION=22.17.1
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "install-mouse: installing Node $NODE_VERSION under ~/.local/node" >&2
  arch=$(uname -m); case "$arch" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; esac
  mkdir -p "$HOME/.local/node"
  # gzip, not xz: the Runta runtime image has no xz binary.
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$arch.tar.gz" \
    | tar -xz --strip-components=1 -C "$HOME/.local/node"
fi
command -v corepack >/dev/null && corepack enable --install-directory "$HOME/.local/bin" >/dev/null 2>&1 || true
if ! command -v pnpm >/dev/null; then npm i -g --ignore-scripts pnpm@9.15.9 >/dev/null; fi

bundle=packages/cli/dist/mouse.mjs
if [ ! -f "$bundle" ]; then
  pnpm install --frozen-lockfile --ignore-scripts
  pnpm bundle
fi
sha256sum "$bundle"
node "$bundle" --version || true

# Both runners live in uv tool environments; a .pth file puts this checkout on
# their import path so `--harness evals.fh:MouseAgent` resolves.
found=0
for site in "$HOME"/.local/share/uv/tools/{harbor,datacurve-pier}/lib/python*/site-packages; do
  [ -d "$site" ] || continue
  echo "$root" > "$site/mouse-harness.pth"
  echo "install-mouse: registered $root in $site"
  found=1
done
[ "$found" = 1 ] || { echo "install-mouse: no harbor/pier site-packages found under uv tools" >&2; exit 1; }

"$HOME/.local/share/uv/tools/harbor/bin/python" -c "from evals.fh import MouseAgent; print('harbor import ok:', MouseAgent.__module__)" \
  | grep -q 'evals.harbor' || { echo "install-mouse: harbor env did not resolve evals.fh to the Harbor adapter" >&2; exit 1; }
"$HOME/.local/share/uv/tools/datacurve-pier/bin/python" -c "from evals.fh import MouseAgent; print('pier import ok:', MouseAgent.__module__)" \
  | grep -q 'evals.pier' || { echo "install-mouse: pier env did not resolve evals.fh to the Pier adapter" >&2; exit 1; }
echo "install-mouse: ok"
