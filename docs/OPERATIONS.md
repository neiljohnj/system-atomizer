# ATOM Phase 0 operations and recovery

This procedure covers the existing synthetic activity workflow, not authoritative grades or Phase 1 course administration. Keep evaluation provisional: recorded totals/deductions have no approved criterion-scoring policy or immutable correction history (A07). Do not use them as an authoritative gradebook.

## Storage and startup

Use Node.js 22+ and run the installed project's scripts from the repository directory. Build with `npm.cmd run build`. The normal server command is `npm.cmd start`; it does not reset account credentials. `dev`, `dev:build` and `demo:accounts` reset sample credentials and revoke their sessions. Never use those commands against a class-data root.

`ATOM_ROOT` is an **application storage root**; the database is `<ATOM_ROOT>/data/atom.sqlite`. An absolute root is recommended. Relative values resolve from the command's current working directory. An unset value uses that working directory. Server and both maintenance seeds share these semantics. Confirm the `ATOM data:` startup line before proceeding. Changing `ATOM_ROOT` does not move existing data automatically.

For an isolated development corpus, set an explicitly disposable absolute `ATOM_ROOT` and run `npm.cmd run stress:seed -- --development-fixture`. `--refresh` still preserves edited/published/submitted activities. Fixture source files resolve from the installation, not from the storage root. These flags acknowledge development seeding; they do not identify real data automatically.

## Supported transport and maintenance boundary

Direct LAN HTTP is supported for the bounded workflow when tested in a current browser. It is not encrypted. Use only a trusted, access-controlled classroom network; do not expose the listener to the Internet or untrusted networks. Set `ATOM_HOST` to the host's intended interface, or `0.0.0.0` for all interfaces, and `PORT` as required (default 4174). Restrict Windows Firewall to the intended network. Firewall/ACL changes are administrator work, not performed by the verification harness.

`ATOM_HTTPS=true` marks cookies Secure and changes metadata; it **does not terminate TLS**. No TLS certificate or HTTPS deployment was configured by this work. Do not enable that flag for plain HTTP.

If placing ATOM behind a proxy, set **`ATOM_BEHIND_PROXY=true` on the backend**, bind the backend to `127.0.0.1` with `ATOM_HOST`, and keep it unreachable from external clients. This mode rejects faculty listing/reset and initial setup mutations even when the upstream connection is loopback and strips every forwarding header. The proxy must additionally exclude `/setup`, `/local-recovery`, `/api/setup`, and `/api/local-recovery` (including descendant paths and equivalent casing). The application API guard is the security boundary; hiding navigation is insufficient.

Do not forward a server in direct mode through a proxy. The backend cannot distinguish an undisclosed transparent local proxy from a local browser. `Host`, `Origin` and `X-Forwarded-*` alone do not establish a trustworthy local-maintenance caller. Set `ATOM_ALLOWED_ORIGINS` only to exact trusted public origins when needed; do not use broad origin allowances to compensate for an incorrect proxy setup.

For deliberate setup or faculty recovery:

1. Stop the public proxy/listener and confirm it cannot forward to the maintenance backend. Stop ATOM cleanly with Ctrl+C and wait for its exit.
2. In a host-local terminal, select the **same verified absolute** `ATOM_ROOT`; set `ATOM_HOST=127.0.0.1`, `ATOM_BEHIND_PROXY=false`, and `ATOM_HTTPS=false` for this local HTTP session. Run `npm.cmd start` without demo flags.
3. Use the host browser at `http://127.0.0.1:4174/setup` for initial setup, or `/local-recovery` for recovery. Recovery issues a temporary password, revokes existing sessions and records an audit event. Treat the displayed password as private; do not put it in tickets, reports or shared logs.
4. Stop the maintenance session. Restore the normal transport/environment settings, restart ATOM, then restart the public proxy only with `ATOM_BEHIND_PROXY=true` verified. Do not expose the maintenance session through port forwarding.

Initial setup still claims the seeded faculty identity; it is not a real-course provisioning workflow. Phase 1 must replace that limitation through explicit administration.

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

For the repeatable **synthetic** drill in this repository, build first and run `node server/test-fixtures/restore-drill.mjs`. It owns fresh temporary roots/processes, runs the existing smoke, stops before copying, checks the complete copy, starts the restored copy, and tests API/download evidence. This is not evidence of a real institutional backup, ACL audit, TLS deployment or physical second client.

## Browser recovery and retries

“Saved to ATOM” means the server acknowledged that draft. “Saved on this device” means an IndexedDB transaction completed for that draft; browser storage can still be cleared or evicted later. “Not saved” means keep the tab open and retry/export the work before leaving. Device recovery is scoped by account and activity, so changing accounts must not load another account's copy. A blocked/quota/aborted storage operation is not a saved copy.

Identical retries with the same submission key resolve to committed evidence while the caller remains eligible; different payload/filename/completion claim/release returns 409. A changed release, deadline, placement or session during receipt is rejected before commit. An unexpected connection loss after commit is still possible: retry using the same key and inspect the receipt. Never infer failure solely from a disconnected response, and never remove stored evidence by manually resetting current flags.

Crash/power-loss reconciliation beyond the bounded injected storage failures is not proven here. Keep all evidence and investigate any orphan/pending files against database references before cleanup.
