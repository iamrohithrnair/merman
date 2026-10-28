---
name: release
description: Cut a merman release - version bump, changelog, verify, tag and push. Use when asked to "release", "bump the version", "ship 0.x" or "publish".
---

# Release

1. **Pick the version.** Breaking option or token renames are minor while below 1.0 (and major after). New features are minor. Fixes are patch.
2. **Set it in the manifest**: `version` in `.claude-plugin/plugin.json`.
3. **Changelog:** add a dated `## [x.y.z]` at the top of docs/CHANGELOG.md, with Added, Changed and Fixed written for users. PRs do not touch the file, so write it from the "What changes for the user" section of every PR merged since the last tag (`git log vPREV..HEAD --oneline`), one entry per user-visible change, linking the PR. Fold in anything still under `## [Unreleased]` and drop that heading.
4. **Generated files:** if `scripts/package.json` changed, run `npm --prefix scripts run build:vendor`, and confirm the bundle has no `import` statements and no non-MIT code (`grep -c -i elk hooks/vendor/*.js` must print 0).
5. **Verify:** run every step in AGENTS.md Verify, plus `live-check` of `/merman demo` and `/merman demo-rtl`, reading every Hebrew line right to left.
6. **Fresh install test** against a throwaway config:
   ```
   mkdir -p <scratch>/fresh/skills && ln -s <repo> <scratch>/fresh/skills/merman
   CLAUDE_CONFIG_DIR=<scratch>/fresh claude plugin list
   ```
   It must show `merman@skills-dir` at the new version with `Status: ✔ loaded`.
7. **Release PR:** `main` only takes merges through a PR with green checks, so open the release commit as a PR and merge it.
8. **Tag main:** `git tag vX.Y.Z <merge commit> && git push origin vX.Y.Z`. The `release` workflow checks the tag against `plugin.json`, checks the tag is on `main`, and publishes the GitHub release from the CHANGELOG section.
9. **Confirm** CI and the release workflow are green.
10. **Blog:** in `~/git/nahum-writing`, update the "What it draws today" section of `posts/2026-10-02-merman/article.md` (version, date, features, counts, limits) and any number in the opening paragraph, then release the blog per its AGENTS.md. Skip when the clone is missing and say so.
