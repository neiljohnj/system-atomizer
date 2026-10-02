# Phase 1 test evidence

> Publication follow-up, 2026-10-02: after this implementation/verification snapshot, the owner authorized committing and pushing all Phase 1 changes without rerunning tests. References below to uncommitted work or no push describe the original bounded turn. No deployment or real-data upgrade was authorized or performed.

Executed 2026-10-02 on Windows in `D:\itcc47-atomizer`. All application/database verification used fresh absolute disposable storage roots under the system temporary directory. The application appends `data` beneath each root. No owner database was opened, migrated, reset or copied. Credentials and fixture databases are not retained in this report.

## Baseline and environment

- Existing remote: `https://github.com/neiljohnj/system-atomizer.git`; branch `phase-1`. Initial empty-directory inspection was followed by the user's explicit authorization to clone there. No prior local work existed in that target.
- Reviewed, cloned, fetched and final local HEAD: `1df70751504a56ab961f787923c7b20ea61d65f6`. Initial remote-tracking refs and final live `phase-1`/`master` tips matched. Work remains uncommitted; no publication operation was performed. The gitlink and historical audit documents were left unchanged.
- Node **22.15.0**; shell npm **10.9.2**, elevated test environment npm **10.8.1**; locked Vite **6.4.3**, Vitest **3.2.7**, TypeScript **5.9.3**. No dependency version edits.
- Clean clone dependency installation: `npm.cmd ci --ignore-scripts --no-audit --no-fund --cache .npm-cache` completed (313 packages), followed by a passing baseline build. This proves a fresh dependency install/build on this configured machine, not a clean OS/institutional installation.
- Baseline before implementation: **15 files / 90 tests passed**, baseline build passed, existing disposable smoke passed. These were newly executed, not copied from the older Phase 0 report.
- Initial restricted-account test execution could not start `tsx`: `uv_os_get_passwd` / `ENOMEM`. That run reported 34 pass, 2 fail, 54 skipped. Re-running in the normal Windows user environment passed all 90. No application guard was changed to bypass this environment problem. Subsequent subprocess/browser checks used that environment.

## Final commands and outcomes

| Command | Actual result |
|---|---|
| `npm.cmd test` | **17 test files / 129 tests passed**, 21.26 seconds in the final full run. Includes all original 90, 34 setup cases, 4 migration cases and 1 additional demo-reset case. |
| `npm.cmd run build` | PASS: frontend typecheck, Vite build (1963 modules), compiled server. Existing authoring chunk warning remains (~692.30 kB minified). |
| `node server/test-fixtures/run-smoke.mjs` | PASS on its own disposable source-server root: setup, progressive authoring, asset, rubric acknowledgement, publication, student part claim/strict validation/submission, account switch and provisional evaluation. |
| `$env:ATOM_TEST_COMPILED='true'; node node_modules/vitest/vitest.mjs run server/src/storage-root.test.ts` | **2/2 PASS**, separate compiled-tool check. Source-mode root checks also passed in the full suite. |
| `node server/test-fixtures/restore-drill.mjs` | PASS for both stopped-server corpora, described below. |
| `node server/test-fixtures/browser-phase1.mjs` with existing Playwright/evidence-path environment | PASS: actual rendered setup through LAN publication and mobile student upload; nine screenshots, no unexpected page/console errors and no console warnings. |
| `git diff --check` | PASS. Git's LF/CRLF conversion notices are informational; no whitespace errors. |

Node prints its existing experimental SQLite warning. The existing HTTP transport warning is expected; no TLS was represented as configured.

## Permanent acceptance coverage

`academic-setup.test.ts` creates a new course and term, Lecture L and Lab A/B, three distinct teaching identities, a manager-only identity, an outside faculty identity and leading-zero students entirely through supported HTTP paths. SQL is used only for adversarial fixtures and invariant snapshots, never as a substitute for course creation.

| Area | Verified behavior |
|---|---|
| Fresh/legacy | Empty normal install; independent new owner; explicit authenticated exact legacy owner grant; proxy/non-loopback/wrong-identity rejection; no automatic elevation. |
| Administration | Anonymous, ordinary faculty, student and outside-manager calls denied; own manager scope readable; catalog/grant escalation denied; owner/manager have no implicit evidence authority. |
| Identity/structure | Course/term/offering duplicate rejection; leading zeros; multiple explicit lecture links, standalone combined group; cross-offering placement/link/identity edits rejected at service and SQLite boundaries; existing IDs preserved. |
| Roster | Duplicate row, conflicting saved name, unknown group and missing required component rejected; explicit exact identity reuse; read-only preview; stale plan conflicts; identical concurrent repeat returns one applied receipt; altered payload conflicts; no batch credential issuance. |
| Atomic failure | Deliberately injected failure on the second new student rolls back the entire academic batch. Denied requests compare before/after table and operation-owned file hashes; security session/audit bookkeeping is excluded appropriately. |
| Credentials | Forced change before bootstrap; 48-hour expiry path; single use including simultaneous claims; reissue revokes old secrets/sessions; ordinary responses/logs contain no activation secret; handoff is no-store; predictable demo reset refuses managed identities and rolls back prior rows. |
| Publication/freeze | Readiness enforced; own-group publication succeeds; unauthorized shared destinations fail. Structure, placements, deactivation/reactivation, grants and bulk roster writes freeze; unpublish/retarget cannot unlock; safe label/security recovery remains usable; publication/setup race cannot broaden access. |
| Both labs | Each newly provisioned lab instructor authors/publishes, its student activates/submits/downloads, authorized provisional score/deduction persists. Other lab, lecture-only, owner-only and manager-only evidence/evaluation requests are denied. |
| Existing guarantees | Original 54 HTTP authority/lifecycle cases still pass: collaborators, immutable release/evidence behavior, upload-time/commit-time checks, idempotency, current-submission uniqueness and mutation integrity. Original request-origin/proxy, root, identifier and recovery tests retained. |
| Historical exception | The original legacy shared-release transfer probe remains passing as a test that the unresolved condition still exists. It is **not** counted as historical-isolation closure. Supported new administration cannot perform that transfer after publication. |
| Integrity | Final academic fixture `integrity_check=ok`, no FK violations or duplicate enrollment/placement pairs. Migration preserves existing manual totals and stored-file SHA-256. |

