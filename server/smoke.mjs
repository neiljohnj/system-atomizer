import assert from "node:assert/strict";

const base = process.env.ATOM_SMOKE_BASE || "http://127.0.0.1:4174";

function cookieJar() { return { cookie: "" }; }

async function json(path, options = {}, jar = null) {
  const headers = new Headers(options.headers);
  if (jar?.cookie) headers.set("cookie", jar.cookie);
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const setCookie = response.headers.get("set-cookie");
  if (jar && setCookie) jar.cookie = setCookie.split(";")[0];
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status} ${payload?.error || response.statusText}`);
  return payload;
}

async function expectStatus(path, status, options = {}, jar = null) {
  const headers = new Headers(options.headers);
  if (jar?.cookie) headers.set("cookie", jar.cookie);
  const response = await fetch(`${base}${path}`, { ...options, headers });
  assert.equal(response.status, status);
}

const health = await json("/api/health");
assert.equal(health.status, "ok");

const facultyJar = cookieJar();
const setup = await json("/api/setup");
assert.equal(setup.setupRequired, true, "Smoke expects a disposable fresh ATOM_ROOT");
await json("/api/setup", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ facultyId: "user-faculty-demo", displayName: "Faculty Demo", username: "faculty-demo", password: "faculty-password" }),
}, facultyJar);

const faculty = await json("/api/bootstrap", {}, facultyJar);
assert.equal(faculty.currentUser.role, "faculty");
const offering = faculty.academicTerms[0].offerings[0];
const laboratoryGroups = offering.groups.filter((group) => group.componentKind === "laboratory");
assert.equal(laboratoryGroups.length, 2);

const scope = new URLSearchParams({ subjectOfferingId: offering.id, teachingGroupId: laboratoryGroups[0].id, gradingPeriod: "midterm" });
const opensAt = new Date(Date.now() - 60_000).toISOString();
const deadlineAt = new Date(Date.now() + 86_400_000).toISOString();
const contentDocument = {
  version: 1,
  sections: [
    { id: crypto.randomUUID(), kind: "overview", title: "Activity overview", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Upload one source submission." }] }] } },
    { id: crypto.randomUUID(), kind: "requirements", title: "Requirements", content: { type: "doc", content: [{ type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Complete the requested Python source." }] }] }] }] } },
  ],
};
const partDocument = (id, title) => ({ version: 1, sections: [{ id: `${id}-requirements`, kind: "requirements", title, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `${title} smoke requirements` }] }] } }] });
const blueprint = {
  version: 1,
  mode: "progressive",
  progression: "sequential",
  parts: [
    { id: "smoke-level-1", shortLabel: "Level 1", title: "Base behavior", contentDocument: partDocument("smoke-level-1", "Base behavior") },
    { id: "smoke-level-2", shortLabel: "Level 2", title: "Extended behavior", contentDocument: partDocument("smoke-level-2", "Extended behavior") },
  ],
  submission: { version: 1, delivery: "single_file", validationMode: "strict", allowExtraFiles: false, requirements: [{ id: "smoke-source", partId: "smoke-level-1", label: "Python source", kind: "file", filenameTemplate: "solution.py", allowedExtensions: [".py"], minCount: 1, required: true }] },
  rubric: { version: 1, mode: "overall", expectedPoints: 11, visibleToStudents: true, criteria: [{ id: "smoke-correctness", partId: null, title: "Correctness", description: "", fullCreditEvidence: "Faculty confirms the required behavior.", points: 10 }] },
};
const created = await json("/api/activities", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    subjectOfferingId: offering.id,
    gradingPeriod: "midterm",
    teachingGroupIds: laboratoryGroups.map((group) => group.id),
    title: "Smoke Laboratory Activity",
    contentDocument,
    blueprint,
    opensAt,
    deadlineAt,
    acceptedExtensions: [".py", ".zip"],
    maxBytes: 10 * 1024 * 1024,
  }),
}, facultyJar);
assert.equal(created.status, "draft");
assert.equal(created.draftRevision, 1);
const activityId = created.id;

const assetForm = new FormData();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
assetForm.set("file", new Blob([png], { type: "image/png" }), "sample.png");
const asset = await json(`/api/activities/${activityId}/assets`, { method: "POST", body: assetForm }, facultyJar);
contentDocument.sections[0].content.content.push({ type: "image", attrs: { assetId: asset.id, alt: "Sample image", caption: "Smoke attachment" } });
const authored = await json(`/api/activities/${activityId}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    subjectOfferingId: offering.id,
    gradingPeriod: "midterm",
    teachingGroupIds: laboratoryGroups.map((group) => group.id),
    title: "Smoke Laboratory Activity",
    contentDocument,
    blueprint,
    opensAt,
    deadlineAt,
    acceptedExtensions: [".py"],
    maxBytes: 10 * 1024 * 1024,
    baseRevision: created.draftRevision,
  }),
}, facultyJar);
assert.equal(authored.draftRevision, 2);
await expectStatus(`/api/activities/${activityId}`, 409, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...authored, subjectOfferingId: offering.id, teachingGroupIds: laboratoryGroups.map((group) => group.id), baseRevision: 1 }),
}, facultyJar);

