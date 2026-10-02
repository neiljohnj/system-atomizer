# ATOM local MVP

ATOM is a LAN-first academic workspace. Phase 1 adds real-course setup for a bounded fixed-roster pilot, connected to the existing activity/submission workflow. Evaluation remains provisional; quizzes and exams remain unavailable.

## What works now

- A fresh normal installation starts empty. A host-local operator creates an installation owner, then uses **Set up course** to create/select a reusable course and term, configure distinct instructors and linked lecture/laboratory groups, and review an initial roster.
- Manual entry and a bounded 200-row paste table support explicit placements, leading-zero student numbers, read-only preview, and transactional Apply. Credential hand-off is separate, random, single-use, and valid for 48 hours.
- Owner, offering setup manager, and instructor are separate capabilities. Setup access does not grant submission download or evaluation rights.
- First publication permanently freezes the offering's instructional assignments, groups, enrollments, and placements. Unpublishing does not unlock it. Late enrollment and transfers are unavailable in this pilot.
- A subject home groups authorized offerings by academic term.
- Faculty assignments and student placements are scoped to lecture, laboratory, or combined teaching groups.
- Activity lists are filtered by subject offering, concrete teaching group (or an explicit combined view), and Midterm/Final Term.
- Faculty can create one activity for multiple teaching groups and publish an immutable release scope.
- Faculty author versioned rich activity documents with sections, tables, highlighted code, mathematics, images, and protected teaching attachments.
- Activities may be simple or progressive. Progressive activities contain ordered, independently editable parts with sequential or independent submission claims.
- Structured submission manifests support exact or templated filenames, individual/ZIP delivery, and descriptive, warning, or strict preflight validation without executing student code.
- Optional overall or per-part rubrics are included in immutable releases; point mismatches require explicit publication acknowledgement.
- Drafts attempt device recovery and synchronize to ATOM after two idle seconds. The editor distinguishes completed device writes, tab-only recovery, server saves, and revision conflicts.
- Local faculty usernames and student-number accounts use hashed passwords, expiring server sessions, forced first-login password changes, and audited recovery/reset actions.
- The account menu provides Change password, Switch account, and Sign out without putting identity selection in the normal header.
- Students see a published activity once even when it applies through more than one of their group placements.
- Students submit one `.py` source file or `.zip` project at a time to protected local storage.
- An upload becomes the current submission only after it is completely received, hashed, moved, and recorded in SQLite.
- Eligible identical retries with the same idempotency key return existing evidence; changed payloads return a conflict.
- Assigned faculty can download scoped submissions and record provisional totals, deductions, comments, and annotations. These are not authoritative grades; criterion policy and immutable correction history remain deferred.
- Quiz and exam routes clearly state that their authoring and delivery engines are not enabled in this MVP.

## Run it

Requirements: Node.js 22 or newer. No PostgreSQL, Docker, Rust, or Tauri installation is needed for this MVP.

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run build
```

Select a storage root before starting, using the disposable example below for review. The server serves the built frontend and API from one address. Later launches with the same intended root use `npm.cmd start`; rebuild after source changes. Read the [operations and recovery procedure](docs/OPERATIONS.md) before shared use.

To try this candidate using a new disposable root on the host:

```powershell
$env:ATOM_ROOT = Join-Path $env:TEMP ('atom-phase1-try-' + [guid]::NewGuid())
$env:ATOM_HOST = '127.0.0.1'
$env:ATOM_BEHIND_PROXY = 'false'
$env:ATOM_HTTPS = 'false'
$env:ATOM_DEVELOPMENT_PREVIEW = 'false'
npm.cmd start
```

Open [http://127.0.0.1:4174/setup](http://127.0.0.1:4174/setup). Create the new owner with a local username and a 10–128 character password. On **Your subjects**, choose **Set up course**, then follow **Course & term → Teaching groups → Students → Review**. Mark the reviewed offering ready, then sign in as an assigned instructor to author activities. Activation can happen after readiness. Stop this disposable server with Ctrl+C when finished.

Existing installations retain IDs, credentials, releases, submissions, manual totals, and file paths. They receive no automatic owner grant. An authenticated faculty operator must deliberately confirm that exact account at host-local `/local-owner` once. If old credentials have never been initialized, `/setup` requires explicit selection of the existing faculty identity first. Legacy offerings remain visibly legacy and setup-read-only pending review; no course identities or historical placements are guessed. See the [upgrade and owner procedure](docs/OPERATIONS.md) before selecting an existing data root.

Normal startup creates no sample academic data and resets no credentials. For an explicitly disposable **sample** root, development launches seed the sample fixture and prepare its three demo accounts. To reset only those sample accounts without starting ATOM, run:

```powershell
npm.cmd run demo:accounts
```

The development launch and maintenance command reset only Faculty Demo, Student Demo, and Second Student, revoke their existing sessions, and disable their forced password change. They refuse to replace a managed account's secure activation with demo credentials. Never use these commands against class data. `npm.cmd start -- --sample-data` explicitly initializes academic sample fixtures on a fresh root without the demo credential reset; permanent legacy tests use that flag. An already initialized empty root is not converted into a sample installation by migration.

For normal accounts, issue activation through a private hand-off after verifying the recipient in person or through an established trusted process. Never use the student number as a password. First sign-in consumes the temporary credential and requires a new password. Reissue invalidates earlier activation and current sessions; lost secrets cannot be recovered. No bulk password export is provided.

Until HTTPS is configured, ATOM displays a warning because LAN traffic and cookies are not encrypted. Set `ATOM_HTTPS=true` only when the site is genuinely served over HTTPS; doing so marks the session cookie `Secure`.

The frontend and API normally share the same origin. A supported proxy deployment requires backend `ATOM_BEHIND_PROXY=true`, `ATOM_HOST=127.0.0.1`, and the maintenance exclusions in the [operations procedure](docs/OPERATIONS.md). Never proxy direct mode. `ATOM_ALLOWED_ORIGINS`, when needed, accepts exact trusted origins; it does not secure maintenance routes.

If the global npm cache is restricted, use the workspace-local cache:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund --cache .npm-cache
```

