#!/usr/bin/env node
// Cut a release: bump the three packages in lockstep, sync MOUSE_VERSION, and
// move CHANGELOG.md's [Unreleased] section under the new version. Plain Node,
// no dependencies. Writes nothing on a dirty tree.
//
//   node scripts/release.mjs 0.2.0            apply
//   node scripts/release.mjs 0.2.0 --dry-run  show the edits, write nothing
//   node scripts/release.mjs --help
//
// The script does not commit, tag, or push; it prints those commands at the end
// so the release stays a deliberate, reviewable step.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["core", "opencode", "cli"].map((p) => `packages/${p}/package.json`);
const VERSION_TS = "packages/opencode/src/version.ts";
const CHANGELOG = "CHANGELOG.md";
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const USAGE = `usage: node scripts/release.mjs <version> [--dry-run]

  <version>   the new version, e.g. 0.2.0 or 0.2.0-rc.1 (no leading v)
  --dry-run   print what would change without writing or checking git

Bumps ${PACKAGES.join(", ")} in lockstep, updates MOUSE_VERSION in
${VERSION_TS}, and moves the [Unreleased] section of ${CHANGELOG} into a
new [<version>] - <date> section. Refuses to run on a dirty working tree.
`;

function fail(message) {
  process.stderr.write(`release: ${message}\n`);
  process.exit(1);
}

function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function parseArgs(argv) {
  let version;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("-")) fail(`unknown flag ${arg}\n\n${USAGE}`);
    else if (version) fail(`unexpected argument ${arg}\n\n${USAGE}`);
    else version = arg;
  }
  if (!version) fail(`a version is required\n\n${USAGE}`);
  if (version.startsWith("v"))
    fail(`pass ${version.slice(1)}, not ${version} (the tag gets the v)`);
  if (!SEMVER.test(version)) fail(`${version} is not a semver version`);
  return { version, dryRun };
}

function compareSemver(a, b) {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  // Same core: a prerelease sorts before the release.
  return (a.includes("-") ? 0 : 1) - (b.includes("-") ? 0 : 1);
}

function assertCleanTree() {
  let out;
  try {
    out = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  } catch (err) {
    fail(`git status failed: ${err.message}`);
  }
  if (out.trim()) fail(`working tree is dirty; commit or stash first:\n${out}`);
}

/** Bump `version` in a package.json without reformatting the rest of the file. */
function bumpPackageJson(rel, version) {
  const src = read(rel);
  const match = src.match(/"version":\s*"([^"]+)"/);
  if (!match) fail(`${rel}: could not find a "version" field`);
  return {
    rel,
    current: match[1],
    next: src.replace(match[0], match[0].replace(match[1], version)),
  };
}

function bumpVersionTs(version) {
  const src = read(VERSION_TS);
  const match = src.match(/export const MOUSE_VERSION = "([^"]+)";/);
  if (!match) fail(`${VERSION_TS}: could not find MOUSE_VERSION`);
  return {
    rel: VERSION_TS,
    current: match[1],
    next: src.replace(match[0], `export const MOUSE_VERSION = "${version}";`),
  };
}

/**
 * Keep-a-Changelog: move everything under `## [Unreleased]` into a new
 * `## [version] - date` section, leave Unreleased empty, and update the link
 * references at the bottom when the file has them.
 */
function rollChangelog(version, previous, date) {
  let src;
  try {
    src = read(CHANGELOG);
  } catch {
    fail(`${CHANGELOG} not found at the repo root`);
  }
  const lines = src.split("\n");
  const start = lines.findIndex((l) => /^## \[Unreleased\]/i.test(l));
  if (start < 0) fail(`${CHANGELOG}: no "## [Unreleased]" section`);
  if (lines.some((l) => l.startsWith(`## [${version}]`)))
    fail(`${CHANGELOG}: a [${version}] section already exists`);
  let end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  if (end < 0) end = lines.findIndex((l, i) => i > start && /^\[[^\]]+\]:\s*https?:/.test(l));
  if (end < 0) end = lines.length;

  const body = lines.slice(start + 1, end);
  // Trim blank edges of the Unreleased body; refuse to cut an empty release.
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  if (!body.length) fail(`${CHANGELOG}: the [Unreleased] section is empty; nothing to release`);

  const rolled = [
    ...lines.slice(0, start),
    lines[start],
    "",
    `## [${version}] - ${date}`,
    "",
    ...body,
    "",
    ...lines.slice(end),
  ];

  // Link references, if present: [Unreleased]: .../compare/vOLD...HEAD
  let out = rolled.join("\n");
  const linkRe = /^\[Unreleased\]:\s*(\S+?)\/compare\/v?([^.\s]+(?:\.[^.\s]+)*)\.\.\.HEAD\s*$/im;
  const link = out.match(linkRe);
  if (link) {
    const base = link[1];
    const from = link[2];
    out = out.replace(
      linkRe,
      `[Unreleased]: ${base}/compare/v${version}...HEAD\n[${version}]: ${base}/compare/v${from}...v${version}`,
    );
  }
  return {
    rel: CHANGELOG,
    current: previous,
    next: out,
    moved: body.length,
    section: [`## [${version}] - ${date}`, "", ...body].join("\n"),
  };
}

function main() {
  const { version, dryRun } = parseArgs(process.argv.slice(2));
  if (!dryRun) assertCleanTree();

  const edits = PACKAGES.map((p) => bumpPackageJson(p, version));
  const currents = new Set(edits.map((e) => e.current));
  if (currents.size !== 1)
    fail(`packages disagree on the current version: ${[...currents].join(", ")}`);
  const previous = edits[0].current;
  if (compareSemver(version, previous) <= 0)
    fail(`${version} is not newer than the current ${previous}`);

  const ts = bumpVersionTs(version);
  if (ts.current !== previous)
    fail(`${VERSION_TS} says ${ts.current} but the packages say ${previous}`);
  edits.push(ts);

  const date = new Date().toISOString().slice(0, 10);
  const changelog = rollChangelog(version, previous, date);
  edits.push(changelog);

  const log = (line) => process.stdout.write(`${line}\n`);
  log(`release: ${previous} -> ${version}${dryRun ? " (dry run, nothing written)" : ""}`);
  for (const edit of edits) {
    if (!dryRun) writeFileSync(path.join(ROOT, edit.rel), edit.next);
    log(`  ${edit.rel}${edit.moved ? ` (moved ${edit.moved} Unreleased lines)` : ""}`);
  }
  if (dryRun) {
    log("");
    log(`new ${CHANGELOG} section:`);
    log(changelog.section.replace(/^/gm, "  "));
  }
  log("");
  log("next:");
  log(`  git diff`);
  log(
    `  git commit -am "release: ${version}" && git tag v${version} && git push && git push --tags`,
  );
  log("");
  log(
    "pushing the tag runs .github/workflows/release.yml, which publishes to npm and creates the GitHub release.",
  );
}

main();
