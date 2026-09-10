import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const parent = mkdtempSync(join(tmpdir(), "atom-restore-drill-"));
const source = join(parent, "source"); const restored = join(parent, "restored");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function manifest(root, folder = root) {
  return readdirSync(folder).sort().flatMap(name => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? manifest(root, path) : [{ path: relative(root, path), size: statSync(path).size, sha256: digest(readFileSync(path)) }];
  });
}
async function start(root) {
  const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = listener.address().port; await new Promise(done => listener.close(done));
  const child = fork(join(repo, "server/test-fixtures/authority-server.mjs"), ["--compiled"], { cwd: repo, execArgv: [], windowsHide: true,
    env: { ...process.env, ATOM_ROOT: root, PORT: String(port), ATOM_HOST: "127.0.0.1", ATOM_BEHIND_PROXY: "false", ATOM_DEVELOPMENT_PREVIEW: "false", ATOM_HTTPS: "false", ATOM_ALLOWED_ORIGINS: "" }, stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const base = `http://127.0.0.1:${port}`;
  for (let n = 0; ; n++) {
    try { if ((await fetch(base + "/api/health")).ok) break; } catch {}
    if (n === 100 || child.exitCode !== null) { if (child.connected) child.send("stop"); throw new Error("Fixture server failed to start"); }
    await new Promise(done => setTimeout(done, 100));
  }
  return { child, base };
}
async function stop(server) {
  if (server?.child.exitCode === null) { const ended = once(server.child, "exit"); server.child.send("stop"); await ended; }
}
function evidence(root) {
  const db = new DatabaseSync(join(root, "data/atom.sqlite"), { readOnly: true });
  try {
    assert.deepEqual(db.prepare("PRAGMA integrity_check").all().map(row => row.integrity_check), ["ok"]);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    const tables = ["activities", "activity_releases", "activity_targets", "activity_release_scopes", "activity_assets", "activity_release_assets", "submissions", "evaluations", "student_group_placements", "faculty_group_assignments", "auth_credentials"];
    const rows = Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
    for (const file of [...rows.activity_assets, ...rows.activity_release_assets, ...rows.submissions]) {
      const path = resolve(root, "data", file.stored_path);
      assert.ok(path.startsWith(resolve(root, "data") + sep));
      const bytes = readFileSync(path); assert.equal(bytes.length, file.size_bytes); assert.equal(digest(bytes), file.sha256);
    }
    assert.equal(db.prepare("SELECT activity_id,student_id FROM submissions GROUP BY activity_id,student_id HAVING SUM(is_current_submission) != 1").all().length, 0);
    return rows;
  } finally { db.close(); }
}
let server;
try {
  server = await start(source);
  const smoke = spawn(process.execPath, [join(repo, "server/smoke.mjs")], { cwd: repo, windowsHide: true, env: { ...process.env, ATOM_SMOKE_BASE: server.base }, stdio: "inherit" });
  assert.equal((await once(smoke, "exit"))[0], 0);
  await stop(server); server = null;
  const before = evidence(source);
  const original = manifest(join(source, "data"));
  cpSync(join(source, "data"), join(restored, "data"), { recursive: true, errorOnExist: true, force: false });
  assert.deepEqual(manifest(join(restored, "data")), original);
  assert.deepEqual(evidence(restored), before);
  server = await start(restored);
  async function login(identifier, password) {
    const response = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier, password }) });
    assert.equal(response.status, 200); return response.headers.get("set-cookie").split(";")[0];
  }
  const faculty = await login("faculty-demo", "faculty-password");
  const student = await login("2026-00001", "student-password");
  const activity = before.activities.find(row => row.title === "Smoke Laboratory Activity");
  assert.ok(activity);
  const scope = new URLSearchParams({ subjectOfferingId: activity.subject_offering_id, teachingGroupId: "all", gradingPeriod: activity.grading_period });
  for (const cookie of [faculty, student]) {
    const response = await fetch(`${server.base}/api/activities/${activity.id}?${scope}`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const detail = await response.json(); assert.equal(detail.title, activity.title);
    if (cookie === faculty) { assert.equal(detail.submissions[0].evaluation.score, 10); assert.equal(detail.submissions[0].evaluation.manualDeduction, 1); }
    for (const file of before.activity_assets.filter(row => row.activity_id === activity.id)) {
      const downloaded = await fetch(`${server.base}/api/activity-assets/${file.id}/file`, { headers: { cookie } });
      assert.equal(downloaded.status, 200); assert.equal(digest(Buffer.from(await downloaded.arrayBuffer())), file.sha256);
    }
    for (const file of before.submissions.filter(row => row.activity_id === activity.id)) {
      const downloaded = await fetch(`${server.base}/api/submissions/${file.id}/file`, { headers: { cookie } });
      assert.equal(downloaded.status, 200); assert.equal(digest(Buffer.from(await downloaded.arrayBuffer())), file.sha256);
    }
  }
  await stop(server); server = null;
  assert.deepEqual(evidence(restored), before);
  assert.deepEqual(manifest(join(source, "data")), original);
  console.log(`Restore drill passed: ${original.length} files copied exactly; integrity, relationships, credentials, teaching assets, submissions and evaluation verified; source unchanged.`);
} finally {
  await stop(server);
  if (resolve(parent).startsWith(resolve(tmpdir()) + sep) && parent.includes("atom-restore-drill-")) rmSync(parent, { recursive: true, force: true });
}
