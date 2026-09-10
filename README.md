# ATOM local MVP

ATOM is a LAN-first academic workspace. The current runnable slice proves a subject-scoped laboratory workflow while reserving honest navigation for quizzes and exams.

## What works now

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
npm.cmd install
npm.cmd run build
npm.cmd start
```

Open [http://127.0.0.1:4174](http://127.0.0.1:4174). The server serves the built frontend and API from one address. Later launches use `npm.cmd start`; rebuild after source changes. Read the [operations and recovery procedure](docs/OPERATIONS.md) before shared use.

For a production-style local build without the development identity switcher:

```powershell
npm.cmd run build
npm.cmd start
```

Open [http://127.0.0.1:4174](http://127.0.0.1:4174). The server listens on all local interfaces, so the same build can later be reached through the work computer's LAN address after Windows Firewall is configured.

The first production-style launch redirects to `/setup`. This loopback-only, one-time step claims the existing Faculty Demo identity while preserving its authored records. Choose the faculty display name, local username, and a 10-128 character password. Imported/sample students initially sign in with their student number as both identifier and temporary password, then must choose a new password before entering a subject.

Development launches automatically prepare the three sample identities with copy-friendly demo credentials in the exact database being served. To reset them without starting ATOM, run:

```powershell
npm.cmd run demo:accounts
```

The development launch and maintenance command reset only Faculty Demo, Student Demo, and Second Student, revoke their existing sessions, and disable their forced password change. Use `npm.cmd start` instead of `npm.cmd run dev` for a real class deployment.

Until HTTPS is configured, ATOM displays a warning because LAN traffic and cookies are not encrypted. Set `ATOM_HTTPS=true` only when the site is genuinely served over HTTPS; doing so marks the session cookie `Secure`.

The frontend and API normally share the same origin. A supported proxy deployment requires backend `ATOM_BEHIND_PROXY=true`, `ATOM_HOST=127.0.0.1`, and the maintenance exclusions in the [operations procedure](docs/OPERATIONS.md). Never proxy direct mode. `ATOM_ALLOWED_ORIGINS`, when needed, accepts exact trusted origins; it does not secure maintenance routes.

If the global npm cache is restricted, use the workspace-local cache:

```powershell
npm.cmd install --cache .npm-cache
```

## Verify it

```powershell
npm.cmd test
npm.cmd run build
```

The end-to-end smoke script expects a running server. Automation should start that server with a disposable `ATOM_ROOT`, then run:

```powershell
npm.cmd run smoke
```

It covers `setup -> faculty login -> author -> attach material -> multi-group publish -> student forced password change -> student visibility -> upload submission -> switch account -> faculty evaluation`.

To add the six guarded authoring stress-test drafts to the sample ITCC47 offering:

```powershell
npm.cmd run build
$env:ATOM_ROOT = 'C:\ATOM-disposable-fixture'
npm.cmd run stress:seed -- --development-fixture
```

Use an explicitly disposable root. The seed requires both `ATOM_ROOT` and `--development-fixture`. Add `--refresh` to refresh only untouched draft fixtures (revision 1 with no release or submissions); it refuses to overwrite edited or published work. Source and compiled seeds resolve shipped assets from their installation.

Run `node server/test-fixtures/restore-drill.mjs` after building for a self-contained synthetic smoke and complete stopped-server restore verification.

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

The sample data contains Faculty Demo, Student Demo, Second Student, the ITCC47 offering, Lecture 2A, Laboratory 2A, Laboratory 2Ax, and one published Midterm laboratory activity assigned to both laboratory groups. The optional stress seed adds six clearly named drafts under the Midterm and Final Term **Authoring stress tests** topics.

## Deliberately deferred

This is a workflow-validation MVP, not a live high-stakes deployment. It currently has no enrollment importer, TLS termination, external backup integration, Tauri wrapper, PostgreSQL adapter, quiz engine, exam engine, reusable template library, document import/export, plagiarism analysis, criterion-scoring workflow, real-time coediting, or evaluator sandbox.

Identity preview is an explicit development configuration (`ATOM_DEVELOPMENT_PREVIEW=true`) and is rendered in a separate warning bar. Normal account changes use authenticated Switch account and Sign out actions; keep development preview disabled on a real LAN installation.

## Visual reference

- [Faculty activity workspace](docs/design/faculty-activities-concept.png)
- [Student submission workspace](docs/design/student-submission-concept.png)

The generated concepts are design references; the working interface uses real stored data and truthful empty states.
