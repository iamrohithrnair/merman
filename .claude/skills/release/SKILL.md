---
name: release
description: Cut a merman release - version bump, changelog, verify, tag and push. Use when asked to "release", "bump the version", "ship 0.x" or "publish".
---

# Release

1. **Pick the version.** Breaking option or token renames are minor while below 1.0 (and major after). New features are minor. Fixes are patch.
2. **Set it in both manifests**: `version` in `.claude-plugin/plugin.json` and `plugins[0].version` in `.claude-plugin/marketplace.json`. Leave the marketplace `source` on the previous tag until step 9.
3. **Changelog:** add a dated `## [x.y.z]` at the top of docs/CHANGELOG.md, with Added, Changed and Fixed written for users. Write it from the "What changes for the user" section of every PR or commit since the last tag (`git log vPREV..HEAD --oneline`), one entry per user-visible change. Fold in anything still under `## [Unreleased]` and drop that heading.
4. **Generated files:** if `scripts/package.json` changed, run `npm --prefix scripts run build:vendor`, and confirm the bundle has no `import` statements and no non-MIT code (`grep -c -i elk hooks/vendor/*.js` must print 0).
5. **Verify:** run every step in AGENTS.md Verify, plus `live-check` of `/merman demo` and `/merman demo-rtl`, reading every Hebrew line right to left.
6. **Fresh install test** against a throwaway config:
   ```
   mkdir -p <scratch>/fresh/skills && ln -s <repo> <scratch>/fresh/skills/merman
   CLAUDE_CONFIG_DIR=<scratch>/fresh claude plugin list
   ```
   It must show `merman@skills-dir` at the new version with `Status: ✔ loaded`.
7. **Push the release commit** to `main` and wait for every CI job to pass.
8. **Tag main:** `git tag vX.Y.Z <release commit> && git push origin vX.Y.Z`. The `release` workflow checks the tag against `plugin.json`, checks the tag is on `main`, and publishes the GitHub release from the CHANGELOG section.
9. **Pin the release:** a second commit sets `ref` to `vX.Y.Z` and `sha` to the tagged commit (`git rev-list -n1 vX.Y.Z`) in the `source` of `.claude-plugin/marketplace.json`. Until it is pushed, marketplace installs keep getting the previous release. Then check a clean install from GitHub:
   ```
   CLAUDE_CONFIG_DIR=<scratch>/market claude plugin marketplace add iamrohithrnair/merman
   CLAUDE_CONFIG_DIR=<scratch>/market claude plugin install merman@merman
   CLAUDE_CONFIG_DIR=<scratch>/market claude plugin list
   ```
   It must show `merman@merman` at the new version, enabled.
10. **Confirm** CI and the release workflow are green.
