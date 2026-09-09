# Releasing

The three packages share one version and ship together. `scripts/release.mjs` bumps them, syncs `MOUSE_VERSION`, and rolls the `[Unreleased]` section of the changelog; pushing the tag runs `.github/workflows/release.yml`, which builds the bundle, smoke-tests it on Linux, macOS, and Windows, publishes to npm, and creates the GitHub release with the bundle and its checksum attached.

```bash
node scripts/release.mjs 0.1.1          # edits package.json x3, version.ts, CHANGELOG.md
git commit -am "release: 0.1.1" && git tag v0.1.1 && git push && git push --tags
```

## The first publish of a package name

npm's trusted publishing (the OIDC path `release.yml` uses, no token in the repository) only works for a package that already exists. Publishing a brand-new name needs a person with an npm token, once:

```bash
npm login                                          # an account that can publish under @mousedev
pnpm install --frozen-lockfile --ignore-scripts
pnpm -r --filter './packages/*' run build          # dist for core and opencode
pnpm bundle                                        # dist/mouse.mjs for the CLI
pnpm -r --filter './packages/*' publish --access public
```

`pnpm publish`, not `npm publish` per directory: it rewrites the `workspace:*` ranges to real versions and applies each package's `publishConfig`. After that, on npmjs.com for each of the three packages: Settings, Publishing access, add a trusted publisher for this repository and `release.yml`. From then on the tag alone publishes.

The workflow's publish step skips a version that is already on npm, so pushing the tag after a manual publish still runs the smoke tests and creates the GitHub release.

## What a release must not change

Prompt bytes, the continue prompts, and the config profiles are pinned by the golden test. A release that changes them is a new benchmark, and the README's benchmark section names the commit it was measured at.
