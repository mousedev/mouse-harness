#!/usr/bin/env python3
"""Build-time trust for Pier images behind the Runta egress proxy.

Mouse FrontierHarness run, 2026-09-07. Pier generates both Dockerfiles in code
(the task image is FROM the prebuilt image plus Pier's agent install steps; the
egress proxy is written by write_docker_proxy_compose). Their RUN steps fetch
over https through Runta's intercepting proxy, which the runtime-only compose
overlay cannot reach. This patches Pier's generators to emit the proxy CA and an
apt config (retries, no HTTP pipelining) right after FROM, both embedded as
base64 so no build-context files are needed. Idempotent.
"""
import base64, glob, pathlib, sys

CA_PATH = "/usr/local/share/ca-certificates/runta-egress.crt"
APT_CONF = b'Acquire::Retries "10";\nAcquire::http::Pipeline-Depth "0";\nAcquire::http::Timeout "60";\n'

ca_b64 = base64.b64encode(pathlib.Path(CA_PATH).read_bytes()).decode()
apt_b64 = base64.b64encode(APT_CONF).decode()
files = glob.glob("/root/.local/share/uv/tools/datacurve-pier/lib/python*/site-packages/pier/environments/agent_setup.py")
if not files:
    sys.exit("pier agent_setup.py not found")
p = pathlib.Path(files[0]); s = p.read_text()
if "runta_trust_lines" in s:
    print("pier agent_setup.py already patched"); sys.exit(0)

helper = f'''


# Added by the FrontierHarness trial driver (Mouse run, 2026-09-07): build-time
# trust for the Runta egress proxy, plus apt retries, in every generated image.
_RUNTA_CA_B64 = "{ca_b64}"
_RUNTA_APT_B64 = "{apt_b64}"


def runta_trust_lines() -> list[str]:
    ca = "{CA_PATH}"
    return [
        "USER root",
        "RUN mkdir -p /usr/local/share/ca-certificates /etc/apt/apt.conf.d"
        " && echo " + _RUNTA_CA_B64 + " | base64 -d > " + ca
        + " && echo " + _RUNTA_APT_B64 + " | base64 -d > /etc/apt/apt.conf.d/80-retries"
        + " && ((command -v update-ca-certificates >/dev/null 2>&1 && update-ca-certificates >/dev/null 2>&1)"
        + " || ([ -f /etc/ssl/certs/ca-certificates.crt ] && cat " + ca + " >> /etc/ssl/certs/ca-certificates.crt) || true)",
        "ENV NODE_EXTRA_CA_CERTS=" + ca + " SSL_CERT_FILE=" + ca + " CURL_CA_BUNDLE=" + ca
        + " REQUESTS_CA_BUNDLE=" + ca + " GIT_SSL_CAINFO=" + ca + " PIP_CERT=" + ca + " UV_NATIVE_TLS=1",
    ]
'''
a1 = "    fingerprint = install.fingerprint()\n"
a2 = '                "FROM ubuntu:24.04",\n'
if a1 not in s or a2 not in s:
    sys.exit("pier agent_setup.py anchors not found")
s = s.replace(a1, "    dockerfile.extend(runta_trust_lines())\n" + a1, 1)
s = s.replace(a2, a2 + "                *runta_trust_lines(),\n", 1)
p.write_text(s + helper)
print("pier agent_setup.py patched for build-time trust")
