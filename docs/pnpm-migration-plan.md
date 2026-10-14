# NasrinAI Package Manager Migration: npm to pnpm

**Status:** Migration preparation; not switched yet.
**Scope:** Dependency installation, lockfile integrity, CI, security auditing, and Vercel deployment.

## Why this is staged

NasrinAI currently commits `package-lock.json` and CI relies on npm commands. A safe migration must commit a real, generated `pnpm-lock.yaml` before switching CI to frozen pnpm installs or removing the npm lockfile. Do not hand-author a pnpm lockfile or claim reproducibility without verifying it.

The current execution environment could not download pnpm from the npm registry. Therefore this preparation deliberately does not replace the working npm lockfile or CI workflow.

## Migration requirements

1. Choose and pin a supported pnpm version using the `packageManager` field in `package.json` and Corepack.
2. Generate `pnpm-lock.yaml` from the existing npm dependency graph using pnpm's supported import flow; review the resulting dependency versions and integrity data.
3. Install dependencies with lifecycle scripts disabled during initial validation where practical; review any packages that require build scripts before allowing them.
4. Run the complete test suite, secret scan, database tests, and high-severity dependency audit.
5. Update GitHub Actions to set up the pinned pnpm version and use `pnpm install --frozen-lockfile`. Add a lockfile consistency check and ensure every job uses the intended package manager.
6. Review Vercel's package-manager detection, install/build commands, Node version, caching, and deployment previews.
7. Verify a clean install from scratch and compare the dependency graph against the existing npm lockfile. Investigate unexpected upgrades or removals.
8. Remove `package-lock.json` only after the pnpm lockfile and CI are verified. Do not commit both lockfiles as competing sources of truth after cutover.
9. Merge only after required checks pass; verify the resulting production deployment.

## Security and rollback

- Do not run package lifecycle scripts blindly during lockfile generation.
- Keep dependency auditing enabled and resolve high-severity findings rather than suppressing them.
- Never weaken or skip existing test, secret, or database gates to make the migration green.
- Keep the existing npm-based main branch deployable until the pnpm lockfile and CI are validated.
- If the migration fails, revert the migration PR rather than improvising lockfile edits in production.

## Completion criteria

- One authoritative lockfile (`pnpm-lock.yaml`) is committed and reproducible.
- CI installs with a frozen lockfile and all required checks pass.
- Local development and Vercel use the pinned pnpm version.
- The dependency audit, tests, secret scan, database checks, and preview deployment pass.
- The team can clean-install and build without relying on an uncommitted generated lockfile.
