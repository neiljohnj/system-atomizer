import { fork, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openAtomDatabase, FACULTY_ID, STUDENT_ID, SECOND_STUDENT_ID, SUBJECT_OFFERING_ID, LAB_2A_ID, LAB_2AX_ID, LECTURE_2A_ID } from "./db.js";

type Row = Record<string, any>;
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const actors = { both: FACULTY_ID, a: "authority-a", b: "authority-b", lecture: "authority-lecture", edit: "authority-edit", publish: "authority-publish", outside: "authority-outside", student: STUDENT_ID, studentB: SECOND_STUDENT_ID };
const O = SUBJECT_OFFERING_ID, A = LAB_2A_ID, B = LAB_2AX_ID;
let root: string, db: DatabaseSync, child: ChildProcess, base: string;
let shared: Row, hidden: Row, own: Row, draft: Row, asset: Row, subA: string, subB: string;
const cookies = new Map<string, string>();
let baseline: Array<{ name: string; rows: Row[] }>;
let originalFiles: Set<string>;
const academicTables = ["subjects", "academic_terms", "subject_offerings", "teaching_groups", "enrollments", "student_group_placements", "faculty_group_assignments", "assessment_topics", "activities", "activity_targets", "activity_releases", "activity_release_scopes", "activity_assets", "activity_release_assets", "activity_collaborators", "submissions", "evaluations"];

