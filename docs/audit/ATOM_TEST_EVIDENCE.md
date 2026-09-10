# ATOM test evidence — 2026-09-10

## Reproduction boundary

Checkout `C:\Projects\itcc47-atomizer`, branch `master`, commit `e38627084617eed06e9198ebe3e2d5215eadbd41`, initially clean. Node `v22.13.1`, npm `11.3.0`, Windows/PowerShell, Asia/Taipei. No real class database or files were opened. No demo startup or stress seed was run against the repository.

Scratch root: `C:\Users\neilj\AppData\Local\Temp\atom-audit-20260910-01a088b0` (below, `$scratch`). This is a local temporary evidence location, not an installed feature or a durable backup. Do not publish its databases: even synthetic fixture databases contain password hashes and session records. The results summarized here are retained in the audit documents if temporary files are later removed.

The harness used production-style `dist-server/index.js`, with an IPC wrapper solely to emit the server's existing SIGTERM shutdown event on Windows. Application code was not patched. Ports were chosen with a temporary OS-assigned listener, closed before server startup; no running user listener was stopped. Source run used an explicit `$scratch\source` root; restore used `$scratch\restored`. Both append `data` internally.

## Commands and observed results

| Command / action | Sanitized environment or scope | Actual result | Interpretation |
|---|---|---|---|
| `git status --short`, `git rev-parse HEAD`, `git branch --show-current`, `git log -5 --oneline` | Repository only | Clean; master; matching commit; one visible commit | Prior remote findings concern the same source snapshot |
| `git ls-files`, `git ls-files --stage doc-automator`, `git ls-files .github .gitmodules` | 77 tracked entries | Gitlink mode 160000; no tracked CI or .gitmodules | Full inventory established; external gitlink not recursively audited |
| `node --version`, `npm.cmd --version` | Existing workspace runtime | v22.13.1 / 11.3.0 | Actual execution environment, not a general compatibility guarantee |
| `npm.cmd test` | Script is `vitest run server/src`; tests create disposable roots | Exit 0; **10 files, 29 tests passed**; Vitest 3.2.7; reported duration 5.07 s | Backend unit coverage; no React/browser suite |
| `npm.cmd run build` | `tsc --noEmit && vite build && tsc -p server/tsconfig.json` | Exit 0; 1,955 modules; Vite 6.4.3; bundle build 22.27 s | Full configured build passed; one >500 kB chunk warning, no error |
| `npm.cmd ci --prefix "$scratch\dependencies" --ignore-scripts --no-audit --no-fund` | Copied package.json/lock into new dependency directory | Exit 0; 388 packages in 10 s | Lockfile installation with lifecycle scripts disabled; **not** a second build from clean installed dependencies |
| `node "$scratch\audit.mjs"` | Harness sets absolute roots, free port, preview=false, HTTPS=false, allowed origins empty; no `--demo-accounts` | Main scenarios completed; server remained temporarily available for browser checks, then shut down | Uses real routes and fixture-only SQL to establish two disjoint faculty accounts |
| Harness child: `node server/smoke.mjs` | `ATOM_SMOKE_BASE` points to fresh harness server | Exit 0; “ATOM smoke workflow passed…” | Existing HTTP workflow actually executed; **not browser E2E** |
| `node "$scratch\extra.mjs"` | Restored synthetic root; same compiled app | Exit 0; copied foreign target published despite 404; unpublish mutated despite 403; expired session 401 | Additional write-before-response and session evidence |
| `Get-FileHash package-lock.json -Algorithm SHA256` | Repository lockfile | `6BCB1C3B3BF1C556AFD7AAAA2D53666EF575653BD17D5A9422CD366456FBD199` | Unchanged tracked lockfile; installation did not modify repository dependencies |

Build warning: authoring chunk 689.20 kB (213.32 kB gzip); this is a measured bundle warning, not a measured user-perceived latency or a reason for a rewrite. SQLite experimental warnings occurred during tests; they did not fail execution.

