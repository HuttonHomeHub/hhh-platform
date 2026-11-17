# Changelog

All notable changes to hhh-platform. Versions are the GitHub Releases the apps vendor
(`hhh-platform-<version>.tgz`). The version lives in the root `package.json`.

Every PR into `dev` adds its line under `## Unreleased`, in `### Added`, `### Changed` or
`### Fixed`. At release, the Ship It skill turns that section into `## vX.Y.Z — <summary>`:
a minor bump if anything is under Added, otherwise a patch bump. The publish workflow uses
that section as the GitHub Release notes.

## Unreleased

## v0.3.0 — theme-init Vite plugin, self-centring dialogs

### Added
- **`@hhh/config/vite`: `hhhThemeInit()`**, the Vite plugin every app uses to load `theme-init.js`
  before first paint: it serves it in dev, emits it beside `index.html` in the build, and adds the
  `<script>` tag to `<head>` (the CSP allows no inline script). From PhotoMapper, where it was a local
  plugin.

### Fixed
- Dialogs (`hhh-dialog`) centre themselves; an app's `* { margin: 0 }` reset used to pin them to the
  top-left corner (found in PhotoMapper).

## v0.2.0 — apiFetch, kit errors and rates for PhotoMapper's adoption

### Added
- **`@hhh/ui`: `apiFetch`**, the one way the browser calls the API: JSON or FormData bodies, the
  CSRF header on writes (retried once if the server has just issued a new cookie), and `ApiError`
  carrying the server's message, status and `details`.

### Changed
- **`@hhh/server` error handler:** an error carrying its own 4xx `status` or `statusCode` (as
  Express's http-errors do) is answered with that status and message; multer's file-too-large error
  is answered 413. Anything else is still a generic 500.
- **`parseRate` takes multiples:** `"1000 per 15 minutes"` as well as `"60 per minute"`.
- **ESLint: `x == null` is allowed** (it matches null and undefined together); every other `==`
  is still an error. PhotoMapper's code uses the idiom 62 times.
- Test tooling: jsdom 31.0.1, @testing-library/dom 10.4.2 (Dependabot).

## v0.1.0 — foundation, design system, app shell and server kit

### Added
- **`@hhh/server`, data:** `openDatabase` (WAL, foreign keys, busy timeout), `runMigrations`
  (numbered SQL files recorded with checksums, a copy of a database with data before migrating,
  each migration in its own transaction, an edited released migration stops startup),
  `createLock` (one write at a time across files and database), backups (`createBackup`,
  `listBackups`, `pruneBackups` per kind, `isBackupName`) and `restoreBackup` (every entry name,
  the declared and written size, and the database's integrity and tables checked before anything
  live is touched; a `prerestore` safety backup; uploads swapped first and the database last,
  copying when uploads are on another disk, and the old uploads put back if the swap fails),
  plus `startBackupScheduler` with its status for the Settings panel.
- **`@hhh/server`, request handling:** `loadSettings` (shared settings, old names with deprecation,
  every bad value listed at startup), `resolveDataPaths`, `createLogger`/`httpLogger` (one small JSON
  line per request, no headers, health probes skipped), JSON errors (`HttpError`, validation 400 with
  the field, bad JSON 400, too large 413, everything else a logged 500), `securityHeaders` with a
  per-request CSP nonce, double-submit `csrf`, `rateLimiter`/`parseRate` ("60 per minute"),
  `healthRoutes` (`/health`, `/ready`, `/version`), `gracefulShutdown`, and `createBaseApp`/
  `finishApp` so every app's middleware runs in the same order. Ships compiled JavaScript with
  type definitions.
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