async function request(actor: keyof typeof actors, path: string, body?: unknown, method = body === undefined ? "GET" : "POST", extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { cookie: cookies.get(actor)!, ...extraHeaders };
  if (body !== undefined && !(body instanceof FormData)) headers["content-type"] = "application/json";
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  const bytes = Buffer.from(await response.arrayBuffer());
  let data: any; try { data = JSON.parse(bytes.toString()); } catch { /* file response */ }
  return { status: response.status, data, bytes };
}
async function success(actor: keyof typeof actors, path: string, body?: unknown, method?: string): Promise<Row> {
  const result = await request(actor, path, body, method);
  expect(result.status, `${method ?? "request"} ${path}: ${result.data?.error ?? ""}`).toBeLessThan(300);
  return result.data;
}
const scope = (group = "all") => `subjectOfferingId=${O}&teachingGroupId=${group}&gradingPeriod=midterm`;
const detail = (id: string, group = "all") => `/api/activities/${id}?${scope(group)}`;
const input = (title: string, groups: string[]) => ({ subjectOfferingId: O, gradingPeriod: "midterm", teachingGroupIds: groups, title, instructions: "Synthetic instructions", requirements: [], opensAt: new Date(Date.now() - 60000).toISOString(), deadlineAt: new Date(Date.now() + 86400000).toISOString(), acceptedExtensions: [".py"], maxBytes: 1048576 });
function files(dir = join(root, "data")): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : /atom\.sqlite(?:-|$)/.test(name) ? [] : [path]; });
}
function snapshot() {
  // Auth sessions/audit events are intentionally not business state.
  return { tables: academicTables.map(name => ({ name, rows: db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all() })), files: files().sort().map(path => [relative(root, path), createHash("sha256").update(readFileSync(path)).digest("hex")]) };
}
async function denied(actor: keyof typeof actors, path: string, body?: unknown, method?: string) {
  const before = snapshot();
  const result = await request(actor, path, body, method);
  expect([400, 403, 404, 409]).toContain(result.status);
  expect(snapshot()).toEqual(before);
  expect(result.data?.error ?? "").not.toMatch(/Hidden B material|2026-00002|Synthetic instructions/);
  return result;
}
async function publishActivity(id: string, actor: keyof typeof actors = "both") {
  return success(actor, `/api/activities/${id}/publish`, { expectedDraftRevision: db.prepare("SELECT draft_revision FROM activities WHERE id=?").get(id)!.draft_revision });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "atom-authority-test-"));
  if (!isAbsolute(root) || !resolve(root).startsWith(resolve(tmpdir()) + sep) || resolve(root, "data") === resolve(repo, "data")) throw new Error("Unsafe test data root");
  const database = openAtomDatabase(root, { sample: true }); db = database.db;
  expect(resolve(database.dataDir)).toBe(resolve(root, "data"));
  db.prepare("DELETE FROM faculty_group_assignments").run();
  for (const [name, id] of Object.entries(actors)) {
    if (![FACULTY_ID, STUDENT_ID, SECOND_STUDENT_ID].includes(id)) db.prepare("INSERT INTO users(id,display_name,role) VALUES (?,?,'faculty')").run(id, `Test ${name}`);
    if (!name.startsWith("student")) for (const group of name === "both" ? [A, B] : name === "lecture" ? [LECTURE_2A_ID] : [name === "b" || name === "outside" ? B : A]) db.prepare("INSERT INTO faculty_group_assignments VALUES (?,?)").run(id, group);
    db.prepare("UPDATE auth_credentials SET must_change_password=0 WHERE user_id=?").run(id);
    const token = randomBytes(32).toString("base64url"), now = new Date().toISOString();
    db.prepare("INSERT INTO auth_sessions(token_hash,user_id,created_at,last_seen_at,expires_at,user_agent,development_preview) VALUES (?,?,?,?,?,'authority regression',0)").run(createHash("sha256").update(token).digest("hex"), id, now, now, new Date(Date.now() + 3600000).toISOString());
    cookies.set(name, `atom_session=${token}`);
  }
  const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = (listener.address() as { port: number }).port; await new Promise<void>(done => listener.close(() => done()));
  base = `http://127.0.0.1:${port}`;
  child = fork(join(repo, "server/test-fixtures/authority-server.mjs"), [], { cwd: repo, execArgv: ["--import", "tsx"], windowsHide: true, env: { ...process.env, ATOM_ROOT: root, PORT: String(port), ATOM_DEVELOPMENT_PREVIEW: "false", ATOM_HTTPS: "false", ATOM_ALLOWED_ORIGINS: "" }, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  for (let n = 0; n < 100; n++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch { /* wait for owned server */ } if (n === 99) throw new Error("Test server failed to start"); await new Promise(done => setTimeout(done, 100)); }
  shared = await success("both", "/api/activities", input("Shared labs", [A, B])); await publishActivity(shared.id);
  own = await success("both", "/api/activities", input("Lab A release", [A])); await publishActivity(own.id);
  hidden = await success("b", "/api/activities", input("Hidden B material", [B]));
  const form = new FormData(); form.set("file", new Blob(["Hidden B material"]), "material.txt");
  asset = await success("b", `/api/activities/${hidden.id}/assets`, form);
  draft = await success("both", "/api/activities", input("Coauthor draft", [A]));
  for (const [name, edit, publish] of [["edit", true, false], ["publish", true, true], ["outside", true, true]] as const) await success("both", `/api/activities/${draft.id}/collaborators/${actors[name]}`, { canEdit: edit, canPublish: publish }, "PUT");
  for (const activity of [shared, own]) for (const actor of activity === shared ? ["student", "studentB"] as const : ["student"] as const) {
    const form = new FormData(); form.set("file", new Blob(["# synthetic evidence\n"]), "solution.py");
    const submitted = await success(actor, `/api/activities/${activity.id}/submissions`, form);
    if (activity === shared) { if (actor === "student") subA = submitted.currentSubmission.id; else subB = submitted.currentSubmission.id; }
  }
  await success("both", `/api/submissions/${subB}/evaluation`, { score: 5 });
  baseline = academicTables.map(name => ({ name, rows: db.prepare(`SELECT * FROM ${name}`).all() as Row[] }));
  originalFiles = new Set(files());
}, 30000);