### Test-suite inventory

| File | Tests | Coverage actually represented |
|---|---:|---|
| request-security.test.ts | 3 | Exact/forwarded/configured origin handling |
| assessment-stream.test.ts | 3 | Schedule state, excerpt and manual-position utilities |
| files.test.ts | 4 | Extension/filename/path containment |
| activity-content.test.ts | 5 | Legacy normalization, defaults, supported nodes/links, asset references |
| submission-validation.test.ts | 3 | Sequential claims, warning ZIP checks, descriptive behavior |
| activity-blueprint.test.ts | 3 | Fixture validation, rubric acknowledgement, identifiers/scopes/filenames |
| security.test.ts | 2 | Scrypt verification, login identifier normalization |
| db.test.ts | 3 | Fresh/idempotent migrations, legacy preservation, session repair |
| demo-accounts.test.ts | 1 | Explicit demo credential preparation in a temporary database |
| auth.test.ts | 2 | One-time setup/session and forced student password change |

The smoke covers setup, progressive authoring, image upload, stale draft revision rejection, rubric mismatch acknowledgement, multi-group publication, duplication, faculty logout, forced student password change, visibility, strict file rejection preserving current submission, faculty evaluation and student file download. It does not contain a distinct second instructor fixture. Concurrent idempotency was supplied by this audit; do not describe the original smoke as proving it.

## Synthetic findings: exact observations

Fixture: A is the setup-claimed synthetic faculty and is reassigned exclusively to Lab 2A. Added B is exclusively Lab 2Ax. The two seeded students remain enrolled in the common offering, common lecture and their separate labs. B has a generated in-memory credential; no ordinary class-administration API exists to create this fixture. A shared published smoke activity targets both labs. A separate draft belongs to B and targets only B's lab. Runtime behavior is observed through HTTP; only fixture setup and persisted-state assertions use direct SQLite.

| Scenario | Observation | Assessment |
|---|---|---|
| A combined shared-activity detail | 2 eligible students, 2 current submissions, B student present | A01 reproduced |
| A own lab detail | 1 submission | Concrete own scope works in this fixture |
| A explicit B-group detail | 403 | Does not rescue combined/direct-ID bypass |
| A direct B submission file | 200 | Unauthorized disclosure reproduced |
| A direct B evaluation, no scope | 200 | Unauthorized evaluation reproduced |
| A evaluation with B's forbidden group | 403; stored score became 8 | Denial occurred after mutation |
| Negative / string Infinity score | 400 / 400 | Numeric rejection exists |
| Score 1000 / deduction 2000 | 200; rubric criterion maximum 10, expected maximum 11 | No enforced release-specific policy; only one evaluation row after overwrites |
| A separate B draft detail / publish | 404 / 403 | Original view/publish are restricted |
| A duplicates separate B draft | 201, copy created with B target | Duplicate is less restrictive than view |
| A publishes that copy | HTTP 404; DB status published | Error response masks unauthorized target publication |
| Unpublish with unknown group query | HTTP 403; DB status draft | Response-scope validation is late |
| Topic-associated Midterm -> Final Term | List includes activity; stream excludes it; old topic retained | Reproduced |
| Topic-associated Final Term -> Midterm | Same outcome | Reproduced |
| Two same-key uploads, roughly 512 KB each | 201 and 500; 1 row for key; 1 current submission | Correct unique-row boundary, incorrect retry behavior |
| Unauthenticated partial asset upload | Temp file visible during 250 ms pause; final 401 | Receives file before auth |
| Unauthenticated partial submission upload | Same observation | Receives file before auth |
| Direct non-loopback maintenance listing | 403 | Direct boundary works on tested interface |
| Synthetic loopback forwarding proxy listing | 200 | Conditional deployment mechanism reproduced; no actual proxy deployment asserted |
| Expire synthetic faculty sessions in DB | `/api/bootstrap` 401; reload editor -> login | Expiry works for this state; unsaved-edit continuity not tested |

