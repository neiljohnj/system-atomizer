# Phase 1 implementation — fixed-roster course setup

> Publication follow-up, 2026-10-02: after this implementation/verification snapshot, the owner authorized committing and pushing all Phase 1 changes without rerunning tests. References below to uncommitted work or no push describe the original bounded turn. No deployment or real-data upgrade was authorized or performed.

Date: 2026-10-02. Candidate branch: `phase-1`; base/HEAD: `1df70751504a56ab961f787923c7b20ea61d65f6`. This implementation is uncommitted local work. No commit, push, merge, PR, deployment or real-data migration was performed.

An authorized operator can now configure a genuinely new course/term offering, provision distinct instructors, save lecture/laboratory/combined groups and explicit links, enroll/place new students through manual or pasted rows, issue private activation, mark the offering ready, and use existing activity publication/submission/provisional evaluation. First publication freezes instructional configuration permanently for this pilot.

## Repository and implementation boundary

The target directory was empty on inspection. The user explicitly authorized cloning `phase-1` there. The existing remote branch was cloned without submodules, then fetched without pull/reset/clean. Local HEAD, `origin/phase-1` and `origin/master` matched the reviewed baseline. A final read-only remote check still found both remote branches at that SHA. There was no pre-existing checkout or local work to overwrite. `doc-automator` remains an uninitialized gitlink. Historical `docs/audit` evidence is unchanged.

The existing React/TypeScript/Express/SQLite stack, theme, immutable releases, instructor authority and evidence storage remain in place. No dependency manifest or lockfile change was needed. New academic logic lives in dedicated services/routes, with small integration points in the existing server and app shell.

## Model and migration

Migration 7 (`fixed_roster_academic_setup`) is additive and transactional:

| Entity/change | Contract |
|---|---|
| `courses` | Reusable course identity, case-insensitive unique code and title. No faculty ownership or invented department/campus scope. |
| Offering catalog/state columns | Nullable catalog FK, display label, legacy/draft/ready state, explicit required components, revision, quarantine issue and permanent lock timestamp. New offerings are unique per course/term; an existing legacy code in that term also prevents silent duplication. |
| Internal compatibility subject | Each new offering gets a fresh `subjects` row to satisfy `activities.subject_id` and the existing bridge. No demo IDs are reused. |
| `installation_owners` | Explicit owner identity. Fresh `/setup` creates one; upgrades create none automatically. |
| `offering_setup_managers` | Per-offering grants by the owner, independent of instructor assignments. |
| Existing teaching groups/assignments | Lecture, laboratory or combined, with multiple faculty allowed. Every group needs at least one instructor before ready. `all` is a view, never a stored group. |
| `group_associations` | Optional explicit many-to-many lecture/lab links within one offering; links confer no placement or evidence rights. |
| Existing enrollments/placements | Unique enrollment/placement pairs. INSERT/UPDATE triggers enforce same-offering placement, eligible link endpoints and dependent identity updates as well as API checks. |
| `managed_accounts` | Not-issued, unclaimed, claimed/forced-change, expired or activated state; credential version. Secrets remain hashed in existing credentials. |
| `roster_batches` | Actor/offering/request-key receipt with request digest and IDs only; no credential material. |

Normal initialization is now empty. Explicit sample initialization is supported only before foundation migration; tests and sample maintenance commands opt in. Existing migrated roots are never silently reseeded. Legacy migration preserves IDs, credential hashes, releases, submissions, evaluations and file paths. No catalog matches or placement history are inferred from names/codes; catalog links remain null and setup state is legacy. Old manual totals remain manual evidence.

Publication history conservatively sets the lock even if the current activity is unpublished. Unsafe legacy cross-offering placements or FK violations are retained and flagged, not repaired or deleted; setup stays read-only. SQLite integrity is checked before migration completion. Repeat migration is a no-op. An older application is not a schema rollback: use a verified complete pre-upgrade data copy with its matching build. This task migrated only disposable fixtures.

## Capability matrix