beforeEach(() => {
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  try {
    for (const { name } of baseline) db.exec(`DELETE FROM ${name}`);
    for (const { name, rows } of baseline) for (const row of rows) {
      const columns = Object.keys(row); db.prepare(`INSERT INTO ${name} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map(column => row[column]));
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; } finally { db.exec("PRAGMA foreign_keys=ON"); }
  for (const path of files()) if (!originalFiles.has(path)) rmSync(path);
});
afterAll(async () => {
  if (child?.exitCode === null) { const ended = once(child, "exit"); child.send("stop"); await ended; }
  db?.close();
  if (root && resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes("atom-authority-test-")) rmSync(root, { recursive: true, force: true });
}, 15000);

describe("Phase 0A instructor authority through HTTP", () => {
  it("A09 rejects a release change while the multipart body is still arriving", async () => {
    let finish!: () => void;
    const result = new Promise<number>((resolve,reject) => {
      const req=httpRequest(`${base}/api/activities/${shared.id}/submissions`,{method:"POST",headers:{cookie:cookies.get("student")!,"content-type":"multipart/form-data; boundary=release-test"}},res=>{res.resume();resolve(res.statusCode!);});
      req.on("error",reject);
      req.write('--release-test\r\nContent-Disposition: form-data; name="file"; filename="solution.py"\r\nContent-Type: text/plain\r\n\r\n' + '# partial\n'.repeat(4096));
      finish=()=>req.end('\r\n--release-test--\r\n');
    });
    for(let n=0;n<100&&files().length===originalFiles.size;n++)await new Promise(done=>setTimeout(done,10));
    expect(files().length).toBeGreaterThan(originalFiles.size);
    await success("both",`/api/activities/${shared.id}/unpublish`,{});await publishActivity(shared.id);
    const expected=snapshot();expected.files=expected.files.filter(([path])=>originalFiles.has(join(root,path)));
    finish();expect(await result).toBe(409);expect(snapshot()).toEqual(expected);
  });
  it("A05 cleans aborted authorized receipt and preserves the current submission", async () => {
    const before = snapshot();
    const req = httpRequest(`${base}/api/activities/${shared.id}/submissions`, { method: "POST", headers: {
      cookie: cookies.get("student")!, "content-type": "multipart/form-data; boundary=abort-test", "content-length": 1000000,
    }});
    req.on("error", () => {});
    req.write('--abort-test\r\nContent-Disposition: form-data; name="file"; filename="solution.py"\r\nContent-Type: text/plain\r\n\r\n' + 'x'.repeat(32768));
    for(let n=0; n<100 && files().length === originalFiles.size; n++) await new Promise(done=>setTimeout(done,10));
    expect(files().length).toBeGreaterThan(originalFiles.size);
    req.destroy();
    for(let n=0; n<100 && files().length !== originalFiles.size; n++) await new Promise(done=>setTimeout(done,10));
    expect(snapshot()).toEqual(before);
  });
  it("A05 rejects activity-oversized files and cleans failed permanent-file movement", async () => {
    const before = snapshot(); const tooLarge = new FormData(); tooLarge.set("file", new Blob([new Uint8Array(1048577)]), "solution.py");
    expect((await request("student", `/api/activities/${shared.id}/submissions`, tooLarge)).status).toBe(413); expect(snapshot()).toEqual(before);
    const armed = once(child,"message"); child.send("fail-rename"); await armed;
    const form = new FormData(); form.set("file",new Blob(["# storage fault"]),"solution.py");
    expect((await request("student", `/api/activities/${shared.id}/submissions`,form)).status).toBe(500); expect(snapshot()).toEqual(before);
  });
  it.each([false, true])("A09 allocates different-key revisions and enforces the last category slot; atLimit=%s", async atLimit => {
    const send = (key: string) => { const form = new FormData(); form.set("file", new Blob([`# ${key}`]), "solution.py"); return request("student", `/api/activities/${shared.id}/submissions`, form, "POST", { "idempotency-key": key }); };
    if (atLimit) for (let i=0; i<8; i++) expect((await send(`budget-${i}`)).status).toBe(201);
    const armed = once(child, "message"); child.send("arm-upload"); await armed;
    const moved = once(child, "message"); const first = send("budget-first"); await moved;
    expect((await send("budget-second")).status).toBe(201);
    child.send("release-copy"); expect((await first).status).toBe(atLimit ? 409 : 201);
    const rows = db.prepare("SELECT normalized_filename FROM submissions WHERE activity_id=? AND student_id=?").all(shared.id, STUDENT_ID);
    expect(rows.length).toBe(atLimit ? 10 : 3); expect(new Set(rows.map(row => row.normalized_filename)).size).toBe(rows.length);
    expect(db.prepare("SELECT count(*) n FROM submissions WHERE activity_id=? AND student_id=? AND is_current_submission=1").get(shared.id, STUDENT_ID)!.n).toBe(1);
    expect(files().length).toBe(originalFiles.size + (atLimit ? 9 : 2));
  });
  it.each(["unpublish", "release", "placement", "deadline", "session"])("A09 rechecks %s after receipt and preserves existing evidence", async change => {
    const sessions = db.prepare("SELECT * FROM auth_sessions WHERE user_id=?").all(STUDENT_ID) as Row[];
    const armed = once(child, "message"); child.send("arm-upload"); await armed;
    const moved = once(child, "message"); const form = new FormData(); form.set("file", new Blob(["# in flight"]), "solution.py");
    const pending = request("student", `/api/activities/${shared.id}/submissions`, form); await moved;
    if (change === "unpublish" || change === "release") await success("both", `/api/activities/${shared.id}/unpublish`, {});
    if (change === "release") await publishActivity(shared.id);
    if (change === "placement") db.prepare("UPDATE enrollments SET status='inactive' WHERE student_id=?").run(STUDENT_ID);
    if (change === "session") db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(STUDENT_ID);
    if (change === "deadline") {
      const row = db.prepare("SELECT r.id,r.snapshot_json FROM activity_releases r JOIN activities a ON a.current_release_id=r.id WHERE a.id=?").get(shared.id)!;
      const data = JSON.parse(String(row.snapshot_json)); data.deadlineAt = new Date(Date.now()-1000).toISOString();
      db.prepare("UPDATE activity_releases SET snapshot_json=? WHERE id=?").run(JSON.stringify(data), row.id);
    }
    const expected = snapshot(); expected.files = expected.files.filter(([path]) => originalFiles.has(join(root, path)));
    child.send("release-copy"); const result = await pending;
    expect([401,403,409]).toContain(result.status); expect(snapshot()).toEqual(expected);
    if(change === "session") for (const row of sessions) { const columns=Object.keys(row); db.prepare(`INSERT INTO auth_sessions (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...columns.map(column=>row[column])); }
  });
  it("A08 keeps both grading-period moves discoverable and clears incompatible topics", async () => {
    for (const [from, to] of [["midterm", "final_term"], ["final_term", "midterm"]]) {
      const topic = await success("both", `/api/subject-offerings/${O}/topics`, { title: `Topic ${from}`, gradingPeriod: from });
      db.prepare("UPDATE activities SET grading_period=?,topic_id=? WHERE id=?").run(from, topic.id, draft.id);
      const revision = db.prepare("SELECT draft_revision FROM activities WHERE id=?").get(draft.id)!.draft_revision;
      const updated = await success("both", `/api/activities/${draft.id}`, { ...input("Moved draft", [A]), gradingPeriod: to, baseRevision: revision }, "PATCH");
      expect(updated.topic).toBe(null);
      const stream = await success("both", `/api/subject-offerings/${O}/assessment-stream?teachingGroupId=all&gradingPeriod=${to}`);
      expect(stream.sections.flatMap((section: Row) => section.items).some((item: Row) => item.id === draft.id)).toBe(true);
    }
  });
  it.each([false, true])("A09 resolves concurrent same-key retries; mismatch=%s", async mismatch => {
    const send = (content: string) => { const form = new FormData(); form.set("file", new Blob([content]), "solution.py"); return request("student", `/api/activities/${shared.id}/submissions`, form, "POST", { "idempotency-key": "concurrent-test" }); };
    const armed = once(child, "message"); child.send("arm-upload"); await armed;
    const moved = once(child, "message"); const first = send("# first payload"); await moved;
    const second = await send(mismatch ? "# different payload" : "# first payload");
    child.send("release-copy"); const result = await first;
    expect(second.status).toBe(201); expect(result.status).toBe(mismatch ? 409 : 200);
    expect(db.prepare("SELECT count(*) n FROM submissions WHERE idempotency_key='concurrent-test'").get()!.n).toBe(1);
    expect(db.prepare("SELECT count(*) n FROM submissions WHERE activity_id=? AND student_id=? AND is_current_submission=1").get(shared.id, STUDENT_ID)!.n).toBe(1);
    expect(files().length).toBe(originalFiles.size + 1);
  });
  it.each([
    { route: "assets", actor: "", status: 401 },
    { route: "submissions", actor: "", status: 401 },
    { route: "assets", actor: "student", status: 403 },
    { route: "submissions", actor: "a", status: 403 },
    { route: "assets", actor: "outside", status: 403 },
    { route: "submissions", actor: "invalid-session", status: 401 },
  ])("A05 rejects partial $route for $actor before receiving a temp file", async ({ route, actor, status }) => {
    const before = files();
    const response = new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${base}/api/activities/${shared.id}/${route}`, {
        method: "POST", headers: { "content-type": "multipart/form-data; boundary=partial-test", "content-length": 1000000, ...(actor ? { cookie: cookies.get(actor) ?? "atom_session=invalid" } : {}) },
      }, res => { resolve(res.statusCode!); res.resume(); req.destroy(); });
      req.on("error", error => { if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error); });
      req.write('--partial-test\r\nContent-Disposition: form-data; name="file"; filename="solution.py"\r\nContent-Type: text/plain\r\n\r\n# incomplete');
      req.setTimeout(1500, () => { req.destroy(); reject(new Error("Authorization waited for multipart completion")); });
    });
    expect(await response).toBe(status); expect(files()).toEqual(before);
  });
  it("asset upload rechecks a revoked edit grant after filesystem awaits", async () => {
    const armed = once(child, "message"); child.send("arm-upload"); await armed;
    const uploaded = once(child, "message");
    const form = new FormData(); form.set("file", new Blob(["Test-owned upload"]), "note.txt");
    const pending = request("edit", `/api/activities/${draft.id}/assets`, form);
    await uploaded;
    db.prepare("DELETE FROM activity_collaborators WHERE activity_id=? AND faculty_id=?").run(draft.id, actors.edit);
    const expected = snapshot(); expected.files = expected.files.filter(([path]) => originalFiles.has(join(root, path)));
    child.send("release-copy"); const result = await pending;
    expect(result.status).toBe(403); expect(snapshot()).toEqual(expected);
  });
  it("evidence-only detail exposes released materials without exposing later private draft files", async () => {
    await success("b", `/api/activities/${hidden.id}/publish`, { expectedDraftRevision: 1 });
    const form = new FormData(); form.set("file", new Blob(["# lab B\n"]), "solution.py");
    await success("studentB", `/api/activities/${hidden.id}/submissions`, form);
    await success("b", `/api/activities/${hidden.id}/unpublish`, {});
    db.prepare("INSERT INTO faculty_group_assignments VALUES (?,?)").run(actors.b, A);
    await success("b", `/api/activities/${hidden.id}`, { ...input("Later private title", [A]), baseRevision: 1 }, "PATCH");
    const laterForm = new FormData(); laterForm.set("file", new Blob(["Private later material"]), "private.txt");
    const later = await success("b", `/api/activities/${hidden.id}/assets`, laterForm);
    // B's separate peer has release/student scope but no new draft or coauthor grant.
    const review = await success("outside", detail(hidden.id));
    expect(review.evidenceOnly).toBe(true); expect(review.title).toBe("Hidden B material");
    expect(review.assets.map((a: Row) => a.id)).toEqual([asset.id]);
    expect((await request("outside", `/api/activity-assets/${asset.id}/file`)).status).toBe(200);
    await denied("outside", `/api/activity-assets/${later.id}/file`);
    await denied("outside", `/api/activities/${hidden.id}/duplicate`, { teachingGroupIds: [B] });
  });
  it.each(["teachingGroupId=all&teachingGroupId=unknown", "gradingPeriod=other", "subjectOfferingId=other"])("rejects alternate response-scope encoding %s before mutation", async query => {
    await denied("both", `/api/activities/${draft.id}/publish?${query}`, { expectedDraftRevision: 1 });
    await denied("both", `/api/activities/${draft.id}?${query}`, { ...input("Retained", [A]), baseRevision: 1 }, "PATCH");
  });
  it.each([[], [A, 3], "all"])("rejects malformed duplicate destinations %j before copying", async destinations => {
    await denied("b", `/api/activities/${hidden.id}/duplicate`, { teachingGroupIds: destinations });
  });
  it.each(["assignment", "source"])("revalidates %s after awaited copying and cleans only the failed copy", async change => {
    const armed = once(child, "message"); child.send("arm-copy"); await armed;
    const copied = once(child, "message");
    const pending = request("b", `/api/activities/${hidden.id}/duplicate`, {});
    await copied;
    if (change === "assignment") db.prepare("DELETE FROM faculty_group_assignments WHERE faculty_id=?").run(actors.b);
    else db.prepare("UPDATE activities SET draft_revision=draft_revision+1 WHERE id=?").run(hidden.id);
    // Exclude the in-flight operation-owned copy; retain the deliberate concurrent change.
    const expected = snapshot(); expected.files = expected.files.filter(([path]) => originalFiles.has(join(root, path)));
    child.send("release-copy");
    const result = await pending; expect([403, 404, 409]).toContain(result.status);
    expect(snapshot()).toEqual(expected);
  });
  it("A01 filters shared all/concrete list counts and detail with positive own-scope access", async () => {
    for (const group of ["all", A]) {
      const item = await success("a", detail(shared.id, group));
      expect(item.studentCount).toBe(1); expect(item.submissionCount).toBe(1);
      expect(item.submissions.map((s: Row) => s.studentId)).toEqual([STUDENT_ID]);
      const list = await success("a", `/api/activities?${scope(group)}`) as unknown as Row[];
      expect(list.find(a => a.id === shared.id)?.submissionCount).toBe(1);
    }
    await denied("a", detail(shared.id, B));
  });
  it("A01 denies foreign direct download and evaluation without changing evidence", async () => {
    await denied("a", `/api/submissions/${subB}/file`);
    await denied("a", `/api/submissions/${subB}/evaluation`, { score: 88 });
    expect((await request("a", `/api/submissions/${subA}/file`)).status).toBe(200);
    await success("a", `/api/submissions/${subA}/evaluation?teachingGroupId=${A}`, { score: 8 });
  });
  it.each([B, "unknown-group"])("A02 rejects evaluation response scope %s before writing", async group => { await denied("a", `/api/submissions/${subA}/evaluation?teachingGroupId=${group}`, { score: 99 }); });
  it.each(["publish", "unpublish"])("A02 rejects invalid %s scope before changing releases", async action => {
    await denied("both", `/api/activities/${action === "publish" ? draft.id : shared.id}/${action}?teachingGroupId=unknown-group`, { expectedDraftRevision: 1 });
  });
  it("A02 rejects organization scope before assigning a topic", async () => {
    const topic = await success("both", `/api/subject-offerings/${O}/topics`, { title: "New topic", gradingPeriod: "midterm" });
    await denied("both", `/api/activities/${draft.id}/organization?teachingGroupId=unknown-group`, { topicId: topic.id }, "PATCH");
  });
  it("A03 denies hidden source view, direct asset and duplicate", async () => {
    await denied("a", detail(hidden.id)); await denied("a", `/api/activity-assets/${asset.id}/file`); await denied("a", `/api/activities/${hidden.id}/duplicate`, {});
  });
  it("A03 rejects inherited or explicit unauthorized destinations before copying", async () => {
    await denied("a", `/api/activities/${shared.id}/duplicate`, {});
    await denied("a", `/api/activities/${shared.id}/duplicate`, { teachingGroupIds: [A, B] });
    await denied("a", `/api/activities/${shared.id}/duplicate`, { teachingGroupIds: ["unknown-group"] });
  });
  it("preserves same-scope duplication including protected asset hashes", async () => {
    const copied = await success("b", `/api/activities/${hidden.id}/duplicate`, {});
    expect(copied.status).toBe("draft"); expect(copied.publishedScope).toEqual([]); expect(copied.assets[0].sha256).toBe(asset.sha256);
    expect(copied.targetGroups.map((g: Row) => g.id)).toEqual([B]);
    expect((await request("b", copied.assets[0].fileUrl)).bytes.toString()).toBe("Hidden B material");
  });
  it("allows explicit authorized duplication destinations without silently dropping others", async () => {
    const copy = await success("a", `/api/activities/${shared.id}/duplicate`, { teachingGroupIds: [A] });
    expect(copy.targetGroups.map((g: Row) => g.id)).toEqual([A]);
  });
  it("requires all publish destinations even for the creator", async () => {
    const sharedDraft = await success("both", "/api/activities", input("Shared draft", [A, B]));
    db.prepare("DELETE FROM faculty_group_assignments WHERE faculty_id=? AND teaching_group_id=?").run(FACULTY_ID, B);
    await denied("both", `/api/activities/${sharedDraft.id}/publish`, { expectedDraftRevision: 1 });
  });
  it("allows an instructor assigned to both labs to publish the exact immutable scope", async () => {
    const sharedDraft = await success("both", "/api/activities", input("Both publish", [A, B]));
    const result = await publishActivity(sharedDraft.id);
    expect(result.publishedScope.map((g: Row) => g.id).sort()).toEqual([A, B].sort());
  });
  it("checks unpublish against release scope even if draft targets were narrowed", async () => {
    db.prepare("DELETE FROM activity_targets WHERE activity_id=? AND teaching_group_id=?").run(shared.id, B);
    db.prepare("DELETE FROM faculty_group_assignments WHERE faculty_id=? AND teaching_group_id=?").run(FACULTY_ID, B);
    await denied("both", `/api/activities/${shared.id}/unpublish?teachingGroupId=${A}`, {});
  });
  it("preserves edit-only coauthor changes but denies publishing", async () => {
    await success("edit", `/api/activities/${draft.id}`, { ...input("Coauthor retained", [A]), baseRevision: 1 }, "PATCH");
    await denied("edit", `/api/activities/${draft.id}/publish`, { expectedDraftRevision: 2 });
  });
  it("preserves explicit same-scope publish collaborator", async () => { expect((await publishActivity(draft.id, "publish")).status).toBe("published"); });
  it("content grants without lab authority do not grant grading or delivery", async () => {
    // Actor outside has Lab B assignment and an explicit content grant on this Lab A draft.
    const read = await success("outside", detail(draft.id)); expect(read.submissions).toEqual([]);
    await success("outside", `/api/activities/${draft.id}`, { ...input("Out of scope coauthor edit", [A]), baseRevision: 1 }, "PATCH");
    await denied("outside", `/api/activities/${draft.id}/publish`, { expectedDraftRevision: 2 });
    await denied("outside", `/api/submissions/${subA}/evaluation`, { score: 9 });
  });
  it("coauthor cannot rewrite destination groups outside instructional authority", async () => {
    await denied("edit", `/api/activities/${draft.id}`, { ...input("Retarget", [A, B]), baseRevision: 1 }, "PATCH");
  });
  it("lecture-only assignment cannot read or grade lab-only evidence", async () => {
    await denied("lecture", detail(shared.id)); await denied("lecture", `/api/submissions/${subA}/file`); await denied("lecture", `/api/submissions/${subA}/evaluation`, { score: 9 });
  });
  it("deduplicates a student qualifying through multiple authorized groups", async () => {
    const enrollment = db.prepare("SELECT id FROM enrollments WHERE student_id=? AND subject_offering_id=?").get(STUDENT_ID, O)!.id;
    db.prepare("INSERT INTO student_group_placements VALUES (?,?)").run(enrollment, B);
    const result = await success("both", detail(shared.id)); expect(result.studentCount).toBe(2); expect(result.submissionCount).toBe(2); expect(result.submissions).toHaveLength(2);
  });
  it("uses submission release scopes, not mutable draft targets", async () => {
    db.prepare("DELETE FROM activity_targets WHERE activity_id=? AND teaching_group_id=?").run(shared.id, B);
    expect((await request("b", `/api/submissions/${subB}/file`)).status).toBe(200);
    db.prepare("UPDATE activities SET title='Private revised draft',status='draft' WHERE id=?").run(shared.id);
    const evidence = await success("b", detail(shared.id));
    expect(evidence.submissions.map((s: Row) => s.id)).toEqual([subB]);
    expect(evidence.title).toBe("Shared labs"); expect(evidence.permissions.canEdit).toBe(false);
    expect((await success("b", `/api/activities?${scope()}`) as unknown as Row[]).find(a => a.id === shared.id)?.submissionCount).toBe(1);
    await success("b", `/api/submissions/${subB}/evaluation`, { score: 7 });
    await denied("b", `/api/activities/${shared.id}/duplicate`, { teachingGroupIds: [B] });
    const ownSubmission = db.prepare("SELECT id FROM submissions WHERE activity_id=?").get(own.id)!.id;
    db.prepare("INSERT INTO activity_targets VALUES (?,?)").run(own.id, B);
    db.prepare("UPDATE student_group_placements SET teaching_group_id=? WHERE enrollment_id=(SELECT id FROM enrollments WHERE student_id=? AND subject_offering_id=?) AND teaching_group_id=?").run(B, STUDENT_ID, O, A);
    await denied("b", `/api/submissions/${ownSubmission}/file`);
  });
  it("organization cannot shift a hidden sibling's manual position", async () => {
    db.prepare("UPDATE activities SET manual_position=0 WHERE id=?").run(hidden.id);
    await denied("edit", `/api/subject-offerings/${O}/assessment-order`, { gradingPeriod: "midterm", entityType: "activity", entityId: draft.id, targetIndex: 0 });
  });
  it("records the unresolved shared-release transfer boundary without deleting history", async () => {
    await denied("b", `/api/submissions/${subA}/file`);
    db.prepare("UPDATE student_group_placements SET teaching_group_id=? WHERE enrollment_id=(SELECT id FROM enrollments WHERE student_id=? AND subject_offering_id=?) AND teaching_group_id=?").run(B, STUDENT_ID, O, A);
    // Explicit current-placement limitation: this schema cannot establish the old lab.
    expect((await request("b", `/api/submissions/${subA}/file`)).status).toBe(200);
    await denied("a", `/api/submissions/${subA}/file`);
    expect((await request("student", `/api/submissions/${subA}/file`)).status).toBe(200);
  });
  it("inactive enrollment and removed faculty assignment revoke faculty access, retaining student history", async () => {
    const count = db.prepare("SELECT count(*) n FROM submissions").get()!.n;
    db.prepare("UPDATE enrollments SET status='inactive' WHERE student_id=?").run(STUDENT_ID);
    await denied("a", `/api/submissions/${subA}/file`); expect((await success("a", detail(shared.id))).submissions).toHaveLength(0);
    expect((await request("student", `/api/submissions/${subA}/file`)).status).toBe(200);
    db.prepare("DELETE FROM faculty_group_assignments WHERE faculty_id=?").run(actors.b);
    await denied("b", `/api/submissions/${subB}/file`); expect(db.prepare("SELECT count(*) n FROM submissions").get()!.n).toBe(count);
  });
  it("preserves own-student downloads and release/hash/current-submission invariants", async () => {
    const before = db.prepare("SELECT release_id,sha256,is_current_submission FROM submissions WHERE id=?").get(subA)!;
    const result = await request("student", `/api/submissions/${subA}/file`);
    expect(createHash("sha256").update(result.bytes).digest("hex")).toBe(before.sha256);
    await denied("studentB", `/api/submissions/${subA}/file`);
    expect(db.prepare("SELECT release_id,sha256,is_current_submission FROM submissions WHERE id=?").get(subA)).toEqual(before);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