The concurrency harness swallowed child server stderr to prevent credentials or request internals reaching output. Unique-key source inspection explains the 500; a full server stack trace was not retained. This one run is not a statistical reliability/load study.

## Restore drill and operator procedure

### Executed drill

1. Existing smoke created published rich content, a PNG asset, a student submission and evaluation. Audit added the second student's evidence, a text teaching attachment and a new publication version.
2. Recorded asset/submission stored paths and SHA-256 values in memory. Set the current second-student evaluation to a synthetic restore marker.
3. Closed the audit SQLite connection. Asked the server to stop through its shutdown handler, awaited process exit (which closes its database). No live database copy occurred.
4. Copied the **whole** `source\data` tree to previously absent `restored\data` without overwrite. Opened restored SQLite, ran `PRAGMA integrity_check` (`ok`) and `PRAGMA foreign_key_check` (0 rows), closed it.
5. Started the restored tree under a fresh port. Signed in, loaded activity detail, verified five stored-file hashes, downloaded two teaching assets and compared their bytes to expected hashes, downloaded the current submission, and verified the evaluation marker in the response.
6. Later browser actions used only this restored copy. Both audit-started servers were closed through the same shutdown handler after checks.

Result: **full synthetic stopped-server restore passed**. Five hashes represent the original smoke submission, second-student submissions including the concurrent successful result, and two teaching assets for the source activity. The duplicated smoke image also traveled with the full data copy, but was not part of the five explicitly hashed source-activity/submission files. No live-WAL copy, owner backup, disk-loss simulation or destination ACL audit was performed.

### Proposed first operator runbook

- Record deployed commit/build, Node version, absolute `ATOM_ROOT`, environment and file permissions. The actual persistent tree is `<ATOM_ROOT>\data`, not the root itself.
- Stop every ATOM process and writer using this data root. Await shutdown. Back up complete `data`, including `atom.sqlite`, any remaining SQLite sidecars, `uploads`, `activity-assets` and any other referenced stored paths. This handles stress assets nested under uploads too.
- SQLite uses WAL. Do not copy just a live main database and assume it includes WAL transactions. The executed drill used quiescent close; a future online backup needs a separately verified SQLite-aware method plus consistent filesystem capture.
- Keep the backup private: it includes credentials, sessions and student evidence. Preserve or deliberately reapply owner-only/authorized-service ACLs. Do not treat the audit's default temporary-directory permissions as an approved deployment policy.
- `tmp` is transient. Preserve it in a diagnostic copy if needed, but never promote its files to received submissions. Inventory orphan files against stored-path references before any cleanup; do not blindly delete uploads.
- Restore into a new empty root first, using the matching code/runtime. Compare database integrity, release/submission/evaluation relationships, file hashes, login, material downloads, submission downloads and evaluation visibility. Record observed results. Only then plan a separate deployment cutover.

This is audit documentation, not an executed change to the README or a backup automation.

## Rendered browser checks

Browser: Codex in-app browser via supported `cua_repl` APIs. The standalone Browser plugin skill was absent and no bundled standalone Playwright package was found at the inspected runtime path; available CUA browser controls supplied DOM/AX, screenshots and console access. No browser dependency was installed. The frontend testing skill informed the validation checklist.

Flow under test: login -> subject -> New activity -> title edit -> autosave -> reload; compare localhost and non-loopback HTTP LAN origin. All accounts/data were synthetic.

| Check | Localhost | Host HTTP LAN address |
|---|---|---|
| Page identity/login/home | Pass | Pass |
| Subject activity stream | Pass | Pass |
| New activity -> editor | Pass | **Fail: blank page** |
| Title autosave -> reload | Pass, “Saved on this device” -> “Saved to ATOM”; title persisted at revision 2 | Not reached |
| Console health | No warn/error entries before expiry manipulation | `TypeError: crypto.randomUUID is not a function` |
| Screenshot | 390 x 844 mobile editor inspected | 1280 x 720 blank page captured |
| Overflow | Mobile `innerWidth=390`, document `scrollWidth=375`, no horizontal overflow | Blank page, not a layout pass |
| Session expiry | Synthetic expiry followed by reload returned login | Not separately tested |

