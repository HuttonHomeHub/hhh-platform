# CLAUDE.md

The rules in `~/projects/CLAUDE.md` apply here too. If the two ever disagree, the stricter one wins. This file holds only hhh-platform's own facts.

## What this repo is

Shared code for PhotoMapper and Crane Charts, implementing the HuttonHomeHub App Standard (link in README). Packages live in `packages/` (npm workspaces): `@hhh/config`, `@hhh/ui`; `@hhh/server` follows. It is not deployed and has no image: a release is a bundle on GitHub Releases that the apps vendor.

## CT 106

- **Checks:** `npm run check`, in the Node container (command in README). It writes only the gitignored `node_modules/`, `coverage/` and `dist-release/`.
- No dev stack or port: nothing runs as a service.
- **Screenshots:** after any visual change to `@hhh/ui`, rebuild the showcase and recapture (commands in README), look at every PNG in both themes and on the phone width, and commit them. The user has agreed to Playwright running in its pinned image for this.
- `packages/ui` has its own `tsconfig.json` (DOM, JSX); the root one covers Node code and excludes it. Browser code in Node scripts goes in strings (`page.evaluate('...')`).

## Rules specific to this repo

- Apps vendor releases with `scripts/vendor.ts` (it ships inside each bundle). Never edit an app's `vendor/hhh-platform/` by hand; change the platform, release it, and bump the app's pin in its own PR.
- `scripts/pack-release.ts` builds the bundle from each package's `package.json` `files`. A new file a package must ship goes in its `files` list, or apps won't get it.
- The bundle is reproducible (same input, same bytes); keep it that way: no timestamps or machine paths in packed files.
- All packages share the platform's version (root `package.json`); the bundle rewrites each package's version to it.
- `packages/config/package.json` lists the tools an app must install under `requiredTools`, not `peerDependencies` (npm 10 crashes resolving peers inside a workspace).
- Tool pins, and why each is held back, are in `docs/decisions.md` and `.github/dependabot.yml`.

## Release

- Version: `version` in the root `package.json`. `CHANGELOG.md` has an `## Unreleased` section; every PR into `dev` adds its line.
- A release is merging `dev` into `main`. `publish-release.yml` runs CI, fails if `vX.Y.Z` exists, and publishes the GitHub Release `vX.Y.Z` with `hhh-platform-X.Y.Z.tgz` and its `.sha256`.
- "Ship It" follows `.claude/skills/ship-it/SKILL.md`.
- `ci.yml`'s one job, `build`, is the required check.
