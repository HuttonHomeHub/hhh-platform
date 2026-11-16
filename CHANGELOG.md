# Changelog

All notable changes to hhh-platform. Versions are the GitHub Releases the apps vendor
(`hhh-platform-<version>.tgz`). The version lives in the root `package.json`.

Every PR into `dev` adds its line under `## Unreleased`, in `### Added`, `### Changed` or
`### Fixed`. At release, the Ship It skill turns that section into `## vX.Y.Z — <summary>`:
a minor bump if anything is under Added, otherwise a patch bump. The publish workflow uses
that section as the GitHub Release notes.

## Unreleased

### Added
- **`@hhh/ui` components:** `AppBar` (menu, brand with the version badge, search, the app's
  actions, keyboard shortcuts, theme toggle, settings), `ThemeToggle`, `SettingsPanel` with
  `InstanceInfoCard` and `BackupsCard` (back up now, download, restore and upload-restore, each
  restore confirmed first, errors inside the dialog), `Dialog` and `ConfirmDialog` on native
  `<dialog>`, `ToastProvider`/`useToast`, `Button`/`ButtonLink`/`IconButton`, `TextField`,
  `Textarea`, `Select`, `Checkbox`, `Badge`, `Spinner`; styles in `styles/components.css`.
  On phones the app bar's own buttons go icon-only, with their labels kept for screen readers.
- **Showcase and screenshots:** `npm run showcase` builds a page with every component;
  `scripts/screenshots.ts` captures it in both themes (desktop and phone) into
  `docs/screenshots/`, running in the Playwright image.
- **`hhhConfig({ react })`:** the React and hooks lint rules for React files.
- **`@hhh/ui` design tokens:** one source (`src/tokens.ts`) for every colour, size, radius, shadow,
  duration and layer, generated into `styles/tokens.css`. Light (Crane Charts' greys) is the default,
  dark (PhotoMapper's navy) applies when the system prefers it or the user picks it; one orange
  accent. A test checks all 29 text/background pairs reach 4.5:1 in both themes.
- **`@hhh/ui` base styles and fonts:** Inter 4.1 self-hosted (OFL), focus ring, reduced motion,
  `hhh-tabular` and `hhh-sr-only` helpers.
- **Theme handling:** follows the system until the user picks; `theme-init.js` applies a stored pick
  before first paint without an inline script; `src/theme.ts` is what the toggle calls.
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