## Verify it

```powershell
npm.cmd test
npm.cmd run build
```

The self-contained smoke owns its disposable root and server:

```powershell
node server/test-fixtures/run-smoke.mjs
```

It covers `setup -> faculty login -> author -> attach material -> multi-group publish -> student forced password change -> student visibility -> upload submission -> switch account -> faculty evaluation`.

To add the six guarded authoring stress-test drafts to the sample ITCC47 offering:

```powershell
npm.cmd run build
$env:ATOM_ROOT = 'C:\ATOM-disposable-fixture'
npm.cmd run stress:seed -- --development-fixture
```

Use an explicitly disposable root. The seed requires both `ATOM_ROOT` and `--development-fixture`. Add `--refresh` to refresh only untouched draft fixtures (revision 1 with no release or submissions); it refuses to overwrite edited or published work. Source and compiled seeds resolve shipped assets from their installation.

Run `node server/test-fixtures/restore-drill.mjs` after building for both the original synthetic smoke/restore and the new API-created course with distinct instructors, students, activation states, protected materials, submissions, and provisional evaluations. [Current test evidence](docs/phase-1/TEST_EVIDENCE.md) includes rendered browser verification and its limits.

## Local data and migrations

On first launch, ATOM creates:

```text
data/
  atom.sqlite
  activity-assets/
  uploads/
  tmp/
```

`data/` is intentionally ignored by Git. SQLite schema changes are transactional and recorded in `schema_migrations`. The migrations preserve existing activity, release, submission, evaluation, and stored-file relationships while adding academic structure, hashed account credentials, revocable sessions, authentication audit events, versioned activity documents, protected assets, collaborators, and immutable release scopes.

Set `ATOM_ROOT` to the application storage root: the database is `<ATOM_ROOT>/data/atom.sqlite`. Relative roots resolve from the command's working directory. Back up the **entire stopped-server `data` tree**, including teaching assets and any remaining SQLite sidecars. Follow the [manifest and new-root restore checks](docs/OPERATIONS.md); database plus uploads alone is incomplete.

Explicit sample data contains Faculty Demo, Student Demo, Second Student, the ITCC47 offering, Lecture 2A, Laboratory 2A, Laboratory 2Ax, and one published Midterm laboratory activity assigned to both laboratory groups. The optional stress seed adds six clearly named drafts under the Midterm and Final Term **Authoring stress tests** topics. These records are not used to create a normal new course.

## Deliberately deferred

This is a workflow-validation MVP, not a live high-stakes deployment. It has no general Excel/CSV importer, late-enrollment/transfer workflow, syllabus engine, authoritative gradebook, TLS termination, external backup integration, Tauri wrapper, PostgreSQL adapter, quiz engine, exam engine, reusable template library, document import/export, plagiarism analysis, criterion-scoring workflow, real-time coediting, or evaluator sandbox. A01's legacy historical-transfer limitation remains unresolved; the fixed-roster lock prevents new supported administration from creating that transfer but does not reconstruct old membership history. A07 totals/deductions remain manual provisional evidence.

Phase 1 design, API/permission contracts, and limits: [implementation](docs/phase-1/IMPLEMENTATION.md), [test evidence](docs/phase-1/TEST_EVIDENCE.md), [UI review](docs/phase-1/UI_REVIEW.md).

Identity preview is an explicit development configuration (`ATOM_DEVELOPMENT_PREVIEW=true`) and is rendered in a separate warning bar. Normal account changes use authenticated Switch account and Sign out actions; keep development preview disabled on a real LAN installation.

## Visual reference

- [Faculty activity workspace](docs/design/faculty-activities-concept.png)
- [Student submission workspace](docs/design/student-submission-concept.png)

The generated concepts are design references; the working interface uses real stored data and truthful empty states.
