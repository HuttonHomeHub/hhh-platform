# hhh-platform

Shared code for the HuttonHomeHub apps ([PhotoMapper](https://github.com/HuttonHomeHub/PhotoMapper),
[Crane Charts](https://github.com/HuttonHomeHub/Crane_Chart_Manager)), so they look, behave and are
built the same way. It implements the
[HuttonHomeHub App Standard](https://claude.ai/artifact/1aL1Z9yughEYwwBEZx2sGf).

| Package       | What it holds                                                           |
| ------------- | ----------------------------------------------------------------------- |
| `@hhh/config` | TypeScript (`tsconfig.base.json`), ESLint, Prettier and Vitest settings |
| `@hhh/ui`     | Design tokens, base styles, React components, icons _(coming)_          |
| `@hhh/server` | Settings, health/version routes, logging, security, backups _(coming)_  |

## How apps use it

Apps **vendor** a tagged release: the packages are copied into the app's `vendor/hhh-platform/`
and referenced with `file:` dependencies. Nothing is fetched from a package registry.

```bash
# first time, from the app's repo root (later: run the vendored copy of this script)
node path/to/hhh-platform/scripts/vendor.ts 0.1.0
node vendor/hhh-platform/scripts/vendor.ts 0.2.0   # upgrade
node vendor/hhh-platform/scripts/vendor.ts --check # CI: the copy matches the release exactly
```

```json
"devDependencies": { "@hhh/config": "file:vendor/hhh-platform/packages/config" }
```

`vendor.ts` downloads `hhh-platform-X.Y.Z.tgz` from this repo's GitHub Release, checks its SHA-256
against the published `.sha256`, checks every file against the bundle's `manifest.json`, and only
then replaces the app's copy. `--check` fails if any vendored file was edited by hand: change the
platform and release it instead.

## Develop

Node 22 and npm. On CT 106 (no Node installed) run everything in a container, from the repo root:

```bash
docker run --rm --user 1000:1000 -e HOME=/tmp -e npm_config_cache=/tmp/.npm -v "$PWD":/app -w /app \
  node:22-bookworm sh -c 'npm ci && npm run check'
```

`npm run check` runs exactly what CI runs: typecheck, lint, format check, tests with an 80% line
coverage gate, the release bundle build, and `npm audit --audit-level=high`.

## Release

A release is merging `dev` into `main` (Ship It). `publish-release.yml` runs CI, checks that
`vX.Y.Z` (from `package.json`) doesn't exist yet, builds the bundle and publishes it as the GitHub
Release `vX.Y.Z` with its notes from `CHANGELOG.md`.