await expectStatus(`/api/activities/${activityId}/publish?${scope}`, 409, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ expectedDraftRevision: authored.draftRevision }),
}, facultyJar);
const published = await json(`/api/activities/${activityId}/publish?${scope}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ expectedDraftRevision: authored.draftRevision, acknowledgeRubricMismatch: true }),
}, facultyJar);
assert.equal(published.publishedScope.length, 2);
assert.equal(published.assets.length, 1);

const duplicate = await json(`/api/activities/${activityId}/duplicate`, { method: "POST" }, facultyJar);
assert.equal(duplicate.status, "draft");
assert.equal(duplicate.releaseVersion, null);
assert.equal(duplicate.assets.length, 1);

const combinedScope = new URLSearchParams({ subjectOfferingId: offering.id, teachingGroupId: "all", gradingPeriod: "midterm" });
const combined = await json(`/api/activities?${combinedScope}`, {}, facultyJar);
assert.equal(combined.find((activity) => activity.id === activityId).studentCount, 2);

await json("/api/auth/logout", { method: "POST" }, facultyJar);
await expectStatus("/api/bootstrap", 401, {}, facultyJar);

const studentJar = cookieJar();
const studentLogin = await json("/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ identifier: "2026-00001", password: "2026-00001" }),
}, studentJar);
assert.equal(studentLogin.mustChangePassword, true);
await expectStatus("/api/bootstrap", 403, {}, studentJar);
await json("/api/auth/change-password", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ currentPassword: "2026-00001", newPassword: "student-password" }),
}, studentJar);
const student = await json("/api/bootstrap", {}, studentJar);
assert.equal(student.currentUser.role, "student");
const studentActivities = await json(`/api/activities?${combinedScope}`, {}, studentJar);
assert.equal(studentActivities.filter((activity) => activity.id === activityId).length, 1);
const studentDetail = await json(`/api/activities/${activityId}?${combinedScope}`, {}, studentJar);
assert.equal(studentDetail.contentDocument.sections[0].title, "Activity overview");
assert.equal(studentDetail.assets.length, 1);

const finalScope = new URLSearchParams({ subjectOfferingId: offering.id, teachingGroupId: "all", gradingPeriod: "final_term" });
assert.ok(!(await json(`/api/activities?${finalScope}`, {}, studentJar)).some((activity) => activity.id === activityId));

const form = new FormData();
form.set("file", new Blob(["print('ATOM smoke submission')\n"], { type: "text/x-python" }), "solution.py");
form.set("completedThroughPartId", "smoke-level-1");
const submitted = await json(`/api/activities/${activityId}/submissions`, {
  method: "POST",
  headers: { "idempotency-key": "smoke-upload-1" },
  body: form,
}, studentJar);
assert.equal(submitted.currentSubmission.isCurrentSubmission, true);
assert.equal(submitted.currentSubmission.validationReport.valid, true);
assert.equal(submitted.currentSubmission.completedThroughPartId, "smoke-level-1");
const rejectedForm = new FormData();
rejectedForm.set("file", new Blob(["print('wrong name')\n"], { type: "text/x-python" }), "wrong.py");
rejectedForm.set("completedThroughPartId", "smoke-level-1");
await expectStatus(`/api/activities/${activityId}/submissions`, 422, {
  method: "POST",
  headers: { "idempotency-key": "smoke-upload-rejected" },
  body: rejectedForm,
}, studentJar);
const afterRejected = await json(`/api/activities/${activityId}?${combinedScope}`, {}, studentJar);
assert.equal(afterRejected.currentSubmission.id, submitted.currentSubmission.id);

await json("/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ identifier: "faculty-demo", password: "faculty-password" }),
}, facultyJar);
const facultyDetail = await json(`/api/activities/${activityId}?${scope}`, {}, facultyJar);
assert.equal(facultyDetail.submissions.length, 1);
const submissionId = facultyDetail.submissions[0].id;
const evaluated = await json(`/api/submissions/${submissionId}/evaluation?teachingGroupId=${laboratoryGroups[0].id}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ score: 10, manualDeduction: 1, comments: "Smoke verified", annotations: "" }),
}, facultyJar);
assert.equal(evaluated.submissions[0].evaluation.score, 10);

const download = await fetch(`${base}/api/submissions/${submissionId}/file`, { headers: { cookie: studentJar.cookie } });
assert.equal(download.status, 200);
assert.match(await download.text(), /ATOM smoke submission/);
await expectStatus(`/api/activities?subjectOfferingId=${offering.id}&teachingGroupId=unknown-group&gradingPeriod=midterm`, 403, {}, studentJar);
await expectStatus(`/api/activities?subjectOfferingId=unknown-offering&teachingGroupId=all&gradingPeriod=midterm`, 403, {}, facultyJar);

console.log("ATOM smoke workflow passed: setup → progressive authoring → asset → rubric acknowledgement → publish → student part claim → strict validation → submission → switch account → evaluation");
