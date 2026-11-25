# Epic 6 — Transcoder Container

**Goal:** The ffmpeg worker, built and tested in isolation BEFORE the event trigger is wired (Epic 7), so "does ffmpeg work in my container" is debugged on its own. **The image build/push/deploy plumbing is proven on a trivial placeholder container FIRST (Sprint 6.0)** — the transcoder's equivalent of Epic 2's "prove the pipeline on something dumb before adding real logic."

**Exit criterion:** hand the container a raw file (manual trigger) → it produces a finished song and updates the record.

**Guardrails:** Container App, ffmpeg in the image (D4). Opus default / AAC fallback (D9) — decide the single output here.

**Scope note:** Sprint 6.0 covers the **dev** image pipeline only. The prod image pipeline lands in Epic 9 alongside `main` → prod (mirrors the dev-then-prod rhythm of Epic 1/9 and Epic 2/9). Once 6.0 lands, 6.3 may simplify or fold into 6.2 — left for Epic 6's own planning pass to decide.

---

## Sprint 6.0 — Container image build/push/deploy pipeline (placeholder container)  **[Both]**

*Stub sprint — surfaced now to make the dependency on a working image pipeline visible from the start. Detailed scoping (registry choice — ACR vs. GHCR vs. Docker Hub; tagging convention; revision-update mechanism; placeholder container shape — "exit immediately" vs. "stays up briefly with a /health endpoint") is deferred to Epic 6's own planning pass at `/start-sprint`.*

- As the owner, I want the container image build/push/deploy plumbing proven on a trivial placeholder image so that when 6.1's real ffmpeg logic lands, it goes into a pipeline that already works.
- As a developer, I want a workflow that builds a Dockerfile, pushes the image to a registry, and updates the dev Container App revision on push to `develop`, so the same plumbing that ships frontend+API in Epic 2 has an image-side counterpart.

Acceptance (high-level — detailed scoping at sprint planning):
- A registry choice is made and recorded in `docs/VERSIONS.md` + `docs/DECISIONS.md`. **If the choice is ACR (Azure Container Registry), the deploy identity's push permission (`AcrPush`) is granted by EXTENDING the bootstrap-deploy-identity script (D41) — not hand-added — so the deploy identity's RBAC stays in one reviewed, prod-repeatable place. (GHCR / Docker Hub use non-Azure registry auth via a GitHub secret instead, so the bootstrap script is unaffected.)**
- A GitHub Actions workflow builds a placeholder Dockerfile, pushes the image, and updates the dev Container App revision.
- The placeholder container runs end-to-end on the dev Container App via that workflow on a push to `develop`.
- Depends on: Epic 1.4 (dev Container App environment exists). Does NOT depend on: Epic 3 (transcoder is back-end, not user-facing — D22 applies to user-facing environments).

Reviewer focus added to this sprint at planning time. Prod image pipeline = Epic 9.

---

## Sprint 6.0.1 — Dependabot re-triage + override refresh  **[Agent]** *(inserted/emergent)*

*Second security-triage pass, mirroring Sprint 3.1.5's proven methodology. Surfaced when a branch push warned the default branch carried **91 open Dependabot alerts** (3 critical, 34 high, 43 moderate, 11 low) — up from the 23 that 3.1.5 drove down to 2. The growth came from Epic 3's MSAL/auth tooling and the `@azure/static-web-apps-cli` + `azurite` transitive trees drifting, exactly as the BACKLOG "override maintenance cost" entry predicted. Triage confirmed **0 of 91 execute in the deployed, internet-facing app** — 80 are `scope=development`, and even the 11 `scope=runtime` are frontend **build** tools (`vite`/`browserslist`/`@babel/core`) that never ship to the browser (the deployed API is an isolated `--ignore-workspace` build; the frontend ships static built assets, no `node_modules`). So this is hygiene + public-repo honesty, not a deployed-app vulnerability.*

- As a repo maintainer, I want the open Dependabot alerts driven back down and the stale `SECURITY.md` claim ("only `uuid` remains") corrected, so a casual public-repo browser sees a true, triaged posture rather than 91 unexplained alerts.

