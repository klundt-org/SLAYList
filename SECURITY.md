# Security policy

## Reporting a vulnerability

SLAYList is a private family-music app whose source code is public (AGPL-3.0-or-later — see `LICENSE`). If you find a security issue in the public source code, please report it privately via GitHub's **"Report a vulnerability"** button on the Security tab, or by emailing the maintainer listed on the GitHub profile. Please do not file public issues for suspected vulnerabilities.

A response acknowledging the report is the goal within a few days; this is a personal-time project, so resolution timelines are best-effort.

## A note on the open Dependabot alerts

If you're browsing this repository and notice Dependabot alerts, they're triaged — not neglect. **Every alert to date has been a dev/build-tooling dependency, never a dependency that executes in the deployed, internet-facing app.** The deployed surface is static built frontend assets (no `node_modules` ships) plus the API managed function (built from an isolated `--ignore-workspace` install that never sees the dev tree). This note is kept current across two triage passes — **Sprint 3.1.5** (the first pass) and **Sprint 6.0.1** (2026-11-25, the re-triage below).

### Sprint 6.0.1 re-triage (current)

By Sprint 6.0.1 the open count had grown to **91** (3 critical, 34 high, 43 moderate, 11 low) — the `@azure/static-web-apps-cli` + `azurite` transitive trees had drifted and Epic 3 added the MSAL tooling, exactly the "override maintenance cost" the BACKLOG entry below predicted. Re-triage confirmed the standing invariant held: **0 of the 91 execute in the deployed app** — 80 were `scope=development`, and even the 11 `scope=runtime` were frontend **build** tools (`vite`/`browserslist`/`@babel/core`) that never ship to the browser.

**What cleared it:** a within-range refresh of the whole workspace lockfile (`pnpm update -r`), which pulls the fixed transitive versions the parents' ranges already permitted and clears dozens of advisories "for free" — bumping `@azure/static-web-apps-cli`→2.1.0, `azurite`→3.38.0, `azure-functions-core-tools`→4.17.0, `vite`→6.4.6, `vitest`→4.1.12 among the dev/build tooling, and carrying **within-major** bumps of the frontend's runtime deps too (`react`/`react-dom` 19.0→19.3, `@azure/msal-browser` 5.27→5.30, `@azure/msal-react` 5.7→5.8 — no breaking major bump). Plus one direct-devDep range bump (`happy-dom` `^20`→`^21`) and an expanded, exact-pinned `overrides` block (`adm-zip`, `glob`, `minimatch`, `@azure/msal-node`, `@opentelemetry/instrumentation-http`, and — via a new **range-window** selector that spares the frontend's healthy `vite@6.4.6` — `vite@7.x`/`esbuild` as bundled by `vitest`). As in 3.1.5, applied **empirically and verified not to break anything**: clean `pnpm -r build`, the full test suite (114 tests), `swa`/`func` CLIs loading, and an azurite blob/table/queue round-trip all pass. `pnpm audit` drops from 23 to **3** on the refreshed tree.

### What's left, and why it's not "open and ignored"

Three advisories remain, all dev-only and either unpatched upstream or unpatchable here:

- **`extract-zip`** (2 instances, high — GHSA-7pqw-9j4j-h8q3, GHSA-jmr9-qjv8-65gv). **No fix is published** (latest is 2.0.1; the advisory's "≥2.0.2" does not exist). It is a transitive of **`azure-functions-core-tools`**, used only at install time to unpack the Microsoft-hosted `func` binary — dev-only and unreachable (no attacker-controlled archive).
- **`uuid`** (medium — GHSA-w5hq-g745-h8pq, a missing buffer-bounds check when a `buf` argument is passed). **Cannot be patched:** the fix (`uuid` ≥ 11.1.1) removed the `uuid/v4` subpath export that azurite's legacy `@azure/ms-rest-js` does `require('uuid/v4')` against — forcing it crashes azurite at load (`ERR_PACKAGE_PATH_NOT_EXPORTED`, verified). Transitive of **`azurite`** (the local Storage emulator, D35), dev-only, and unreachable (ms-rest-js never passes an attacker-controlled `buf`).

Both are **dismissed in GitHub with reason "Vulnerable code is not actually used"**, not left silently open. (Historical: `happy-dom`'s Critical script-eval RCE, CVE-2025-61927, was the one runtime-reachable advisory ever found — fixed in 3.1.5 by the `happy-dom` major bump, and kept current at `^21` here.)

### How this is tracked

Tracked as an "Emergent" entry in `docs/BACKLOG.md`:

- **The overrides carry a maintenance cost** — they pin transitive deps, so a stale override can hold a dep *back*, and the open count creeps up as the dev-tool trees drift (3.1.5 drove 23→2; by 6.0.1 it had grown to 91). When `azurite` / `@azure/static-web-apps-cli` update their ranges, re-run the refresh-then-override drill and **re-verify the dev stack** (azurite round-trip + build + tests). The range-window selector form (`pkg@>=A <B`) is documented in `pnpm-workspace.yaml` for deps that live on multiple major lines at once.
- **`uuid` / `extract-zip` re-check trigger:** if azurite drops the legacy `ms-rest-js` `uuid/v4` path, or `extract-zip` ships a fix, apply it and remove the dismissal.
- **Escalation rule:** if any flagged package ever lands on a *deployed runtime* code path (not dev/CI-only), re-triage immediately rather than waiting.

### Summary

The Security-tab count is what GitHub reports verbatim from npm advisories regardless of reachability. The substantive read: every advisory has been dev/build-tooling only; the one runtime-reachable one ever found (happy-dom) was fixed; Sprints 3.1.5 and 6.0.1 patched the rest of the dev-tool families that *could* be patched without breaking the emulator; the residual holdouts (`extract-zip`, `uuid`) are dev-only, unreachable, and dismissed with reason. If that picture changes, this note will too.