The first new HTTP fixture run hit the existing minimum upload-size validation (the fixture incorrectly requested 1024 bytes). The fixture was corrected to the supported 1 MiB minimum; the production guard was unchanged. Malformed nested rows and invalid JSON-object bodies now have deterministic negative tests.

`academic-migration.test.ts` constructs disposable version-6 legacy state, snapshots old IDs/credentials/release/submission/evaluation relationships, preserves manual score 111 and deduction 13 as evidence, verifies file bytes/hash, and applies migration twice. A separate malformed placement fixture proves quarantine without deletion; it is intentionally not represented as a clean legacy database. All four migration cases pass.

## Stopped-server restore evidence

The existing drill builds its synthetic sample corpus, stops the server, copies the entire `data` tree to another new root, verifies every relative path/size/hash, checks SQLite and file relationships, restarts the restored copy and signs in/downloads evidence. **6 files copied exactly; source unchanged.**

The added Phase 1 drill creates a fresh normal class through APIs and runs both lab workflows, including materials, submissions, provisional evaluations and one issued-but-unclaimed activation. It then stops, copies and verifies **7 files exactly and 24 table snapshots**. Checks include catalog, compatibility subject, term/offering, owner/manager grants, group links/assignments, enrollment/placement, batch receipts, credentials/activation metadata and permanent lock. Integrity/FKs and all referenced stored sizes/hashes pass. Restored faculty/students can sign in and download their scoped materials/evidence; other lab, manager and owner-only evidence access remains denied. Scores/deductions match and the unclaimed activation state survives. Source manifests and snapshots remain unchanged after restored checks. Temporary roots/processes are owned by the harness and cleaned after completion.

## Rendered browser evidence

Browser plugin not available; the frontend testing skill's fallback used the already installed **Playwright 1.62.1 / Chromium 151.0.7922.34**. No browser dependency was added to the app. The compiled server used fresh synthetic data, a dynamic loopback port, and later that same listener via the host's actual LAN IPv4 address. The reported page title was **ATOM · Local academic workspace**. No physical second client or firewall traversal is implied.

Flow: `/setup` → **Set up course** → new course/term/offering → three faculty private hand-offs → Lecture L/Lab A/Lab B assignments and links → injected 503 preserves all group edits → successful save → manual preview cancellation → manual Apply → pasted duplicate rejected → corrected preview/Apply → separate student activation → mobile Review → ready/manager-only Activities → account switch during delayed prior-account response → assigned instructor authors/publishes via LAN HTTP → student activates/uploads at 390px → owner sees permanent disabled configuration.

Desktop: **1440×1000**. Mobile: **390×844**. Enlarged-layout test: **720×500 CSS pixels at device scale 2**, equivalent reflow to 200% at a 1440px desktop width. Native browser-chrome zoom was not automated and is not claimed. Screenshot review verifies the setup map stacks and controls remain usable. The roster intentionally scrolls within its table wrapper on narrow screens; the page itself has no horizontal overflow.

Initial browser attempts uncovered dropdown accessible-name ambiguity and an HTML pattern incompatible with modern browser Unicode regex rules; both were corrected. Harness waits were repaired to wait for confirmed authentication and pending route completion. CSS-only zoom was replaced by an independent correctly sized browser context. Final run has zero unexpected page/console errors/warnings; the deliberately injected 503 is expected. Local/session storage contains no setup/roster/activation keys, and delayed previous-account configuration does not render after switching. Secrets were kept masked in screenshots and never written to evidence output.

Sanitized evidence is outside the repository at `C:\Users\User\.codex\visualizations\2026\10\02\01a0fb33-c0cc-79f3-9fe9-3db07dbfcc46\phase-1-ui`. It contains nine named PNGs and `browser-results.json`; the screen inventory and remaining defects are in [UI_REVIEW.md](UI_REVIEW.md). Reproduce by setting `ATOM_PLAYWRIGHT_MODULE` to an existing Playwright module's absolute `index.mjs` path and `ATOM_UI_EVIDENCE` to an absolute external evidence directory, then running the browser fixture after a build.

## Unperformed checks and retained limits

- No real dataset upgrade, owner-root backup, institutional configuration, external notification, deployment, firewall/ACL/proxy/TLS change or physical second-device test.
- No clean Windows installation, cross-browser matrix, screen-reader audit, native browser zoom automation, 200-row browser performance benchmark or power-loss/crash recovery claim.
- Existing mobile activity-document headings overlap part of the submission panel; upload/receipt succeeded, but that older surface is not visually certified. Existing static connection-address text is not a live network probe.
- A01 legacy temporal evidence policy remains unresolved; the pilot prevents new supported transfers but cannot reconstruct old memberships. Direct external SQLite edits are not protected.
- A07 totals/deductions remain provisional; syllabus, gradebook policy, exams/TOS, response analysis, scanning and transfer policy are out of scope.
- No commit, push, PR or deployment was made. This evidence describes the local candidate, not a published build.