Acceptance:
- All 91 open alerts categorized (severity × scope × manifest); the categorization confirms none are in a deployed runtime dependency (recorded in the triage note).
- The fixable families are cleared by a within-range `pnpm update -r` refresh (pulls the fixed transitives the ranges already permit — the bulk of the drop; bumps `@azure/static-web-apps-cli` 2.1.0, `azurite` 3.38.0, `azure-functions-core-tools` 4.17.0, `vite` 6.4.6, `vitest` 4.1.12, and carries **within-major** bumps of the frontend runtime deps — react/react-dom 19.0→19.3, msal-browser 5.27→5.30, msal-react 5.7→5.8) plus the `happy-dom` `^20`→`^21` bump and refreshed exact-pin `overrides` in `pnpm-workspace.yaml` for the residual transitive advisories (deterministic exact pins per the 3.1.5 methodology, now including a range-window selector for multi-major deps). **No breaking major bump of any shipped dependency; no new source files.**
- The genuinely-unpatched + dev-only + unreachable advisories (`extract-zip`, `node-forge`, `adm-zip` instances with no upstream fix) are **dismissed in GitHub with a reason** (mirroring the `uuid` precedent) — not left silently open.
- Dev stack re-verified against the bumped tree: clean `pnpm -r build`, full test suite green, and azurite blob/queue/table round-trip (azurite is the fragile dependent — the whole reason overrides are exact-pinned).
- `SECURITY.md` rewritten to the true current numbers + reasoning; `docs/BACKLOG.md` override-maintenance entry updated; `docs/VERSIONS.md` milestone recorded. Post-merge, the live Dependabot count is the confirmation (like Sprint 6.0's post-merge live check — Dependabot only re-scans the default branch after merge).
- Depends on: nothing new (dev-tooling only). Does NOT touch deployed infra, the D22 gate, or any runtime code path.

---

## Sprint 6.1 — Transcode logic  **[Agent]**
- As a developer, I want the worker to read a raw file, transcode to the chosen format, write to `finished`, fill format/size/duration, and flip the record to `ready` — or `failed` on error.

Acceptance:
- Given a raw file + record id, produces finished audio and a `ready` record; on bad input sets `failed`; output format decided (record in BACKLOG resolution + VERSIONS).
- **MI + RBAC end-to-end runtime verification (D25 — load-bearing, deferred from Sprint 1.4 per the verify-don't-assume discipline pattern).** Sprint 1.4 configured the system-assigned MI on the Container App and granted Storage Blob Data Contributor + Storage Table Data Contributor on the storage account, but did NOT verify the actual auth path the transcoder will use. Sprint 6.1's first real storage call (reading a raw blob, writing a finished blob, or updating a `Songs` record) IS the verification of "MI + RBAC works for storage access." If the first storage call returns 403, the issue is in scope for Sprint 6.1 — diagnose using the `Managed Identity ID surfaces` operational hazards note in `docs/DEVELOPER_GUIDE.md` (cross-check Principal ID vs. App ID on the IAM page; verify the Container App's live MI matches the assignee on the storage account; verify role scope is the storage account, not subscription/RG; verify RBAC propagation has elapsed). Record the verification outcome as a D25 implementation note in `docs/DECISIONS.md` at this sprint's `/close-sprint` ("MI auth path verified end-to-end on YYYY-MM-DD"). Same verify-don't-assume discipline pattern used by **D18** (Node 22 SWA runtime), **D24** (Storage Diagnostics → LAW verified at Sprint 1.3), **D27** (ffmpeg codec image), **D34** (pnpm + Oryx build), **D36** (App Insights public access), and **D37** (OIDC SWA deploy — itself a deferral from Sprint 1.2/2.1 setup to Sprint 2.2 consuming sprint). If runtime verification fails AND can't be made to work in this sprint, treat as a Sprint 6.1 critical-finding regression on the D25 setup — fix in scope.
- **Originals are NEVER deleted (D28)** — the `raw-uploads` blob is left intact after successful transcode. No cleanup of the raw side ever, full stop. The previous "decide keep-vs-discard original (lean discard)" question is **resolved by D28** and removed.
- **Transcoder filename + stderr discipline per D32 (pick one mitigation):**
  - **(a, preferred):** download the raw blob to a local path named after the **`songId`** (not the human-readable filename), run ffmpeg against the songId-named local file, then write the human-readable finished name into the `finished` container at the end. ffmpeg's stderr only ever embeds the songId — no title-slug PII enters App Insights via stderr.
  - **(b, acceptable filter):** capture ffmpeg's stderr to memory, substitute the input filename with the songId in every captured line, then emit the sanitized text. The raw stderr never reaches App Insights.
  - Record which mitigation was chosen and why in `docs/DECISIONS.md` (a sub-bullet under D32, not a new D-entry — D32 already contemplates both).

## Sprint 6.2 — Containerize with ffmpeg  **[Agent]**
- As a developer, I want a Dockerfile with ffmpeg baked in so the worker runs anywhere.

Acceptance:
- Image builds; ffmpeg present; runs the transcode logic; ffmpeg version recorded in `docs/VERSIONS.md`.
- **Codec verification against the chosen base image (D27).** Don't assume "ffmpeg has aac" (general fact) means "our image has aac" (specific fact) — same skepticism D18 applied to the SWA runtime. Run `ffmpeg -encoders` against the actual image and confirm:
  - `libopus` is present (Opus output path);
  - The built-in `aac` encoder is present (AAC fallback path);
  - **`libfdk_aac` is NOT present** (per D27 — its presence in the chosen base image is the signal that the image is the `nonfree` variant and must not be used).
  Record the `ffmpeg -encoders | grep -E '(opus|aac)'` output (or equivalent) in `docs/VERSIONS.md` alongside the ffmpeg version, dated, so the verification is auditable.
- Base image choice (Debian-based, Alpine-based, or community image without nonfree codecs) recorded in `docs/VERSIONS.md` + `docs/DECISIONS.md` if it constitutes a new architectural choice worth documenting.

## Sprint 6.3 — Build/push image, deploy to dev Container App  **[Both]**
- As the owner, I want the image deployed to the dev Container App so it's ready for the event trigger.
Acceptance: image pushed to a registry; dev Container App runs it; manual invocation transcodes a real file end to end.

---
### Reviewer focus (/wrap-sprint)
- Sr dev (lead): failure paths set `failed` (no stuck `processing`); idempotent if the same job runs twice.
- Infosec: container has least-privilege access to storage/table **via Managed Identity (D25), not a connection string** — verify the two RBAC role assignments (Blob Data Contributor + Table Data Contributor) and confirm no storage secret is baked into the image, env vars, or app config; base image reasonably current.
- Solution architect: scale-to-zero preserved (D4); container writes finished + updates Table (D3) — never a JSON file; transcoder authenticates via MI per D25 (no connection string code path).
- DevOps: image build reproducible; registry access via secrets; **the container emits to Application Insights (D24)** — both successful-transcode and failed-transcode events are queryable in the dev App Insights instance.
- Support: a failed transcode produces a diagnosable signal **specifically in App Insights** (provide the KQL query that surfaces transcode failures with the song id + reason) — "diagnosable" is verifiable against a query, not a vague claim.
