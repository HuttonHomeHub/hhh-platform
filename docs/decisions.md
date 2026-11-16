# Decisions

Dated log of choices with lasting effect: what, why, and what was rejected. Newest first.
The overall standard is the HuttonHomeHub App Standard (link in the README).

## 2026-11-16 — Tool versions for the foundation

- **TypeScript 6.0**, not 7.0 (the newest): typescript-eslint 8.72 supports TypeScript below 6.1.
  Move to 7 when typescript-eslint supports it. Dependabot ignores TypeScript majors until then.
- **ESLint 9**, not 10: eslint-plugin-react (PhotoMapper, and Crane Charts after its rebuild)
  supports ESLint up to 9.7. Same as PhotoMapper's ignored `@eslint/js` 10 bump.
- **Vitest 5.1**, not PhotoMapper's 4.1: npm 10 (the npm that ships with Node 22) crashes
  resolving Vitest 4.1.9's dependencies from scratch (`Cannot read properties of null (reading
'edgesOut')`); 5.1 installs cleanly. PhotoMapper moves to 5.1 when it adopts `@hhh/config`.
  Rejected: requiring npm 11 everywhere, which Node 22 doesn't ship.
- **`requiredTools` instead of `peerDependencies`** in `@hhh/config`: peers inside an npm
  workspace hit the same npm 10 crash, and apps get the package as a vendored copy anyway.

## 2026-11-16 — How apps get the platform

Vendored releases (`scripts/vendor.ts` into `vendor/hhh-platform/`, checked in CI against the
release manifest). Rejected: the GitHub Packages registry (needs the token's Packages
permission, which the standard rules out) and git dependencies (npm can't install one package
out of a multi-package repo cleanly).