| Action | Owner | Offering setup manager | Assigned instructor only | Student/unprivileged faculty |
|---|---|---|---|---|
| Create course/term/offering or faculty identity | Yes | No | No | No |
| Read setup roster/readiness | All offerings | Granted offering only | No | No |
| Configure groups/instructors, roster, placements, readiness | Before lock on new offerings | Before lock on granted new offering | No | No |
| Grant/revoke offering setup managers | Before lock | No | No | No |
| Safe offering display-label edit | Yes | Granted offering | No | No |
| Private activation/reissue | Any account | Student enrolled in granted offering | Existing protected Student Access for assigned groups | No |
| Revoke another account's sessions via setup API | Yes | No | No | No |
| Author/publish/download/evaluate | Only with separate instructional rights | Only with separate instructional rights | Existing actor-aware activity/group authority | Student's own published scope and own evidence only |

The host-local existing-installation grant requires an authenticated faculty account and typed exact identity, and succeeds only while no owner exists. Proxy mode blocks it, just like setup and local recovery. Routine academic setup uses authenticated UI/API, not host maintenance or SQL. A manager-only account gets an operational Activities handoff, without fetching an instructor stream or evidence.

## Fixed-roster invariant and transactions

`AFTER INSERT ON activity_releases` sets `configuration_locked_at` within publication's existing transaction; a second trigger prevents clearing/changing that timestamp. Publication checks new-offering readiness inside that transaction. Supported setup writes use `BEGIN IMMEDIATE`, resolve the current session/capability there, then recheck lock, legacy quarantine, revision where applicable, identities and placements before mutation. Competing publication/setup operations serialize; a setup change returns readiness to draft.

After publication, structure replacement, membership add/remove/reassign, enrollment/deactivation/reactivation, roster preview/apply and manager-grant changes reject deterministically. Unpublish and draft retargeting never unlock. Descriptive label edits and security recovery remain allowed. Replaying an already committed identical batch may return its saved receipt after locking; it performs no new academic write. No supported transfer, successor-instructor or clone-membership bypass was added. Direct external SQLite modification is outside this boundary.

This limits new supported administration; it does not close A01 retrospectively. The original shared A+B release/current-placement transfer probe remains an explicit unresolved-condition test. No historical membership or inheritance policy was invented.

## Roster and activation contracts

Manual entry and three-column TSV paste are capped at 200 rows per batch. Student numbers are trimmed, uppercased strings, preserving zeros; only ASCII letters/digits, dots, underscores and dashes are accepted. Names must match saved identities exactly for explicit reuse. Duplicate/conflicting identities, unknown groups and missing required components remain row errors. Required components are selected for the offering; a combined group fulfills combined only. UI links never auto-enroll students. Structure is bounded to 50 groups and 250 explicit associations per save.

Preview reads academic data only and hashes the actor, offering, revision and resolved plan. Apply resolves everything again under the write transaction. Same key/identical payload returns the receipt; changed payload or a stale plan conflicts. A mid-batch database failure rolls back all new identities, enrollments, placements and the receipt. No activation is issued by Apply, eliminating repeated credential issuance on batch retry.

Provisioning reserves faculty usernames with inaccessible random hashes and leaves student accounts not issued. A separate authorized hand-off creates a 24-random-byte activation credential, stores a salted scrypt hash, expires in **48 hours**, and revokes current sessions. The first successful claim consumes it; even concurrent claims permit only one. Normal access requires a password change in that session. Expiry applies while change is pending; losing that session requires reissue. Reissue invalidates older activation. Existing student reset and local faculty recovery follow this contract; demo resets reject managed accounts. Existing credentials remain unchanged until authorized reset.

Hand-offs show the secret only in a private transient dialog, masked by default, with explicit recipient-verification guidance, expiry and discard behavior. Secrets are not recoverable, put in URL parameters, roster tables, local/session storage or bulk downloads. Setup endpoints use `no-store`. Audit records contain IDs/action metadata, not pasted roster names or activation secrets.

## Endpoints

All academic endpoints are under `/api/academic-setup`; session and capability checks are enforced on the server. Writes accept JSON objects. Existing same-origin mutation checks still apply.

