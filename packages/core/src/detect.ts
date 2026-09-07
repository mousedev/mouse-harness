/**
 * Which checks "done" means for a repo, detected from its manifests.
 *
 * package.json scripts, pytest, go test, cargo test, and make test. One shell
 * round trip prints every signal; parsing is pure so it can be tested without
 * a filesystem.
 */
import { shellPath, type Workspace } from "./workspace.js";

export type PackageManager = "pnpm" | "yarn" | "npm";

export interface DetectedCheck {
  name: string;
  command: string;
}

export interface EcosystemManifest {
  packageJson: string | null;
  packageManager: PackageManager;
  pyproject: boolean;
  pytestIni: boolean;
  setupCfg: boolean;
  toxIni: boolean;
  testsDir: boolean;
  uvLock: boolean;
  poetryLock: boolean;
  goMod: boolean;
  cargoToml: boolean;
  makefileTest: boolean;
}

export const EMPTY_MANIFEST: EcosystemManifest = {
  packageJson: null,
  packageManager: "npm",
  pyproject: false,
  pytestIni: false,
  setupCfg: false,
  toxIni: false,
  testsDir: false,
  uvLock: false,
  poetryLock: false,
  goMod: false,
  cargoToml: false,
  makefileTest: false,
};

/** Script-derived defaults, in the order they run. First present script wins per slot. */
const DEFAULT_SCRIPTS: ReadonlyArray<readonly [name: string, scripts: readonly string[]]> = [
  ["build", ["build", "typecheck"]],
  ["test", ["test"]],
  ["lint", ["lint"]],
];

const PYTEST_ARGS = "-q --maxfail=25 -p no:cacheprovider";

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function runCommand(pm: PackageManager, script: string): string {
  return pm === "npm" ? `npm run ${script} --if-present` : `${pm} run ${script}`;
}

/** Checks derived from `package.json` scripts, or `[]` when there are none. */
export function checksFromPackageJson(
  packageJson: string | null,
  pm: PackageManager = "npm",
): DetectedCheck[] {
  const scripts = parseJsonObject(packageJson)?.scripts;
  if (!scripts || typeof scripts !== "object") return [];
  const has = (s: string) => typeof (scripts as Record<string, unknown>)[s] === "string";
  const out: DetectedCheck[] = [];
  for (const [name, candidates] of DEFAULT_SCRIPTS) {
    const script = candidates.find(has);
    if (script) out.push({ name, command: runCommand(pm, script) });
  }
  return out;
}

export function pytestCommand(m: Pick<EcosystemManifest, "uvLock" | "poetryLock">): string {
  if (m.uvLock) return `uv run --frozen pytest ${PYTEST_ARGS}`;
  if (m.poetryLock) return `poetry run pytest ${PYTEST_ARGS}`;
  return `python3 -m pytest ${PYTEST_ARGS}`;
}

/**
 * Checks for every ecosystem the manifest shows. package.json scripts come
 * first because they are the repo's own declaration; the others are the
 * conventional runner for each toolchain. A monorepo with several gets all
 * of them.
 */
export function checksFromEcosystem(m: EcosystemManifest): DetectedCheck[] {
  const out: DetectedCheck[] = checksFromPackageJson(m.packageJson, m.packageManager);
  const python = m.pyproject || m.pytestIni || m.toxIni || (m.setupCfg && m.testsDir);
  if (python) out.push({ name: "pytest", command: pytestCommand(m) });
  if (m.goMod) out.push({ name: "go-test", command: "go test ./..." });
  if (m.cargoToml) out.push({ name: "cargo-test", command: "cargo test" });
  if (m.makefileTest && out.length === 0) out.push({ name: "make-test", command: "make test" });
  return out;
}

export async function detectPackageManager(ws: Workspace): Promise<PackageManager> {
  const r = shellPath(ws.root);
  const res = await ws
    .exec(
      `test -f ${r}/pnpm-lock.yaml && echo pnpm || (test -f ${r}/yarn.lock && echo yarn || echo npm)`,
      { cwd: ws.root, timeoutMs: 10_000 },
    )
    .catch(() => ({ stdout: "npm" }));
  const pm = res.stdout.trim();
  return pm === "pnpm" || pm === "yarn" ? pm : "npm";
}

const MANIFEST_FILES = [
  "pyproject.toml",
  "pytest.ini",
  "setup.cfg",
  "tox.ini",
  "uv.lock",
  "poetry.lock",
  "go.mod",
  "Cargo.toml",
] as const;

/** One shell round trip that prints every manifest signal for `root`. */
export function detectEcosystemCommand(root: string): string {
  return [
    `cd ${shellPath(root)} 2>/dev/null || exit 0`,
    `for f in ${MANIFEST_FILES.join(" ")}; do [ -e "$f" ] && echo "F:$f"; done`,
    '{ [ -d tests ] || [ -d test ]; } && echo "D:tests"',
    "grep -qE '^test:' Makefile 2>/dev/null && echo 'M:test'",
    '[ -f pnpm-lock.yaml ] && echo "PM:pnpm"',
    '[ -f yarn.lock ] && echo "PM:yarn"',
    '[ -f package.json ] && { echo "PKG_BEGIN"; cat package.json; echo; echo "PKG_END"; }',
    "true",
  ].join("; ");
}

/** The probe for the conventional `/workspace` root, as hosted sandboxes lay it out. */
export const DETECT_ECOSYSTEM_COMMAND = detectEcosystemCommand("/workspace");

export function parseEcosystemOutput(stdout: string): EcosystemManifest {
  const m: EcosystemManifest = { ...EMPTY_MANIFEST };
  const lines = stdout.split("\n");
  const pkgStart = lines.indexOf("PKG_BEGIN");
  const pkgEnd = lines.indexOf("PKG_END");
  if (pkgStart >= 0 && pkgEnd > pkgStart) {
    m.packageJson = lines.slice(pkgStart + 1, pkgEnd).join("\n");
  }
  for (const line of lines) {
    switch (line.trim()) {
      case "F:pyproject.toml":
        m.pyproject = true;
        break;
      case "F:pytest.ini":
        m.pytestIni = true;
        break;
      case "F:setup.cfg":
        m.setupCfg = true;
        break;
      case "F:tox.ini":
        m.toxIni = true;
        break;
      case "F:uv.lock":
        m.uvLock = true;
        break;
      case "F:poetry.lock":
        m.poetryLock = true;
        break;
      case "F:go.mod":
        m.goMod = true;
        break;
      case "F:Cargo.toml":
        m.cargoToml = true;
        break;
      case "D:tests":
        m.testsDir = true;
        break;
      case "M:test":
        m.makefileTest = true;
        break;
      case "PM:pnpm":
        m.packageManager = "pnpm";
        break;
      case "PM:yarn":
        if (m.packageManager === "npm") m.packageManager = "yarn";
        break;
      default:
        break;
    }
  }
  return m;
}

export async function detectEcosystem(ws: Workspace): Promise<EcosystemManifest> {
  const res = await ws
    .exec(detectEcosystemCommand(ws.root), { cwd: ws.root, timeoutMs: 10_000 })
    .catch(() => ({ stdout: "" }));
  return parseEcosystemOutput(res.stdout);
}
