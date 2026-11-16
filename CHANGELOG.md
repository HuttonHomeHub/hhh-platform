# Changelog

All notable changes to hhh-platform. Versions are the GitHub Releases the apps vendor
(`hhh-platform-<version>.tgz`). The version lives in the root `package.json`.

Every PR into `dev` adds its line under `## Unreleased`, in `### Added`, `### Changed` or
`### Fixed`. At release, the Ship It skill turns that section into `## vX.Y.Z — <summary>`:
a minor bump if anything is under Added, otherwise a patch bump. The publish workflow uses
that section as the GitHub Release notes.

## Unreleased

### Added
- **Repository foundation:** npm workspaces, TypeScript 6 (strict), ESLint 9, Prettier, Vitest 5
  with an 80% line-coverage gate, and one `npm run check` that runs what CI runs.
- **`@hhh/config`:** the shared `tsconfig.base.json`, ESLint config (`hhhConfig()`), Prettier
  settings and Vitest preset (`hhhVitest()`).
- **Releases as vendorable bundles:** `scripts/pack-release.ts` builds a reproducible
  `hhh-platform-X.Y.Z.tgz` with a per-file SHA-256 manifest; `scripts/vendor.ts` (shipped in the
  bundle) installs a release into an app after checking its checksum and manifest, and `--check`
  catches hand edits to the vendored copy.
- **CI and releases:** `ci.yml` (the required `build` check), `publish-release.yml` (merge into
  `main` publishes the GitHub Release), Dependabot into `dev`.
