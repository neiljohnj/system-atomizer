# Remaining Phase 0 — implementation and acceptance evidence

2026-09-10. Owner authorization: continue the rest of Phase 0, following ATOM_ROADMAP.md. Base remains e38627084617eed06e9198ebe3e2d5215eadbd41. Phase 0A and the four original audit documents are preserved. No commit, push, deployment or real class-data change was made.

## Delivered changes

- A05: both multipart routes authenticate and check URL-known eligibility before Multer. Faculty uploads recheck edit/draft permission after filesystem awaits. Submission receipt binds the initial authenticated user/release before reading the body and rechecks eligibility before commit.
- A09: synchronous commit-time authorization, duplicate comparison, revision allocation and category limits follow file I/O. Identical eligible same-key retries return 200; mismatching payload/name/claim/release returns 409. No await occurs inside the SQLite transaction. Uncommitted files are cleaned; committed evidence survives response failure. New storage paths use opaque submission IDs; normalized revision filenames remain user-facing and old paths remain readable.
- A08: period/offering changes atomically clear an incompatible inherited topic. Explicit topics must match the destination. Copy and stream projection handle old incompatible references conservatively. A clean period save updates the editor route scope.
- A10: every browser UUID caller uses newIdentifier, with native randomUUID or cryptographic getRandomValues. No Math.random fallback.
- A11: recovery writes/deletes serialize and await transaction completion; aborts/errors reject and database handles close. UI distinguishes tab-only, device-committed, server-saved and conflict states. A synchronous account/activity-scoped tab cache survives route/session unmounts without claiming durability. Server saves serialize; stale context responses cannot replace a new editor. Session expiry preserves the editor return route. Unchanged initialization no longer changes the save badge.
- A12: server and both seeds share storage-root semantics. Stress seed requires explicit ATOM_ROOT and --development-fixture; assets resolve from the installation. Both source and compiled variants were verified from another working directory.
- A04/A06: [operations procedure](../OPERATIONS.md) covers normal/demo startup, roots, complete backups, SQLite sidecars, manifests, new-root restore, direct LAN HTTP and host-only maintenance. ATOM_BEHIND_PROXY=true denies web maintenance regardless of loopback/forwarding headers. ATOM_HOST supports loopback binding. README reflects these requirements.

## Exact verification

| Requirement | Evidence and result |
|---|---|
| Pre-receipt auth | Original anonymous partial-body cases timed out before the fix. Six current cases (anonymous, wrong role, outside faculty, invalid session) immediately deny 401/403 with unchanged files. |
| Upload failures | Authorized aborted receipt cleans its temporary file. Activity-size excess returns 413. Injected rename EACCES returns 500 without academic mutation or retained failed file. Existing current evidence survives. |
| Retry concurrency | Identical/different same-key races reproduced 500; now 200/409 after one 201 commit. Distinct keys get distinct revisions; racing at the last Python slot leaves exactly 10 rows. One-current and file counts pass. |
| Changed upload state | Unpublish, republish, placement revocation, deadline expiry and removed session after receipt deny before commit. Republish while multipart bytes are arriving reproduced incorrect 201; initial-release binding now returns 409 with existing evidence preserved. |
| Topic/period | Both direction HTTP stream tests pass with an inherited topic. Mobile period change reaches the Final Term editor URL retaining title and parts. |
| LAN browser | At http://192.101.3.183:52786: faculty sign-in, new activity, title, section, progressive structure and third part succeed. Student sign-in, native file selection and upload produce current revision 2, retaining revision 1. Captured LAN faculty/student warning/error logs empty. This is host-browser access through the actual LAN IP, not a physical second client. |
| Localhost browser | At http://127.0.0.1:52786: student signs in, selects the synthetic Python file and receives revision 1. Faculty creation/recovery use test proxy http://127.0.0.1:52799. |
| Mobile | Requested 390x844 viewport; content width 375 and scroll width 375. Screenshots show wrapped toolbar, usable title/parts, Add section/Add part and Delivery sheet without horizontal overflow. Title and period changes save. |
| Recovery faults | Test-only proxy disables IndexedDB and returns PATCH 503/401. Immediate Back/Edit retains latest unsaved title. Expiry/sign-in retains it; student sees no faculty draft; switching back restores the latest faculty text. Corrected expiry returns directly to editor. Restored PATCH delivery reaches Saved to ATOM; full reload retains saved title. Unit tests verify account keys, latest-memory retention, serialized writes/clear, aborted transactions and no early durability claim. |
| Proxy boundary | Real HTTP proxy strips forwarding headers and connects over loopback to proxy-mode backend: setup mutation, faculty recovery listing/reset return 403; health 200. Direct local recovery control verifies revoked sessions, forced password change and one audit event; nonloopback reset denied. |
| Storage roots | Source launcher from temporary cwd A with root B: missing flag creates no data; authorized seed writes only B with shipped assets. Same two tests pass with ATOM_TEST_COMPILED=true against compiled seed. |
| Full restore | Compiled-server restore-drill.mjs runs unchanged synthetic smoke; stops before copying all six files; exact path/size/SHA-256 manifests match. Integrity/FKs, academic relationships, credentials, referenced hashes and one-current checks pass. Restored faculty/student login, published activity, both actors' asset/submission downloads and evaluation score/deduction pass. Source manifest unchanged. |
| Final checks | npm.cmd test: 15 files / 90 tests pass, including 54 HTTP authority/lifecycle cases. npm.cmd run build passes after runtime changes, with existing Vite chunk-size warning. Focused direct recovery and compiled-root tests pass. git diff --check passes with Windows line-ending notices. |

The required independent read-only investigation and single candidate review ran. Review found initial-release binding and memory-only route/session loss; both were fixed and verified above. Browser QA additionally exposed unchanged-initialization status and expiry return-route races, corrected and rechecked. No second security review cycle ran.

## Completion boundary

Roadmap tasks 2 and 3 are delivered for the bounded synthetic workflow. Phase 0A's accepted historical-access exception remains: a shared A+B release followed by an A-to-B transfer cannot identify original placement from current records. A01 remains partially addressed overall. The owner was asked whether new instructors inherit prior evidence; no policy answer was received. No historical memberships or delegation were fabricated. Do not claim transfer-sensitive multi-faculty readiness.

A07 totals remain provisional; criterion policy, immutable corrections and authoritative gradebook use remain Phase 3. New-course administration remains Phase 1. No TLS termination, physical second-client/firewall test, real-data migration, institutional backup, ACL/retention audit, clean-install build, arbitrary crash/power-loss reconciliation or student-code execution is claimed. Browser storage can be evicted; tab-only recovery cannot survive closing/reloading before persistence.

Fixture listeners/processes were confirmed absent after browser verification. The earlier Phase 0A residual directory was not touched after automatic approval review rejected its cleanup; that rejection remains in the Phase 0A report.
