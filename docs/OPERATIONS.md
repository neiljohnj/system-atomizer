# ATOM operations and recovery — Phase 1 fixed-roster pilot

This procedure covers real-course setup and the existing activity workflow within a fixed-roster pilot. Keep evaluation provisional: recorded totals/deductions have no approved criterion-scoring policy or immutable correction history (A07). Do not use them as an authoritative gradebook. The candidate has been verified on disposable data only; no owner's database was upgraded or deployment performed.

## Storage and startup

Use Node.js 22+ and run the installed project's scripts from the repository directory. Build with `npm.cmd run build`. The normal server command is `npm.cmd start`; it does not reset account credentials. `dev`, `dev:build` and `demo:accounts` reset sample credentials and revoke their sessions. Never use those commands against a class-data root.

Normal fresh startup creates an empty installation, not the sample course. Sample academic seeding requires a fresh disposable root and explicit `--sample-data` (or the existing demo development command). Sample fixture tests now opt in; running normal initialization first does not later seed samples into that same migrated root. Managed accounts are excluded from predictable demo resets.

`ATOM_ROOT` is an **application storage root**; the database is `<ATOM_ROOT>/data/atom.sqlite`. An absolute root is recommended. Relative values resolve from the command's current working directory. An unset value uses that working directory. Server and both maintenance seeds share these semantics. Confirm the `ATOM data:` startup line before proceeding. Changing `ATOM_ROOT` does not move existing data automatically.

For an isolated development corpus, set an explicitly disposable absolute `ATOM_ROOT` and run `npm.cmd run stress:seed -- --development-fixture`. `--refresh` still preserves edited/published/submitted activities. Fixture source files resolve from the installation, not from the storage root. These flags acknowledge development seeding; they do not identify real data automatically.

## Supported transport and maintenance boundary

Direct LAN HTTP is supported for the bounded workflow when tested in a current browser. It is not encrypted. Use only a trusted, access-controlled classroom network; do not expose the listener to the Internet or untrusted networks. Set `ATOM_HOST` to the host's intended interface, or `0.0.0.0` for all interfaces, and `PORT` as required (default 4174). Restrict Windows Firewall to the intended network. Firewall/ACL changes are administrator work, not performed by the verification harness.

`ATOM_HTTPS=true` marks cookies Secure and changes metadata; it **does not terminate TLS**. No TLS certificate or HTTPS deployment was configured by this work. Do not enable that flag for plain HTTP.

If placing ATOM behind a proxy, set **`ATOM_BEHIND_PROXY=true` on the backend**, bind the backend to `127.0.0.1` with `ATOM_HOST`, and keep it unreachable from external clients. This mode rejects faculty listing/reset, initial setup, and the one-time owner grant even when the upstream connection is loopback and strips every forwarding header. The proxy must additionally exclude `/setup`, `/local-owner`, `/local-recovery`, `/api/setup`, and `/api/local-recovery` (including descendant paths and equivalent casing). The application API guard is the security boundary; hiding navigation is insufficient.

Do not forward a server in direct mode through a proxy. The backend cannot distinguish an undisclosed transparent local proxy from a local browser. `Host`, `Origin` and `X-Forwarded-*` alone do not establish a trustworthy local-maintenance caller. Set `ATOM_ALLOWED_ORIGINS` only to exact trusted public origins when needed; do not use broad origin allowances to compensate for an incorrect proxy setup.

For deliberate setup or faculty recovery:

1. Stop the public proxy/listener and confirm it cannot forward to the maintenance backend. Stop ATOM cleanly with Ctrl+C and wait for its exit.
2. In a host-local terminal, select the **same verified absolute** `ATOM_ROOT`; set `ATOM_HOST=127.0.0.1`, `ATOM_BEHIND_PROXY=false`, and `ATOM_HTTPS=false` for this local HTTP session. Run `npm.cmd start` without demo flags.
3. Use the host browser at `http://127.0.0.1:4174/setup` for initial setup, `/local-owner` for the existing-installation owner grant after authentication, or `/local-recovery` for recovery. Recovery issues a random single-use temporary password valid for 48 hours, revokes existing sessions and records an audit event. Verify the recipient. Treat the displayed password as private; do not put it in tickets, reports or shared logs.
4. Stop the maintenance session. Restore the normal transport/environment settings, restart ATOM, then restart the public proxy only with `ATOM_BEHIND_PROXY=true` verified. Do not expose the maintenance session through port forwarding.