Temporary origins were `http://127.0.0.1:51994` and the host's selected non-loopback IPv4 address on the same port. Exact address is in scratch `browser-context.json`; the application header falsely displayed its hardcoded different address. LAN-origin access was **from the same machine**, not a second phone/laptop or a firewall/physical-network validation. The 390-pixel viewport override was reset after inspection. Screenshots and AX/console observations are visible in the task's browser tool outputs; no screenshot file was written into application source.

The LAN error originates from new activity section ID generation (`ActivityAuthoring.tsx:416–418`). Student selection has a similar unchecked caller at `ActivityDetailPage.tsx:103`, but that interaction was not executed in a student browser session. A successful localhost screenshot does not establish LAN readiness.

## Unperformed or only partially covered

- No application fixes, no full college pilot, no real cohort, no live deployment, no institutional grading-policy certification.
- Frontend files, CSS, editor extensions/dialogs and reference binary contents were not exhaustively line-audited. Full authored inventory was enumerated; no claim of complete line-by-line review of every tracked byte.
- No arbitrary student code execution, archive extraction, malicious document rendering, destructive load, external penetration testing or fuzz campaign.
- No storage quota/IndexedDB denial injection, offline autosave race, multiple in-flight edits, cross-tab recovery conflict, browser back navigation loss, unsaved session-expiry recovery, or stale account/scope response simulation. Recovery risk is static.
- No complete authorization permutation suite: same-lecture faculty assignment variants, explicit collaborators, transfers/inactive enrollments, individual delegations, and every mutation endpoint remain regression acceptance work. No coordinator entity currently exists.
- No abort-mid-upload cleanup drill, disk-full fault, crash-between-rename-and-commit, publication/deadline race, different-key revision-limit race, maximum file-size boundary load, or stale-temp/orphan cleanup execution.
- No partial README-only backup restored; no owner restore, backup encryption/ACL verification, online SQLite backup or live WAL behavior tested.
- No real reverse proxy configuration found in tracked files; proxy reset/session revocation not tested through the synthetic proxy. `ATOM_HTTPS=true` deployment not executed.
- No stress-seed execution: its `process.cwd()` storage behavior ignores `ATOM_ROOT`, discovered statically. No demo-account reset command on owner data.
- No `npm audit`/vulnerability database check; no install lifecycle execution in the isolated npm-ci check. Tests/build used existing dependencies; clean-install build equivalence is unproven.
- No external gitlink source fetched/audited. No DATS repository inspected. Tracked syllabus DOCX/PDF and lecture binary/temp files were inventoried, not parsed; they cannot establish a structured syllabus engine or approved policy values.
- No quiz/exam/TOS/OMR engine exists to run; no printed forms, scanner, actual devices, image recognition or scoring/item-analysis numerical fixtures were verified.

## Harness corrections, not application failures

The first harness invocation failed before startup because Windows absolute ESM imports lacked `file:///`; correcting only the disposable harness fixed it. An exploratory `Get-Content server/src/config.ts` found no such module (runtime configuration is in index.ts). An `rg` shell glob needed `-g '*.test.ts'` on Windows. A final combined inventory command returned a nonzero status for absent AGENTS files; its preceding extra harness exited successfully. These are audit-tooling observations and are not reported as ATOM defects.

Scratch evidence: `audit.mjs`, `server-wrapper.mjs`, `extra.mjs`, `smoke.log`, `results.json`, `extra-results.json`, `browser-context.json`, isolated dependency tree, and source/restored synthetic roots. Main script uses a unique single-run directory and expects a fresh root; do not rerun it against an existing fixture or real data. Reproduction should allocate a new scratch directory and adjust the script constants. The preserved summaries above are the durable record.