| Method/path | Purpose |
|---|---|
| `GET /` | Authorized catalog, faculty choices and managed offering summaries |
| `GET /offerings/:id` | Scoped saved configuration, roster activation states and readiness issues |
| `POST /courses`, `POST /terms`, `POST /offerings` | Owner creation with duplicate validation |
| `PATCH /offerings/:id/description` | Revision-checked label only; rejects unrelated fields |
| `PUT /offerings/:id/structure` | Explicit groups, instructors, associations and required components |
| `POST /offerings/:id/managers` | Owner grants or revokes bounded setup authority |
| `POST /faculty` | Owner provisions an unclaimed faculty identity/username |
| `POST /accounts/:userId/activation` | Private activation/reissue; manager must supply its authorized offering |
| `POST /accounts/:userId/revoke-sessions` | Owner security revocation |
| `POST /offerings/:id/roster/preview` | Read-only resolved row plan |
| `POST /offerings/:id/roster/apply` | Revalidated transactional apply and receipt |
| `PUT /offerings/:id/enrollments/:enrollmentId` | Explicit pre-lock placements/status edit |
| `POST /offerings/:id/ready` | Validate saved readiness and mark ready |

Host-only `POST /api/local-recovery/owner` is the one-time existing-owner grant. Fresh `POST /api/setup`, login/password-change, bootstrap and existing protected student reset were integrated rather than duplicated. Ordinary list/detail responses never return credential hashes or temporary secrets.

## Files and integration

| Files | Change |
|---|---|
| `server/src/academic-migration.ts`, `account-activation.ts`, `academic-setup.ts`, `academic-routes.ts` | Additive schema/invariants, credential lifecycle, setup service and scoped HTTP routes |
| `server/src/db.ts`, `auth.ts`, `index.ts` | Empty normal initialization, explicit bootstrap, atomic activation, bootstrap capabilities, publication readiness/lock integration and truthful account states |
| `server/src/demo-accounts.ts`, `seed-demo-accounts.ts`, `seed-authoring-stress.ts` | Explicit synthetic seeding and managed-account reset guard |
| `src/features/setup/` | Typed API, four-stage course workspace, teaching groups/map, manual/paste roster workbench, protected handoff and legacy-owner grant |
| `src/App.tsx`, `api.ts`, `types.ts` | Lazy setup route, account-epoch stale-response guard, API/types |
| `src/features/subjects/SubjectHome.tsx`, `SubjectWorkspace.tsx` | Permission-aware entry, scoped return route, manager-only handoff, account/offering remount isolation |
| `src/features/auth/AuthPages.tsx`, `src/features/faculty/StudentAccess.tsx` | Fresh/exact-legacy setup and secure reset hand-off with truthful activation states |
| `src/features/authoring/ActivityAuthoring.tsx`, `src/features/subjects/AssessmentStream.tsx` | Fixed-roster warning in both publication confirmation paths |
| `src/styles.css` | Existing-theme setup layout, responsive stacked map/forms, focus/touch targets |
| `server/src/academic-setup.test.ts`, `academic-migration.test.ts`, `demo-accounts.test.ts` | 39 added regression cases; other legacy fixtures opt into samples without weakening their guard assertions |
| `server/test-fixtures/phase1-fixture.mjs`, `phase1-restore.mjs`, `browser-phase1.mjs` | Supported-API class creation, two-lab end-to-end flow, stopped-tree restore and rendered acceptance |
| Existing smoke/restore/browser Phase 0 fixtures | Explicit sample flag/exact legacy setup identity; restore adds Phase 1 corpus |
| README, OPERATIONS, PROJECT_STATE and `docs/phase-1/` | Current setup/operation contracts and newly executed evidence; audit history untouched |

## Limits at the acceptance boundary

No late enrollment, transfers, replacement teaching memberships after publication, general Excel/CSV import, roster persistence across lost tabs, catalog reconciliation of legacy records, multi-owner administration UI, institutional readiness approval, syllabus/CLO work, authoritative grading, exams/TOS, scanning/OMR or code execution sandbox was added. Ready does not mean students have activated or grades are final. A07 remains open.

Host-browser LAN-origin functional checks passed; a physical second client, firewall, TLS and real institutional backup/upgrade were not tested. Screenshot inspection also found an existing narrow-screen activity-document/submission overlap and the existing static connection-address label; these are reported in [UI_REVIEW.md](UI_REVIEW.md), not expanded into an editor redesign. The existing large Vite authoring-chunk warning remains. See [TEST_EVIDENCE.md](TEST_EVIDENCE.md) for exact results.