## Fresh owner and existing-installation grant

For a fresh normal root, `/setup` creates a new faculty identity and installation owner; no demo rename or sample class is involved. The operator chooses a password. Owner authority allows catalog/term/offering creation, faculty provisioning and offering-specific setup grants. It grants no instructional assignment or evidence access by itself.

For an existing installation, first make and verify a complete stopped-server backup and rehearse the upgrade on a separate private copy. Existing IDs, credential hashes, authored work and files are preserved. No existing faculty becomes owner automatically. Sign in as the intended faculty operator directly on the host, open `/local-owner`, and type the exact displayed identity. This one-time grant is unavailable once an owner exists. If faculty credentials were never initialized, `/setup` requires deliberate selection of that legacy faculty identity; the owner grant is still a separate authenticated step. A lost owner password uses host-local faculty recovery, not a new owner or SQL edits.

Migration 7 is additive and transactional. It introduces the catalog, bounded capabilities, explicit group associations, activation metadata, batch receipts, and a permanent publication lock. Legacy catalog links stay null; all legacy setup remains read-only pending review. Any publication history conservatively locks configuration. Inconsistent old placements/FKs are retained and flagged for review instead of silently fixed or removed. An integrity failure aborts this migration. Reverting application code is **not** a database rollback: preserve the original stopped data tree and use the matching earlier build with a verified pre-upgrade copy if recovery is needed. No supported down-migration is supplied.

## Configure a new fixed-roster course

1. On **Your subjects**, choose **Set up course**. Select/create the reusable course and academic term, give the offering a useful display identity, and select required placement components. Save the draft. The supported scope is one offering per course per term in this installation.
2. Provision faculty identities as owner, verify recipients, and issue their private activation hand-offs. Configure lecture, laboratory, or combined groups with one or more explicit instructors per group. Optional lecture/lab links are explanatory relationships, not enrollments or permissions. A combined group satisfies only the explicitly chosen combined component.
3. Add students manually or paste 1–200 rows with three tab-separated columns: student number, full name, exact group labels separated by semicolons. No header. Student numbers are text, trimmed and uppercased, preserving leading zeros; accepted characters are ASCII letters/digits, dots, underscores and dashes. Resolve row issues, confirm exact existing identity reuse where offered, preview again, then Apply. No fuzzy match, silent name/password replacement, automatic placement, or general spreadsheet import occurs.
4. Apply is atomic and a retry with the same request key and identical payload returns the committed result. A changed payload conflicts. Preview is read-only; canceling it enrolls nobody. Explicitly saved drafts remain saved. Browser staging is tab-memory only: inspect the saved roster after a lost tab/response rather than inventing a new batch or assuming the write failed.
5. Review actual instructors, placements, associations and counts. Grant a specific existing faculty account setup authority here if needed. A setup manager sees the offering roster and readiness, but cannot download submissions or evaluate without separate instructional authority. Mark ready; unclaimed student accounts do not prevent readiness. Assigned instructors then use the existing Activities workspace. A manager-only account receives an operational handoff view.

First publication permanently freezes all supported membership/configuration writes, including bulk roster apply, faculty reassignment, group changes, enrollment/deactivation/reactivation and manager-grant changes. The lock is persisted in the publication transaction; a stale page, concurrent write, unpublish, or empty submission list cannot unlock it. Safe offering-display edits and authorized credential/session security recovery remain available. **Late enrollment, replacement instructors and transfers require a later authorized milestone.** No direct SQLite editing procedure is supported.

Distinct lab instructors can publish separate activities. Shared publication still requires one actor with publication rights and assignments to every destination; authoring collaboration and group links are not evidence/evaluation delegation. The pilot does not retroactively isolate legacy shared-release evidence after historical transfers (A01).

## Activation, reissue and privacy

Roster Apply creates identities/enrollments without issuing credentials. New faculty usernames are reserved; new accounts cannot sign in until activation is explicitly issued. Use **Private hand-off** in the setup roster, the faculty provision area, or authorized Student Access. Verify the recipient in person or through an established trusted process. The temporary secret is randomly generated, stored only as a salted hash, shown in that private flow, and valid for **48 hours**. Close to discard; there is no recovery/export of a lost secret.

First sign-in consumes activation once and permits only the required password change. Activation expiry also applies while that change is pending. Losing that session requires a new hand-off. Reissue invalidates earlier secrets and current sessions, including for already activated accounts. Host-local faculty recovery and the existing authorized student reset now follow the same random activation contract, never a student-number password. Existing working credentials are unchanged until an explicit authorized reset.

