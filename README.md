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
- Drafts save to IndexedDB immediately and synchronize to ATOM after two idle seconds, with explicit conflict recovery instead of silent overwrites.
- Local faculty usernames and student-number accounts use hashed passwords, expiring server sessions, forced first-login password changes, and audited recovery/reset actions.
- The account menu provides Change password, Switch account, and Sign out without putting identity selection in the normal header.
- Students see a published activity once even when it applies through more than one of their group placements.
- Students submit one `.py` source file or `.zip` project at a time to protected local storage.
- An upload becomes the current submission only after it is completely received, hashed, moved, and recorded in SQLite.
- Repeating an interrupted request with the same idempotency key does not create a duplicate submission.
- Faculty can download current submissions and record a total score, manual deduction, comment, and annotations.
- Quiz and exam routes clearly state that their authoring and delivery engines are not enabled in this MVP.

## Run it

Requirements: Node.js 22 or newer. No PostgreSQL, Docker, Rust, or Tauri installation is needed for this MVP.

```powershell
npm.cmd install
npm.cmd run dev:build
```

Open [http://127.0.0.1:4174](http://127.0.0.1:4174). `npm.cmd run dev:build` builds once and then serves the frontend and API from this one address. Later launches use `npm.cmd run dev` without rebuilding. Neither command keeps a second Vite server or frontend watcher running.

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

The frontend and API normally share the same origin. If a future local reverse proxy strips standard browser fetch metadata, set `ATOM_ALLOWED_ORIGINS` to its exact comma-separated frontend origins; do not use wildcards.

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
npm.cmd run stress:seed
```

The seed is idempotent and preserves existing fixtures. `npm.cmd run stress:seed -- --refresh` refreshes only untouched draft fixtures (revision 1 with no release or submissions); it refuses to overwrite edited or published work.

## Local data and migrations

On first launch, ATOM creates:

```text
data/
  atom.sqlite
  uploads/
  tmp/
```

`data/` is intentionally ignored by Git. SQLite schema changes are transactional and recorded in `schema_migrations`. The migrations preserve existing activity, release, submission, evaluation, and stored-file relationships while adding academic structure, hashed account credentials, revocable sessions, authentication audit events, versioned activity documents, protected assets, collaborators, and immutable release scopes.

Set `ATOM_ROOT` to place the database and protected files somewhere else. Back up the database and `uploads` directory together while the server is stopped.

The sample data contains Faculty Demo, Student Demo, Second Student, the ITCC47 offering, Lecture 2A, Laboratory 2A, Laboratory 2Ax, and one published Midterm laboratory activity assigned to both laboratory groups. The optional stress seed adds six clearly named drafts under the Midterm and Final Term **Authoring stress tests** topics.

## Deliberately deferred

This is a workflow-validation MVP, not a live high-stakes deployment. It currently has no enrollment importer, TLS termination, external backup integration, Tauri wrapper, PostgreSQL adapter, quiz engine, exam engine, reusable template library, document import/export, plagiarism analysis, criterion-scoring workflow, real-time coediting, or evaluator sandbox.

Identity preview is an explicit development configuration (`ATOM_DEVELOPMENT_PREVIEW=true`) and is rendered in a separate warning bar. Normal account changes use authenticated Switch account and Sign out actions; keep development preview disabled on a real LAN installation.

## Visual reference

- [Faculty activity workspace](docs/design/faculty-activities-concept.png)
- [Student submission workspace](docs/design/student-submission-concept.png)

The generated concepts are design references; the working interface uses real stored data and truthful empty states.