The UI distinguishes not issued, unclaimed, expired, password-change-required, activated, and legacy/existing credential states. Account existence alone is not activation. No secret belongs in a roster, URL, browser persistence, screenshot, report, log, or bulk spreadsheet. Setup responses use `Cache-Control: no-store`; logout/account change discards setup state and ignores stale responses. Setup grants and mutations are audited with IDs, not pasted names or secrets. Owner-only session revocation is also available through the protected account API.

## Complete backup inventory

Back up the **entire stopped-server `data` directory**, including:

```text
data/
  atom.sqlite
  atom.sqlite-wal, atom.sqlite-shm  (if present after shutdown)
  activity-assets/                 (normal teaching files)
  uploads/                        (submissions and older fixture teaching files)
  tmp/                            (retain during backup; investigate remnants separately)
```

Also retain the exact application revision/build, lockfile, Node version and private deployment configuration needed to reproduce startup. Do not commit database backups, account/session data, environment secrets or real submissions to Git. A CSV export is not a backup. SQLite alone, or SQLite plus only `uploads`, omits normal teaching materials.

1. Verify the absolute root and stop **every process using that root**, including development or maintenance tools. Await clean shutdown; a disappeared window alone is insufficient. Never copy an actively written SQLite database and call the result a verified backup.
2. Copy the whole `<root>/data` tree to a new, access-controlled backup destination. Preserve paths; never delete WAL/SHM files to make a backup appear simpler. When shutdown/checkpoint removes sidecars normally, their absence is expected.
3. Record a manifest of file-relative paths, sizes and SHA-256 hashes. Store the manifest with the backup, protected like the data. Verify the copied files against it. Separately record the application's revision and storage-root interpretation.
4. Keep the source intact. Do not overwrite a running or unverified target. Backup retention, encryption, access-control validation and off-host storage are deployment responsibilities not proven by a local synthetic drill.

## Restore into a new root

1. Keep the original root stopped and unchanged. Create a new absolute restore root; copy the complete backed-up `data` tree beneath it and compare the file manifest before startup.
2. With the recorded compatible application version, open the copied database and run `PRAGMA integrity_check` and `PRAGMA foreign_key_check`. Verify activity/release/asset/submission/evaluation relationships and referenced stored-file hashes. A valid SQLite file alone does not prove its material files exist.
3. Start ATOM with the restore root, `ATOM_HOST=127.0.0.1`, no demo flag and no stress seed. Confirm the startup data path. Sign in using restored credentials; verify a published activity, released teaching-file downloads, student-owned submission download, and faculty evidence/evaluation access. Compare downloaded bytes against stored SHA-256 values and verify one current submission per activity/student.
4. Stop and verify relationships/hashes again. Do not switch users to this restore until the checks pass. Switching a live deployment, changing firewall/TLS configuration, or replacing an original database requires a separate authorized deployment procedure.

For the repeatable **synthetic** drill in this repository, build first and run `node server/test-fixtures/restore-drill.mjs`. It owns fresh temporary roots/processes and checks two corpora: the existing sample workflow and an entirely new API-created class. Both stop before copying and restore into a new root. The Phase 1 drill additionally verifies catalog/term/offering links, setup grants, distinct instructors, explicit placements, activation state, permanent lock, batch receipts, both labs' files/evaluation and denied foreign evidence access. Exact manifests and referenced bytes are compared; the source remains unchanged. This is not evidence of a real institutional backup, ACL audit, TLS deployment or physical second client.

## Browser recovery and retries

“Saved to ATOM” means the server acknowledged that draft. “Saved on this device” means an IndexedDB transaction completed for that draft; browser storage can still be cleared or evicted later. “Not saved” means keep the tab open and retry/export the work before leaving. Device recovery is scoped by account and activity, so changing accounts must not load another account's copy. A blocked/quota/aborted storage operation is not a saved copy.

Identical retries with the same submission key resolve to committed evidence while the caller remains eligible; different payload/filename/completion claim/release returns 409. A changed release, deadline, placement or session during receipt is rejected before commit. An unexpected connection loss after commit is still possible: retry using the same key and inspect the receipt. Never infer failure solely from a disconnected response, and never remove stored evidence by manually resetting current flags.

Crash/power-loss reconciliation beyond the bounded injected storage failures is not proven here. Keep all evidence and investigate any orphan/pending files against database references before cleanup.
