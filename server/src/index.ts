import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, open, rename, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, relative } from "node:path";
import multer from "multer";
import {
  legacyActivityDocument,
  legacyFieldsFromDocument,
  normalizeLegacySubmissionTerminology,
  referencedAssetIds,
  validateActivityDocument,
  type ActivityDocumentV1,
} from "./activity-content.js";
import {
  blueprintDocuments,
  defaultActivityBlueprint,
  publishBlueprintWarnings,
  validateActivityBlueprint,
  type ActivityBlueprintV1,
} from "./activity-blueprint.js";
import { applyManualPositions, overviewExcerpt, scheduleState } from "./assessment-stream.js";
import { AuthService, type AuthUser, userFromRow } from "./auth.js";
import { openAtomDatabase } from "./db.js";
import { storageRoot as resolveStorageRoot } from "./storage-root.js";
import { seedDemoAccounts } from "./demo-accounts.js";
import { HttpError } from "./errors.js";
import { InstructorAuthority } from "./instructor-authority.js";
import { configuredAllowedOrigins, isAllowedMutationOrigin } from "./request-security.js";
import {
  cleanOriginalFilename,
  extensionOf,
  normalizeSubmissionFilename,
  safeStoredFile,
  sha256File,
} from "./files.js";
import { validateSubmissionFile } from "./submission-validation.js";

type Row = Record<string, unknown>;
type GradingPeriod = "midterm" | "final_term";

interface ActivitySnapshot {
  documentVersion?: 1;
  contentDocument?: ActivityDocumentV1;
  title: string;
  instructions: string;
  requirements: string[];
  opensAt: string;
  deadlineAt: string;
  acceptedExtensions: string[];
  maxBytes: number;
  blueprint?: ActivityBlueprintV1;
  assets?: Array<{
    id: string;
    kind: string;
    originalFilename: string;
    normalizedFilename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }>;
}

interface ActivityScope {
  subjectOfferingId: string;
  teachingGroupId: string | null;
  gradingPeriod: GradingPeriod;
}

const applicationRoot = process.cwd();
const storageRoot = resolveStorageRoot();
const developmentPreviewEnabled = process.env.ATOM_DEVELOPMENT_PREVIEW === "true";
const secureCookies = process.env.ATOM_HTTPS === "true";
const allowedOrigins = configuredAllowedOrigins(process.env.ATOM_ALLOWED_ORIGINS);
const { db, dataDir } = openAtomDatabase(storageRoot);
const demoAccountsEnabled = process.argv.includes("--demo-accounts");
if (demoAccountsEnabled) seedDemoAccounts(db);
const uploadsDir = join(dataDir, "uploads");
const tempDir = join(dataDir, "tmp");
const assetsDir = join(dataDir, "activity-assets");
await mkdir(uploadsDir, { recursive: true });
await mkdir(tempDir, { recursive: true });
await mkdir(assetsDir, { recursive: true });
const auth = new AuthService(db, { developmentPreviewEnabled, secureCookies, behindProxy: process.env.ATOM_BEHIND_PROXY === "true" });
const instructorAuthority = new InstructorAuthority(db);

const upload = multer({
  dest: tempDir,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!extensionOf(file.originalname)) {
      callback(new HttpError(415, "Only .py and .zip files are accepted"));
      return;
    }
    callback(null, true);
  },
});

const assetUpload = multer({
  dest: tempDir,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use((request, _response, next) => {
  if (!request.path.startsWith("/api/") || ["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }
  const origin = request.header("origin");
  if (!origin) {
    next();
    return;
  }
  if (!isAllowedMutationOrigin({
    origin,
    host: request.header("host"),
    forwardedHost: request.header("x-forwarded-host"),
    forwardedProtocol: request.header("x-forwarded-proto"),
    secureCookies,
    allowedOrigins,
  })) {
    next(new HttpError(403, "Cross-origin requests are not allowed"));
    return;
  }
  next();
});

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    storage: "sqlite",
    transportSecurity: secureCookies ? "https" : "http_warning",
    serverTime: new Date().toISOString(),
  });
});

app.get("/api/auth/session", (request, response) => {
  const session = auth.optionalSession(request);
  response.setHeader("cache-control", "no-store");
  response.json({
    authenticated: Boolean(session),
    setupRequired: auth.setupStatus().setupRequired,
    httpWarning: !secureCookies,
    demoAccountsEnabled,
    ...(session ?? {}),
  });
});

app.post("/api/auth/login", async (request, response) => {
  const session = await auth.login(request, response, request.body as Record<string, unknown>);
  response.setHeader("cache-control", "no-store");
  response.json({ authenticated: true, setupRequired: false, httpWarning: !secureCookies, demoAccountsEnabled, ...session });
});

app.post("/api/auth/logout", (request, response) => {
  auth.logout(request, response);
  response.setHeader("cache-control", "no-store");
  response.status(204).end();
});

app.post("/api/auth/change-password", async (request, response) => {
  const session = await auth.changePassword(request, request.body as Record<string, unknown>);
  response.setHeader("cache-control", "no-store");
  response.json({ authenticated: true, setupRequired: false, httpWarning: !secureCookies, ...session });
});

app.get("/api/setup", (_request, response) => {
  response.setHeader("cache-control", "no-store");
  response.json(auth.setupStatus());
});

app.post("/api/setup", (request, response) => {
  const session = auth.initialize(request, response, request.body as Record<string, unknown>);
  response.setHeader("cache-control", "no-store");
  response.status(201).json({ authenticated: true, setupRequired: false, httpWarning: !secureCookies, ...session });
});

app.get("/api/local-recovery/faculty", (request, response) => {
  response.setHeader("cache-control", "no-store");
  response.json(auth.listRecoverableFaculty(request));
});

app.post("/api/local-recovery/faculty/:facultyId/reset", (request, response) => {
  response.setHeader("cache-control", "no-store");
  response.json(auth.resetFaculty(request, routeParam(request, "facultyId")));
});

app.post("/api/development/assume-identity", (request, response) => {
  const userId = requiredText((request.body as Record<string, unknown>).userId, "Preview identity");
  response.setHeader("cache-control", "no-store");
  response.json({
    authenticated: true,
    setupRequired: false,
    httpWarning: !secureCookies,
    ...auth.assumeIdentity(request, response, userId),
  });
});

app.get("/api/bootstrap", (request, response) => {
  const user = resolveUser(request);
  response.setHeader("cache-control", "no-store");
  response.json({
    currentUser: user,
    academicTerms: listAcademicTerms(user),
    moduleAvailability: {
      activities: true,
      quizzes: false,
      exams: false,
      submissions: user.role === "faculty",
    },
    previewIdentities: developmentPreviewEnabled ? groupPreviewIdentities() : null,
    httpWarning: !secureCookies,
    serverTime: new Date().toISOString(),
  });
});

app.get("/api/activities", (request, response) => {
  const user = resolveUser(request);
  const scope = activityScope(request, user);
  response.json(listActivities(user, scope));
});

app.get("/api/subject-offerings/:offeringId/assessment-stream", (request, response) => {
  const user = resolveUser(request);
  const offeringId = routeParam(request, "offeringId");
  const module = optionalQuery(request, "module") || "activities";
  if (module !== "activities") throw new HttpError(400, "Only the activity stream is enabled in this release");
  const scope = streamScope(request, user, offeringId);
  response.json(assessmentStream(user, scope));
});

app.post("/api/subject-offerings/:offeringId/topics", (request, response) => {
  const user = requireFaculty(request);
  const offeringId = routeParam(request, "offeringId");
  assertOfferingAccess(user, offeringId);
  const body = request.body as Record<string, unknown>;
  const gradingPeriod = requiredGradingPeriod(body.gradingPeriod);
  const title = topicTitle(body.title);
  assertUniqueTopicTitle(offeringId, gradingPeriod, title);
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO assessment_topics (
      id, subject_offering_id, grading_period, title, manual_position,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(id, offeringId, gradingPeriod, title, user.id, now, now);
  auditOrganization(request, user, "assessment_topic_created", { topicId: id, offeringId, gradingPeriod, title });
  response.status(201).json(topicFromRow(getTopicRow(id)));
});

app.patch("/api/topics/:topicId", (request, response) => {
  const user = requireFaculty(request);
  const topic = getTopicRow(routeParam(request, "topicId"));
  assertOfferingAccess(user, String(topic.subject_offering_id));
  const title = topicTitle((request.body as Record<string, unknown>).title);
  assertUniqueTopicTitle(String(topic.subject_offering_id), String(topic.grading_period) as GradingPeriod, title, String(topic.id));
  db.prepare("UPDATE assessment_topics SET title = ?, updated_at = ? WHERE id = ?")
    .run(title, new Date().toISOString(), String(topic.id));
  auditOrganization(request, user, "assessment_topic_renamed", { topicId: String(topic.id), title });
  response.json(topicFromRow(getTopicRow(String(topic.id))));
});

app.delete("/api/topics/:topicId", (request, response) => {
  const user = requireFaculty(request);
  const topic = getTopicRow(routeParam(request, "topicId"));
  assertOfferingAccess(user, String(topic.subject_offering_id));
  const activities = db.prepare("SELECT * FROM activities WHERE topic_id = ?").all(String(topic.id)) as Row[];
  for (const activity of activities) assertActivityPermission(activity, user, "edit");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE activities SET topic_id = NULL, manual_position = NULL, updated_at = ? WHERE topic_id = ?")
      .run(new Date().toISOString(), String(topic.id));
    db.prepare("DELETE FROM assessment_topics WHERE id = ?").run(String(topic.id));
    insertOrganizationAudit(user, "assessment_topic_deleted", {
      topicId: String(topic.id),
      offeringId: String(topic.subject_offering_id),
      gradingPeriod: String(topic.grading_period),
      reassignedActivityCount: activities.length,
    }, request.ip ?? "");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  response.status(204).end();
});

app.patch("/api/activities/:activityId/organization", (request, response) => {
  const user = requireFaculty(request);
  const activity = getActivityRow(routeParam(request, "activityId"));
  assertOfferingAccess(user, String(activity.subject_offering_id));
  assertActivityPermission(activity, user, "edit");
  const scope = preflightActivityResponse(request, user, activity);
  const topicValue = (request.body as Record<string, unknown>).topicId;
  const topicId = topicValue === null || topicValue === undefined || topicValue === "" ? null : requiredText(topicValue, "Topic");
  if (topicId) {
    const topic = getTopicRow(topicId);
    if (String(topic.subject_offering_id) !== String(activity.subject_offering_id)
      || String(topic.grading_period) !== String(activity.grading_period)) {
      throw new HttpError(400, "Select a topic from the same subject and grading period");
    }
  }
  db.prepare("UPDATE activities SET topic_id = ?, manual_position = NULL, updated_at = ? WHERE id = ?")
    .run(topicId, new Date().toISOString(), String(activity.id));
  auditOrganization(request, user, "activity_topic_changed", { activityId: String(activity.id), topicId });
  response.json(getActivityDetail(String(activity.id), user, scope));
});

app.post("/api/subject-offerings/:offeringId/assessment-order", (request, response) => {
  const user = requireFaculty(request);
  const offeringId = routeParam(request, "offeringId");
  assertOfferingAccess(user, offeringId);
  const body = request.body as Record<string, unknown>;
  const gradingPeriod = requiredGradingPeriod(body.gradingPeriod);
  const entityType = body.entityType;
  const entityId = requiredText(body.entityId, "Assessment stream item");
  const targetIndex = nonNegativeInteger(body.targetIndex, "Target position");
  if (entityType === "topic") {
    const topic = getTopicRow(entityId);
    assertTopicScope(topic, offeringId, gradingPeriod);
    moveManualEntity("assessment_topics", entityId, targetIndex, "subject_offering_id = ? AND grading_period = ?", [offeringId, gradingPeriod]);
  } else if (entityType === "activity") {
    const activity = getActivityRow(entityId);
    if (String(activity.subject_offering_id) !== offeringId || String(activity.grading_period) !== gradingPeriod) {
      throw new HttpError(404, "Activity not found in this assessment stream");
    }
    assertActivityPermission(activity, user, "edit");
    const topicId = activity.topic_id ? String(activity.topic_id) : null;
    moveActivity(activity, targetIndex, topicId, user);
  } else {
    throw new HttpError(400, "Ordering supports topics or activities");
  }
  auditOrganization(request, user, "assessment_stream_reordered", { offeringId, gradingPeriod, entityType, entityId, targetIndex });
  response.json(assessmentStream(user, { subjectOfferingId: offeringId, teachingGroupId: null, gradingPeriod }));
});

app.post("/api/subject-offerings/:offeringId/assessment-order/reset", (request, response) => {
  const user = requireFaculty(request);
  const offeringId = routeParam(request, "offeringId");
  assertOfferingAccess(user, offeringId);
  const body = request.body as Record<string, unknown>;
  const gradingPeriod = requiredGradingPeriod(body.gradingPeriod);
  const entityType = body.entityType;
  const entityId = typeof body.entityId === "string" ? body.entityId : null;
  if (entityType === "topic" && entityId) {
    const topic = getTopicRow(entityId);
    assertTopicScope(topic, offeringId, gradingPeriod);
    db.prepare("UPDATE assessment_topics SET manual_position = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), entityId);
  } else if (entityType === "activity" && entityId) {
    const activity = getActivityRow(entityId);
    assertActivityPermission(activity, user, "edit");
    if (String(activity.subject_offering_id) !== offeringId || String(activity.grading_period) !== gradingPeriod) throw new HttpError(404, "Activity not found in this assessment stream");
    db.prepare("UPDATE activities SET manual_position = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), entityId);
  } else if (entityType === "all") {
    const activities = db.prepare("SELECT * FROM activities WHERE subject_offering_id = ? AND grading_period = ?")
      .all(offeringId, gradingPeriod) as Row[];
    for (const activity of activities) assertActivityPermission(activity, user, "edit");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE assessment_topics SET manual_position = NULL, updated_at = ? WHERE subject_offering_id = ? AND grading_period = ?")
        .run(new Date().toISOString(), offeringId, gradingPeriod);
      db.prepare("UPDATE activities SET manual_position = NULL, updated_at = ? WHERE subject_offering_id = ? AND grading_period = ?")
        .run(new Date().toISOString(), offeringId, gradingPeriod);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } else {
    throw new HttpError(400, "Select an item or reset the entire stream");
  }
  auditOrganization(request, user, "assessment_stream_order_reset", { offeringId, gradingPeriod, entityType, entityId });
  response.json(assessmentStream(user, { subjectOfferingId: offeringId, teachingGroupId: null, gradingPeriod }));
});

app.get("/api/activities/:activityId", (request, response) => {
  const user = resolveUser(request);
  const scope = activityScope(request, user);
  response.json(getActivityDetail(routeParam(request, "activityId"), user, scope));
});

app.get("/api/subject-offerings/:offeringId/students", (request, response) => {
  const user = requireFaculty(request);
  const offeringId = routeParam(request, "offeringId");
  assertOfferingAccess(user, offeringId);
  response.json(listManagedStudents(user.id, offeringId));
});

app.post("/api/subject-offerings/:offeringId/students/:studentId/reset-password", (request, response) => {
  const user = requireFaculty(request);
  const offeringId = routeParam(request, "offeringId");
  const studentId = routeParam(request, "studentId");
  assertOfferingAccess(user, offeringId);
  if (!facultySharesStudentGroup(user.id, offeringId, studentId)) {
    throw new HttpError(403, "You may reset only students in your assigned teaching groups");
  }
  auth.resetStudent(request, user, studentId);
  response.status(204).end();
});

app.post("/api/activities", (request, response) => {
  const user = requireFaculty(request);
  const body = request.body as Record<string, unknown>;
  const input = activityInput(body, user);
  const now = new Date().toISOString();
  const id = randomUUID();
  const legacySubjectId = legacySubjectForOffering(input.subjectOfferingId);
  const requestedTopicId = typeof body.topicId === "string" && body.topicId.trim() ? body.topicId.trim() : null;
  if (requestedTopicId) {
    const topic = getTopicRow(requestedTopicId);
    assertTopicScope(topic, input.subjectOfferingId, input.gradingPeriod);
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO activities (
        id, subject_id, subject_offering_id, grading_period, title, instructions,
        requirements_json, opens_at, deadline_at, status, max_bytes, created_by,
        created_at, updated_at, content_json, draft_revision, accepted_extensions_json,
        last_edited_by, topic_id, manual_position, blueprint_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?)
    `).run(
      id,
      legacySubjectId,
      input.subjectOfferingId,
      input.gradingPeriod,
      input.title,
      input.instructions,
      JSON.stringify(input.requirements),
      input.opensAt,
      input.deadlineAt,
      input.maxBytes,
      user.id,
      now,
      now,
      JSON.stringify(input.contentDocument),
      JSON.stringify(input.acceptedExtensions),
      user.id,
      requestedTopicId,
      JSON.stringify(input.blueprint),
    );
    replaceActivityTargets(id, input.teachingGroupIds);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  response.status(201).json(getActivityDetail(id, user, {
    subjectOfferingId: input.subjectOfferingId,
    teachingGroupId: input.teachingGroupIds[0],
    gradingPeriod: input.gradingPeriod,
  }));
});

app.patch("/api/activities/:activityId", (request, response) => {
  const user = requireFaculty(request);
  const activityId = routeParam(request, "activityId");
  const existing = getActivityRow(activityId);
  assertOfferingAccess(user, String(existing.subject_offering_id));
  assertActivityPermission(existing, user, "edit");
  const scope = preflightActivityResponse(request, user, existing);
  if (String(existing.status) !== "draft") {
    throw new HttpError(409, "Unpublish the activity before editing its draft");
  }

  const body = request.body as Record<string, unknown>;
  const baseRevision = Number(body.baseRevision);
  const serverRevision = Number(existing.draft_revision);
  if (!Number.isInteger(baseRevision) || baseRevision !== serverRevision) {
    const editor = existing.last_edited_by
      ? db.prepare("SELECT display_name FROM users WHERE id = ?").get(String(existing.last_edited_by)) as Row | undefined
      : undefined;
    throw new HttpError(409, "This draft changed somewhere else", "draft_conflict", {
      serverRevision,
      updatedAt: String(existing.updated_at),
      updatedBy: editor ? String(editor.display_name) : null,
    });
  }
  const input = activityInput(body, user, { allowOfferingGroups: true });
  const oldTargets = activityTargetRows(activityId).map((target) => String(target.id));
  if (JSON.stringify([...oldTargets].sort()) !== JSON.stringify([...input.teachingGroupIds].sort())) {
    instructorAuthority.assertDestinations(user, String(existing.subject_offering_id), [...new Set([...oldTargets, ...input.teachingGroupIds])]);
  }
  assertDocumentAssets(activityId, input.contentDocument);
  for (const document of blueprintDocuments(input.blueprint)) assertDocumentAssets(activityId, document);
  if (input.subjectOfferingId !== String(existing.subject_offering_id)) {
    throw new HttpError(409, "Move between subject offerings is not supported");
  }
  const nextTopic = body.topicId === undefined
    ? compatibleTopicId(existing.topic_id, input.subjectOfferingId, input.gradingPeriod)
    : body.topicId === null || body.topicId === "" ? null : requiredText(body.topicId, "Topic");
  if (nextTopic) assertTopicScope(getTopicRow(nextTopic), input.subjectOfferingId, input.gradingPeriod);

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE activities SET
        grading_period = ?, title = ?, instructions = ?, requirements_json = ?,
        opens_at = ?, deadline_at = ?, max_bytes = ?, content_json = ?,
        accepted_extensions_json = ?, draft_revision = draft_revision + 1,
        blueprint_json = ?, last_edited_by = ?, updated_at = ?, topic_id = ?
      WHERE id = ?
    `).run(
      input.gradingPeriod,
      input.title,
      input.instructions,
      JSON.stringify(input.requirements),
      input.opensAt,
      input.deadlineAt,
      input.maxBytes,
      JSON.stringify(input.contentDocument),
      JSON.stringify(input.acceptedExtensions),
      JSON.stringify(input.blueprint),
      user.id,
      new Date().toISOString(),
      nextTopic,
      activityId,
    );
    replaceActivityTargets(activityId, input.teachingGroupIds);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  response.json(getActivityDetail(activityId, user, {
    ...scope,
    gradingPeriod: input.gradingPeriod,
  }));
});

app.post("/api/activities/:activityId/publish", (request, response) => {
  const user = requireFaculty(request);
  const activityId = routeParam(request, "activityId");
  const activity = getActivityRow(activityId);
  const offeringId = String(activity.subject_offering_id);
  assertOfferingAccess(user, offeringId);
  assertActivityPermission(activity, user, "publish");
  const scope = preflightActivityResponse(request, user, activity);
  if (String(activity.status) !== "draft") throw new HttpError(409, "This activity is already published");
  const expectedDraftRevision = Number((request.body as Record<string, unknown>)?.expectedDraftRevision);
  if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision !== Number(activity.draft_revision)) {
    throw new HttpError(409, "Refresh the activity before publishing", "draft_conflict", {
      serverRevision: Number(activity.draft_revision),
      updatedAt: String(activity.updated_at),
    });
  }
  const opensAt = String(activity.opens_at);
  const deadlineAt = String(activity.deadline_at);
  ensureDateOrder(opensAt, deadlineAt);
  const targets = activityTargetRows(activityId);
  if (!targets.length) throw new HttpError(409, "Select at least one teaching group before publishing");
  instructorAuthority.assertDestinations(user, offeringId, targets.map((target) => String(target.id)));
  for (const target of targets) assertGroupBelongsToOffering(offeringId, String(target.id));
  const blueprint = activityBlueprintFromRow(activity);
  const blueprintWarnings = publishBlueprintWarnings(blueprint);
  if (blueprintWarnings.length && (request.body as Record<string, unknown>)?.acknowledgeRubricMismatch !== true) {
    throw new HttpError(409, "Review the rubric total before publishing", "rubric_total_mismatch", { warnings: blueprintWarnings });
  }

  const versionRow = db.prepare(`
    SELECT COALESCE(MAX(version), 0) + 1 AS version
    FROM activity_releases WHERE activity_id = ?
  `).get(activityId) as { version: number };
  const releaseId = randomUUID();
  const publishedAt = new Date().toISOString();
  const assets = listActivityAssetRows(activityId);
  const snapshot: ActivitySnapshot = {
    documentVersion: 1,
    contentDocument: activityDocumentFromRow(activity),
    title: String(activity.title),
    instructions: String(activity.instructions),
    requirements: parseStringArray(String(activity.requirements_json)),
    opensAt,
    deadlineAt,
    acceptedExtensions: parseAcceptedExtensions(String(activity.accepted_extensions_json)),
    maxBytes: Number(activity.max_bytes),
    blueprint,
    assets: assets.map((asset) => ({
      id: String(asset.id),
      kind: String(asset.kind),
      originalFilename: String(asset.original_filename),
      normalizedFilename: String(asset.normalized_filename),
      mimeType: String(asset.mime_type),
      sizeBytes: Number(asset.size_bytes),
      sha256: String(asset.sha256),
    })),
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO activity_releases (id, activity_id, version, snapshot_json, published_at, published_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(releaseId, activityId, versionRow.version, JSON.stringify(snapshot), publishedAt, user.id);
    const insertScope = db.prepare(`
      INSERT INTO activity_release_scopes (release_id, teaching_group_id, grading_period)
      VALUES (?, ?, ?)
    `);
    for (const target of targets) {
      insertScope.run(releaseId, String(target.id), String(activity.grading_period));
    }
    const insertAsset = db.prepare(`
      INSERT INTO activity_release_assets (
        release_id, asset_id, original_filename, normalized_filename, stored_path,
        mime_type, size_bytes, sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const asset of assets) {
      insertAsset.run(
        releaseId,
        String(asset.id),
        String(asset.original_filename),
        String(asset.normalized_filename),
        String(asset.stored_path),
        String(asset.mime_type),
        Number(asset.size_bytes),
        String(asset.sha256),
      );
    }
    db.prepare(`
      UPDATE activities SET status = 'published', current_release_id = ?, updated_at = ? WHERE id = ?
    `).run(releaseId, publishedAt, activityId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  response.json(getActivityDetail(activityId, user, scope));
});

app.post("/api/activities/:activityId/unpublish", (request, response) => {
  const user = requireFaculty(request);
  const activityId = routeParam(request, "activityId");
  const activity = getActivityRow(activityId);
  assertOfferingAccess(user, String(activity.subject_offering_id));
  assertActivityPermission(activity, user, "publish");
  const scope = preflightActivityResponse(request, user, activity);
  if (String(activity.status) !== "published" || !activity.current_release_id) throw new HttpError(409, "This activity is not published");
  instructorAuthority.assertDestinations(user, String(activity.subject_offering_id),
    releaseScopeRows(String(activity.current_release_id)).map((group) => String(group.id)));
  db.prepare("UPDATE activities SET status = 'draft', updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    activityId,
  );
  response.json(getActivityDetail(activityId, user, scope));
});

app.post("/api/activities/:activityId/duplicate", async (request, response) => {
  const user = requireFaculty(request);
  const sourceId = routeParam(request, "activityId");
  const source = getActivityRow(sourceId);
  const offeringId = String(source.subject_offering_id);
  assertOfferingAccess(user, offeringId);
  instructorAuthority.assertRead(source, user);
  const scope = preflightActivityResponse(request, user, source);
  const sourceTargets = activityTargetRows(sourceId).map((target) => String(target.id));
  const requestedTargets = (request.body as Record<string, unknown> | undefined)?.teachingGroupIds;
  if (requestedTargets !== undefined && (!Array.isArray(requestedTargets) || !requestedTargets.length
    || requestedTargets.some((value) => typeof value !== "string" || !value.trim()))) {
    throw new HttpError(400, "Select at least one valid destination teaching group");
  }
  const destinationIds = requestedTargets === undefined ? sourceTargets : uniqueStringArray(requestedTargets);
  instructorAuthority.assertDestinations(user, offeringId, destinationIds);
  if (scope.teachingGroupId && !destinationIds.includes(scope.teachingGroupId)) {
    throw new HttpError(400, "The selected response group must be a destination");
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const sourceAssets = listActivityAssetRows(sourceId);
  const sourceVersion = JSON.stringify([source, sourceTargets, sourceAssets]);
  const assetIdMap = new Map<string, string>();
  const copiedAssets: Array<Row & { newId: string; storedPath: string }> = [];
  try {
    for (const asset of sourceAssets) {
      const newId = randomUUID();
      const storedPath = relative(dataDir, join(assetsDir, id, newId, String(asset.normalized_filename)));
      const sourcePath = safeStoredFile(dataDir, String(asset.stored_path));
      const destinationPath = safeStoredFile(dataDir, storedPath);
      await mkdir(dirname(destinationPath), { recursive: true });
      await copyFile(sourcePath, destinationPath);
      assetIdMap.set(String(asset.id), newId);
      copiedAssets.push({ ...asset, newId, storedPath });
    }
    const content = remapDocumentAssets(activityDocumentFromRow(source), assetIdMap);
    const blueprint = remapBlueprintAssets(activityBlueprintFromRow(source), assetIdMap);
    const legacy = legacyFieldsFromDocument(content);
    // Copying yields to other requests. Recheck the session, grants and source before any database write.
    const currentUser = requireFaculty(request);
    const currentSource = getActivityRow(sourceId);
    instructorAuthority.assertRead(currentSource, currentUser);
    instructorAuthority.assertDestinations(currentUser, offeringId, destinationIds);
    preflightActivityResponse(request, currentUser, currentSource);
    if (JSON.stringify([currentSource, activityTargetRows(sourceId).map((target) => String(target.id)), listActivityAssetRows(sourceId)]) !== sourceVersion) {
      throw new HttpError(409, "The source activity changed. Review it before duplicating again");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        INSERT INTO activities (
          id, subject_id, subject_offering_id, grading_period, title, instructions,
          requirements_json, opens_at, deadline_at, status, current_release_id, max_bytes,
          created_by, created_at, updated_at, content_json, draft_revision,
          accepted_extensions_json, last_edited_by, topic_id, manual_position
          , blueprint_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?)
      `).run(
        id,
        String(source.subject_id),
        offeringId,
        String(source.grading_period),
        `Copy of ${String(source.title)}`.slice(0, 200),
        legacy.instructions,
        JSON.stringify(legacy.requirements),
        String(source.opens_at),
        String(source.deadline_at),
        Number(source.max_bytes),
        user.id,
        now,
        now,
        JSON.stringify(content),
        String(source.accepted_extensions_json),
        user.id,
        compatibleTopicId(source.topic_id, offeringId, String(source.grading_period) as GradingPeriod),
        JSON.stringify(blueprint),
      );
      for (const targetId of destinationIds) {
        db.prepare("INSERT INTO activity_targets (activity_id, teaching_group_id) VALUES (?, ?)").run(id, targetId);
      }
      const insertAsset = db.prepare(`
        INSERT INTO activity_assets (
          id, activity_id, uploaded_by, kind, original_filename, normalized_filename,
          stored_path, mime_type, size_bytes, sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const asset of copiedAssets) {
        insertAsset.run(
          asset.newId,
          id,
          user.id,
          String(asset.kind),
          String(asset.original_filename),
          String(asset.normalized_filename),
          asset.storedPath,
          String(asset.mime_type),
          Number(asset.size_bytes),
          String(asset.sha256),
          now,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    await rm(join(assetsDir, id), { recursive: true, force: true });
    throw error;
  }
  response.status(201).json(getActivityDetail(id, user, {
    ...scope,
  }));
});

app.post("/api/activities/:activityId/assets", (request, _response, next) => {
  const user = requireFaculty(request);
  const activity = getActivityRow(routeParam(request, "activityId"));
  assertActivityPermission(activity, user, "edit");
  if (String(activity.status) !== "draft") throw new HttpError(409, "Unpublish the activity before adding materials");
  next();
}, assetUpload.single("file"), async (request, response, next) => {
  const tempPath = request.file?.path;
  let finalPath: string | null = null;
  let recorded = false;
  try {
    const user = requireFaculty(request);
    const activityId = routeParam(request, "activityId");
    const activity = getActivityRow(activityId);
    assertOfferingAccess(user, String(activity.subject_offering_id));
    assertActivityPermission(activity, user, "edit");
    if (String(activity.status) !== "draft") throw new HttpError(409, "Unpublish the activity before adding materials");
    if (!request.file || !tempPath) throw new HttpError(400, "Select a teaching file to upload");
    const detected = await inspectActivityAsset(tempPath, request.file.originalname, request.file.size);
    const assetId = randomUUID();
    const normalizedFilename = normalizeAssetFilename(request.file.originalname);
    finalPath = join(assetsDir, activityId, assetId, normalizedFilename);
    await mkdir(dirname(finalPath), { recursive: true });
    const checksum = await sha256File(tempPath);
    await rename(tempPath, finalPath);
    const currentUser = requireFaculty(request);
    const currentActivity = getActivityRow(activityId);
    assertActivityPermission(currentActivity, currentUser, "edit");
    if (String(currentActivity.status) !== "draft") throw new HttpError(409, "Unpublish the activity before adding materials");
    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO activity_assets (
        id, activity_id, uploaded_by, kind, original_filename, normalized_filename,
        stored_path, mime_type, size_bytes, sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      assetId,
      activityId,
      user.id,
      detected.kind,
      cleanOriginalFilename(request.file.originalname),
      normalizedFilename,
      relative(dataDir, finalPath),
      detected.mimeType,
      request.file.size,
      checksum,
      createdAt,
    );
    recorded = true;
    response.status(201).json(assetFromRow(getActivityAssetRow(assetId)));
  } catch (error) {
    if (finalPath && !recorded) await rm(finalPath, { force: true });
    if (tempPath) await rm(tempPath, { force: true });
    next(error);
  }
});

app.delete("/api/activities/:activityId/assets/:assetId", async (request, response) => {
  const user = requireFaculty(request);
  const activityId = routeParam(request, "activityId");
  const assetId = routeParam(request, "assetId");
  const activity = getActivityRow(activityId);
  assertOfferingAccess(user, String(activity.subject_offering_id));
  assertActivityPermission(activity, user, "edit");
  if (String(activity.status) !== "draft") throw new HttpError(409, "Unpublish the activity before removing materials");
  const asset = getActivityAssetRow(assetId);
  if (String(asset.activity_id) !== activityId) throw new HttpError(404, "Teaching file not found");
  const released = db.prepare("SELECT 1 FROM activity_release_assets WHERE asset_id = ? LIMIT 1").get(assetId);
  if (released) throw new HttpError(409, "This file belongs to an immutable release and cannot be deleted");
  const document = activityDocumentFromRow(activity);
  if (referencedAssetIds(document).has(assetId)) throw new HttpError(409, "Remove this file from the activity content before deleting it");
  if (blueprintDocuments(activityBlueprintFromRow(activity)).some((partDocument) => referencedAssetIds(partDocument).has(assetId))) {
    throw new HttpError(409, "Remove this file from the activity parts before deleting it");
  }
  db.prepare("DELETE FROM activity_assets WHERE id = ?").run(assetId);
  await rm(safeStoredFile(dataDir, String(asset.stored_path)), { force: true });
  response.status(204).end();
});

app.get("/api/activity-assets/:assetId/file", (request, response, next) => {
  const user = resolveUser(request);
  const asset = getActivityAssetRow(routeParam(request, "assetId"));
  const activity = getActivityRow(String(asset.activity_id));
  if (user.role === "faculty") {
    if (!instructorAuthority.canRead(activity, user)) {
      const filter = instructorAuthority.submissionFilter(user);
      const released = db.prepare(`SELECT 1 FROM submissions s JOIN activities a ON a.id=s.activity_id
        JOIN activity_release_assets ra ON ra.release_id=s.release_id
        WHERE ra.asset_id=? AND ${filter.sql} LIMIT 1`).get(String(asset.id), ...filter.params);
      if (!released) throw new HttpError(404, "Teaching file not found");
    }
  } else {
    if (!activity.current_release_id) throw new HttpError(404, "Teaching file not found");
    assertStudentReleaseAccess(user.id, String(activity.current_release_id));
    const release = db.prepare("SELECT snapshot_json FROM activity_releases WHERE id = ?")
      .get(String(activity.current_release_id)) as Row | undefined;
    if (!release) throw new HttpError(404, "Teaching file not found");
    const snapshot = JSON.parse(String(release.snapshot_json)) as ActivitySnapshot;
    if (Date.now() < Date.parse(snapshot.opensAt)) throw new HttpError(403, "Teaching files become available when the activity opens");
    const released = db.prepare(`
      SELECT 1 FROM activity_release_assets WHERE release_id = ? AND asset_id = ?
    `).get(String(activity.current_release_id), String(asset.id));
    if (!released) throw new HttpError(404, "Teaching file not found");
  }
  const path = safeStoredFile(dataDir, String(asset.stored_path));
  if (!existsSync(path)) throw new HttpError(410, "The stored teaching file is missing");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("cache-control", "private, no-store");
  response.setHeader("content-type", String(asset.mime_type));
  response.setHeader("content-length", String(asset.size_bytes));
  const disposition = String(asset.kind) === "image" ? "inline" : "attachment";
  response.setHeader("content-disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(String(asset.normalized_filename))}`);
  createReadStream(path).on("error", next).pipe(response);
});

app.put("/api/activities/:activityId/collaborators/:facultyId", (request, response) => {
  const user = requireFaculty(request);
  const activityId = routeParam(request, "activityId");
  const facultyId = routeParam(request, "facultyId");
  const activity = getActivityRow(activityId);
  assertActivityCreator(activity, user);
  if (facultyId === user.id) throw new HttpError(400, "The creator already has full activity permissions");
  if (!facultyAssignedToOffering(facultyId, String(activity.subject_offering_id))) {
    throw new HttpError(400, "Select a faculty member assigned to this subject offering");
  }
  const body = request.body as Record<string, unknown>;
  const canEdit = body.canEdit === true;
  const canPublish = body.canPublish === true;
  if (!canEdit && !canPublish) throw new HttpError(400, "Grant at least one collaborator permission");
  db.prepare(`
    INSERT INTO activity_collaborators (
      activity_id, faculty_id, can_edit, can_publish, added_by, added_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(activity_id, faculty_id) DO UPDATE SET
      can_edit = excluded.can_edit, can_publish = excluded.can_publish,
      added_by = excluded.added_by, added_at = excluded.added_at
  `).run(activityId, facultyId, canEdit ? 1 : 0, canPublish ? 1 : 0, user.id, new Date().toISOString());
  response.json(listActivityCollaborators(activityId));
});

app.delete("/api/activities/:activityId/collaborators/:facultyId", (request, response) => {
  const user = requireFaculty(request);
  const activity = getActivityRow(routeParam(request, "activityId"));
  assertActivityCreator(activity, user);
  db.prepare("DELETE FROM activity_collaborators WHERE activity_id = ? AND faculty_id = ?").run(
    String(activity.id),
    routeParam(request, "facultyId"),
  );
  response.json(listActivityCollaborators(String(activity.id)));
});

const submissionReceipts = new WeakMap<Request, ReturnType<typeof submissionReceiptContext>>();
app.post(
  "/api/activities/:activityId/submissions",
  (request, _response, next) => { submissionReceipts.set(request, submissionReceiptContext(request)); next(); },
  upload.single("file"),
  async (request, response, next) => {
    const tempPath = request.file?.path;
    let finalPath: string | null = null;
    let recorded = false;
    let replayed = false;
    try {
      const user = requireStudent(request);
      const activityId = routeParam(request, "activityId");
      if (!request.file || !tempPath) throw new HttpError(400, "Select a file to upload");

      const activity = getActivityRow(activityId);
      const receipt = submissionReceipts.get(request);
      if (!receipt || receipt.user.id !== user.id || String(receipt.activity.current_release_id) !== String(activity.current_release_id)) {
        throw new HttpError(409, "The activity release changed during upload. Review it before submitting again");
      }
      if (String(activity.status) !== "published" || !activity.current_release_id) {
        throw new HttpError(409, "This activity is not published");
      }
      assertStudentReleaseAccess(user.id, String(activity.current_release_id));

      const release = db.prepare("SELECT * FROM activity_releases WHERE id = ?").get(
        String(activity.current_release_id),
      ) as Row | undefined;
      if (!release) throw new HttpError(409, "The published activity release is unavailable");
      const snapshot = JSON.parse(String(release.snapshot_json)) as ActivitySnapshot;
      const now = Date.now();
      if (now < Date.parse(snapshot.opensAt)) throw new HttpError(409, "This activity is not open yet");
      if (now > Date.parse(snapshot.deadlineAt)) throw new HttpError(409, "The activity deadline has passed");
      if (request.file.size > snapshot.maxBytes) throw new HttpError(413, "The file exceeds the activity limit");

      const idempotencyKey = request.header("idempotency-key")?.trim() || randomUUID();

      const extension = extensionOf(request.file.originalname);
      if (!extension) throw new HttpError(415, "Only .py and .zip files are accepted");
      if (!snapshot.acceptedExtensions.includes(extension)) {
        throw new HttpError(415, `This activity does not accept ${extension} submissions`);
      }
      const blueprint = snapshot.blueprint ? validateActivityBlueprint(snapshot.blueprint) : defaultActivityBlueprint();
      const completedThroughPartId = typeof request.body?.completedThroughPartId === "string" && request.body.completedThroughPartId
        ? request.body.completedThroughPartId
        : null;
      const validationReport = await validateSubmissionFile({
        path: tempPath,
        originalFilename: request.file.originalname,
        blueprint,
        completedThroughPartId,
        student: { studentNumber: user.studentNumber ?? "student", displayName: user.displayName },
      });
      if (!validationReport.valid && validationReport.mode === "strict") {
        throw new HttpError(422, "The submission does not match the published file requirements", "submission_validation_failed", { validationReport });
      }
      const submissionId = randomUUID();
      // Opaque storage name lets the display revision be allocated atomically after I/O.
      finalPath = join(uploadsDir, activityId, user.id, submissionId, `received${extension}`);
      await mkdir(dirname(finalPath), { recursive: true });
      const checksum = await sha256File(tempPath);
      await rename(tempPath, finalPath);

      const receivedAt = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = submissionReceiptContext(request);
        if (current.user.id !== user.id || String(current.activity.current_release_id) !== String(activity.current_release_id)) {
          throw new HttpError(409, "The activity release changed during upload. Review it before submitting again");
        }
        getActivityDetail(activityId, user, studentDetailScope(current.activity));
        const duplicate = db.prepare("SELECT * FROM submissions WHERE activity_id=? AND student_id=? AND idempotency_key=?")
          .get(activityId, user.id, idempotencyKey) as Row | undefined;
        if (duplicate) {
          if (String(duplicate.sha256) !== checksum || Number(duplicate.size_bytes) !== request.file.size
            || String(duplicate.original_filename) !== cleanOriginalFilename(request.file.originalname)
            || (duplicate.completed_through_part_id ?? null) !== validationReport.completedThroughPartId
            || String(duplicate.release_id) !== String(activity.current_release_id)) {
            throw new HttpError(409, "This upload key already belongs to a different submission", "idempotency_conflict");
          }
          replayed = true;
        } else {
        const categoryLimit = extension === ".zip" ? 5 : 10;
        const revisionCount = Number((db.prepare(`SELECT COUNT(*) AS count FROM submissions
          WHERE activity_id=? AND student_id=? AND normalized_filename LIKE ?`)
          .get(activityId, user.id, `%${extension}`) as { count: number }).count);
        if (revisionCount >= categoryLimit) throw new HttpError(409, `The ${extension} revision limit of ${categoryLimit} has been reached`);
        const revision = Number((db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE activity_id=? AND student_id=?")
          .get(activityId, user.id) as { count: number }).count) + 1;
        const normalizedFilename = normalizeSubmissionFilename(user.studentNumber ?? "student", snapshot.title, revision, request.file.originalname);
        db.prepare(`
          UPDATE submissions SET is_current_submission = 0
          WHERE activity_id = ? AND student_id = ? AND is_current_submission = 1
        `).run(activityId, user.id);
        db.prepare(`
          INSERT INTO submissions (
            id, activity_id, release_id, student_id, original_filename, normalized_filename,
            stored_path, mime_type, size_bytes, sha256, received_at, idempotency_key,
            status, is_current_submission, completed_through_part_id, validation_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fully_received', 1, ?, ?)
        `).run(
          submissionId,
          activityId,
          String(activity.current_release_id),
          user.id,
          cleanOriginalFilename(request.file.originalname),
          normalizedFilename,
          relative(dataDir, finalPath),
          request.file.mimetype || "application/octet-stream",
          request.file.size,
          checksum,
          receivedAt,
          idempotencyKey,
          validationReport.completedThroughPartId,
          JSON.stringify(validationReport),
        );
        }
        db.exec("COMMIT");
        recorded = !replayed;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      if (replayed) await rm(finalPath, { force: true });
      response.status(replayed ? 200 : 201).json(getActivityDetail(activityId, user, studentDetailScope(activity)));
    } catch (error) {
      if (finalPath && !recorded) await rm(finalPath, { force: true });
      if (tempPath) await rm(tempPath, { force: true });
      next(error);
    }
  },
);

app.get("/api/submissions/:submissionId/file", (request, response, next) => {
  const user = resolveUser(request);
  const submissionId = routeParam(request, "submissionId");
  const submission = db.prepare(`
    SELECT s.*, a.subject_offering_id FROM submissions s
    JOIN activities a ON a.id = s.activity_id
    WHERE s.id = ?
  `).get(submissionId) as Row | undefined;
  if (!submission) throw new HttpError(404, "Submission not found");
  if (user.role === "student") {
    if (String(submission.student_id) !== user.id) {
      throw new HttpError(403, "You cannot download another student's submission");
    }
  } else {
    const group = optionalQuery(request, "teachingGroupId");
    instructorAuthority.assertSubmission(submissionId, user, group && group !== "all" ? group : null);
  }

  const path = safeStoredFile(dataDir, String(submission.stored_path));
  if (!existsSync(path)) throw new HttpError(410, "The stored submission file is missing");
  const filename = String(submission.normalized_filename);
  response.setHeader("content-type", String(submission.mime_type || "application/octet-stream"));
  response.setHeader("content-length", String(submission.size_bytes));
  response.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  createReadStream(path).on("error", next).pipe(response);
});

app.post("/api/submissions/:submissionId/evaluation", (request, response) => {
  const user = requireFaculty(request);
  const submissionId = routeParam(request, "submissionId");
  const submission = db.prepare(`
    SELECT s.*, a.subject_offering_id, a.grading_period FROM submissions s
    JOIN activities a ON a.id = s.activity_id WHERE s.id = ?
  `).get(submissionId) as Row | undefined;
  if (!submission) throw new HttpError(404, "Submission not found");
  const scope = preflightActivityResponse(request, user, getActivityRow(String(submission.activity_id)));
  instructorAuthority.assertSubmission(submissionId, user, scope.teachingGroupId);
  if (Number(submission.is_current_submission) !== 1) {
    throw new HttpError(409, "Only the student's current submission can be evaluated");
  }

  const body = request.body as Record<string, unknown>;
  const score = nonNegativeNumber(body.score, "Total score");
  const manualDeduction = nonNegativeNumber(body.manualDeduction ?? 0, "Manual deduction");
  const comments = optionalText(body.comments);
  const annotations = optionalText(body.annotations);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO evaluations (
      id, submission_id, score, manual_deduction, comments, annotations,
      evaluated_by, evaluated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(submission_id) DO UPDATE SET
      score = excluded.score,
      manual_deduction = excluded.manual_deduction,
      comments = excluded.comments,
      annotations = excluded.annotations,
      evaluated_by = excluded.evaluated_by,
      evaluated_at = excluded.evaluated_at,
      updated_at = excluded.updated_at
  `).run(randomUUID(), submissionId, score, manualDeduction, comments, annotations, user.id, now, now);

  response.json(getActivityDetail(String(submission.activity_id), user, scope));
});

const distDir = join(applicationRoot, "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((request, response, next) => {
    if (request.method === "GET" && !request.path.startsWith("/api/")) {
      response.sendFile(join(distDir, "index.html"));
      return;
    }
    next();
  });
}

app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
  if (request.file?.path) void rm(request.file.path, { force: true });
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(413).json({ error: "The selected file is larger than 50 MB" });
    return;
  }
  if (error instanceof HttpError) {
    response.setHeader("cache-control", "no-store");
    response.status(error.status).json({ error: error.message, code: error.code, ...error.details });
    return;
  }
  console.error(error);
  response.status(500).json({ error: "ATOM could not complete the request" });
});

const port = Number(process.env.PORT || 4174);
const bindAddress = process.env.ATOM_HOST || "0.0.0.0";
const server = createServer(app);
await new Promise<void>((resolve, reject) => {
  const failed = (error: NodeJS.ErrnoException) => reject(error);
  server.once("error", failed);
  server.listen(port, bindAddress, () => {
    server.off("error", failed);
    resolve();
  });
}).catch((error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    throw new Error(`ATOM cannot start because port ${port} is already in use. Stop the existing ATOM terminal before starting another one.`);
  }
  throw error;
});

console.log(`ATOM server listening on http://${bindAddress}:${port}`);
console.log(`ATOM data: ${join(dataDir, "atom.sqlite")}`);
if (demoAccountsEnabled) console.warn("ATOM demo accounts are enabled for this development session.");
if (!secureCookies) console.warn("ATOM is running in HTTP LAN mode. Traffic and session cookies are not encrypted.");

await new Promise<void>((resolve, reject) => {
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`Stopping ATOM (${signal})...`);
    server.close((error) => {
      try {
        db.close();
      } finally {
        if (error) reject(error);
        else resolve();
      }
    });
  };
  server.once("error", reject);
  process.once("SIGINT", () => shutdown("Ctrl+C"));
  process.once("SIGTERM", () => shutdown("termination request"));
});

function resolveUser(request: Request): AuthUser {
  return auth.session(request).currentUser;
}

function requireFaculty(request: Request): AuthUser {
  const user = resolveUser(request);
  if (user.role !== "faculty") throw new HttpError(403, "Faculty access is required");
  return user;
}

function requireStudent(request: Request): AuthUser {
  const user = resolveUser(request);
  if (user.role !== "student") throw new HttpError(403, "Student access is required");
  return user;
}

function submissionReceiptContext(request: Request) {
  const user = requireStudent(request);
  const activity = getActivityRow(routeParam(request, "activityId"));
  if (String(activity.status) !== "published" || !activity.current_release_id) throw new HttpError(409, "This activity is not published");
  assertStudentReleaseAccess(user.id, String(activity.current_release_id));
  const release = db.prepare("SELECT snapshot_json FROM activity_releases WHERE id=? AND activity_id=?")
    .get(String(activity.current_release_id), String(activity.id)) as Row | undefined;
  if (!release) throw new HttpError(409, "The published activity release is unavailable");
  const snapshot = JSON.parse(String(release.snapshot_json)) as ActivitySnapshot;
  if (Date.now() < Date.parse(snapshot.opensAt)) throw new HttpError(409, "This activity is not open yet");
  if (Date.now() > Date.parse(snapshot.deadlineAt)) throw new HttpError(409, "The activity deadline has passed");
  return { user, activity, snapshot };
}

function groupPreviewIdentities(): { faculty: AuthUser[]; students: AuthUser[] } {
  const users = (db.prepare("SELECT * FROM users ORDER BY display_name").all() as Row[]).map(userFromRow);
  return {
    faculty: users.filter((user) => user.role === "faculty"),
    students: users.filter((user) => user.role === "student"),
  };
}

function listAcademicTerms(user: AuthUser): Record<string, unknown>[] {
  const offerings = db.prepare(`
    SELECT DISTINCT so.*, t.label AS term_label
    FROM subject_offerings so
    JOIN academic_terms t ON t.id = so.academic_term_id
    ${user.role === "faculty"
      ? `JOIN teaching_groups tg ON tg.subject_offering_id = so.id
         JOIN faculty_group_assignments fga ON fga.teaching_group_id = tg.id
         WHERE fga.faculty_id = ?`
      : `JOIN enrollments e ON e.subject_offering_id = so.id
         WHERE e.student_id = ? AND e.status = 'active'`}
    ORDER BY t.label DESC, so.subject_code
  `).all(user.id) as Row[];

  const terms = new Map<string, { id: string; label: string; offerings: Record<string, unknown>[] }>();
  for (const offering of offerings) {
    const termId = String(offering.academic_term_id);
    const term = terms.get(termId) ?? {
      id: termId,
      label: String(offering.term_label),
      offerings: [],
    };
    term.offerings.push({
      id: String(offering.id),
      code: String(offering.subject_code),
      title: String(offering.subject_title),
      groups: listAuthorizedGroups(user, String(offering.id)),
    });
    terms.set(termId, term);
  }
  return [...terms.values()];
}

function listAuthorizedGroups(user: AuthUser, offeringId: string): Record<string, unknown>[] {
  const rows = db.prepare(`
    SELECT DISTINCT tg.* FROM teaching_groups tg
    ${user.role === "faculty"
      ? "JOIN faculty_group_assignments x ON x.teaching_group_id = tg.id"
      : `JOIN student_group_placements sgp ON sgp.teaching_group_id = tg.id
         JOIN enrollments x ON x.id = sgp.enrollment_id`}
    WHERE tg.subject_offering_id = ?
      AND ${user.role === "faculty" ? "x.faculty_id" : "x.student_id"} = ?
    ORDER BY CASE tg.component_kind WHEN 'laboratory' THEN 0 WHEN 'lecture' THEN 1 ELSE 2 END,
      tg.sort_order, tg.label
  `).all(offeringId, user.id) as Row[];
  return rows.map(groupFromRow);
}

function groupFromRow(row: Row): Record<string, unknown> {
  return {
    id: String(row.id),
    label: String(row.label),
    componentKind: String(row.component_kind),
  };
}

function activityScope(request: Request, user: AuthUser): ActivityScope {
  const subjectOfferingId = requiredQuery(request, "subjectOfferingId");
  const groupValue = requiredQuery(request, "teachingGroupId");
  const gradingPeriod = requiredGradingPeriod(requiredQuery(request, "gradingPeriod"));
  assertOfferingAccess(user, subjectOfferingId);
  const teachingGroupId = groupValue === "all" ? null : groupValue;
  if (teachingGroupId) assertGroupAccess(user, subjectOfferingId, teachingGroupId);
  return { subjectOfferingId, teachingGroupId, gradingPeriod };
}

function streamScope(request: Request, user: AuthUser, subjectOfferingId: string): ActivityScope {
  assertOfferingAccess(user, subjectOfferingId);
  const groupValue = requiredQuery(request, "teachingGroupId");
  const gradingPeriod = requiredGradingPeriod(requiredQuery(request, "gradingPeriod"));
  const teachingGroupId = groupValue === "all" ? null : groupValue;
  if (teachingGroupId) assertGroupAccess(user, subjectOfferingId, teachingGroupId);
  return { subjectOfferingId, teachingGroupId, gradingPeriod };
}

function responseScope(request: Request, user: AuthUser, activity: Row): ActivityScope {
  const groupValue = optionalQuery(request, "teachingGroupId");
  const teachingGroupId = groupValue && groupValue !== "all" ? groupValue : null;
  const subjectOfferingId = String(activity.subject_offering_id);
  const requestedOffering = optionalQuery(request, "subjectOfferingId");
  const requestedPeriod = optionalQuery(request, "gradingPeriod");
  if ((requestedOffering && requestedOffering !== subjectOfferingId)
    || (requestedPeriod && requestedPeriod !== String(activity.grading_period))) {
    throw new HttpError(400, "Select the activity's subject offering and grading period");
  }
  assertOfferingAccess(user, subjectOfferingId);
  if (teachingGroupId) assertGroupAccess(user, subjectOfferingId, teachingGroupId);
  return {
    subjectOfferingId,
    teachingGroupId,
    gradingPeriod: String(activity.grading_period) as GradingPeriod,
  };
}

function preflightActivityResponse(request: Request, user: AuthUser, activity: Row): ActivityScope {
  const scope = responseScope(request, user, activity);
  getActivityDetail(String(activity.id), user, scope);
  return scope;
}

function studentDetailScope(activity: Row): ActivityScope {
  return {
    subjectOfferingId: String(activity.subject_offering_id),
    teachingGroupId: null,
    gradingPeriod: String(activity.grading_period) as GradingPeriod,
  };
}

function assertOfferingAccess(user: AuthUser, offeringId: string): void {
  const row = db.prepare(user.role === "faculty" ? `
    SELECT 1 FROM teaching_groups tg
    JOIN faculty_group_assignments fga ON fga.teaching_group_id = tg.id
    WHERE tg.subject_offering_id = ? AND fga.faculty_id = ? LIMIT 1
  ` : `
    SELECT 1 FROM enrollments
    WHERE subject_offering_id = ? AND student_id = ? AND status = 'active' LIMIT 1
  `).get(offeringId, user.id);
  if (!row) throw new HttpError(403, "You do not have access to this subject offering");
}

function assertGroupAccess(user: AuthUser, offeringId: string, groupId: string): void {
  const row = db.prepare(user.role === "faculty" ? `
    SELECT 1 FROM teaching_groups tg
    JOIN faculty_group_assignments fga ON fga.teaching_group_id = tg.id
    WHERE tg.id = ? AND tg.subject_offering_id = ? AND fga.faculty_id = ?
  ` : `
    SELECT 1 FROM teaching_groups tg
    JOIN student_group_placements sgp ON sgp.teaching_group_id = tg.id
    JOIN enrollments e ON e.id = sgp.enrollment_id
    WHERE tg.id = ? AND tg.subject_offering_id = ? AND e.student_id = ? AND e.status = 'active'
  `).get(groupId, offeringId, user.id);
  if (!row) throw new HttpError(403, "You do not have access to this teaching group");
}

function assertStudentReleaseAccess(studentId: string, releaseId: string): void {
  const row = db.prepare(`
    SELECT 1 FROM activity_release_scopes ars
    JOIN student_group_placements sgp ON sgp.teaching_group_id = ars.teaching_group_id
    JOIN enrollments e ON e.id = sgp.enrollment_id
    WHERE ars.release_id = ? AND e.student_id = ? AND e.status = 'active' LIMIT 1
  `).get(releaseId, studentId);
  if (!row) throw new HttpError(403, "This activity was not published to your teaching groups");
}

function listActivities(user: AuthUser, scope: ActivityScope): Record<string, unknown>[] {
  if (user.role === "faculty") {
    const rows = db.prepare(`
      SELECT a.*, r.snapshot_json AS release_snapshot, r.version AS release_version, r.published_at
      FROM activities a LEFT JOIN activity_releases r ON r.id = a.current_release_id
      WHERE a.subject_offering_id = ? AND a.grading_period = ? ORDER BY a.created_at DESC
    `).all(scope.subjectOfferingId, scope.gradingPeriod) as Row[];
    return rows.flatMap((row) => {
      const visible = facultyActivityView(row, user, scope);
      return visible ? [activitySummary(visible, user, scope)] : [];
    });
  }
  const rows = db.prepare(`
    SELECT DISTINCT a.*, r.snapshot_json AS release_snapshot,
      r.version AS release_version, r.published_at
    FROM activities a
    LEFT JOIN activity_releases r ON r.id = a.current_release_id
    WHERE a.subject_offering_id = ? AND a.grading_period = ?
      ${user.role === "student" ? "AND a.status = 'published'" : ""}
      AND EXISTS (
        SELECT 1 FROM ${user.role === "student" ? "activity_release_scopes ars" : "activity_targets ats"}
        WHERE ${user.role === "student" ? "ars.release_id = a.current_release_id" : "ats.activity_id = a.id"}
          ${scope.teachingGroupId
            ? `AND ${user.role === "student" ? "ars.teaching_group_id" : "ats.teaching_group_id"} = ?`
            : `AND ${user.role === "student"
              ? `ars.teaching_group_id IN (
                  SELECT sgp.teaching_group_id FROM student_group_placements sgp
                  JOIN enrollments e ON e.id = sgp.enrollment_id
                  WHERE e.student_id = ? AND e.status = 'active'
                )`
              : `ats.teaching_group_id IN (
                  SELECT teaching_group_id FROM faculty_group_assignments WHERE faculty_id = ?
                )`}`}
      )
    ORDER BY a.created_at DESC
  `).all(
    scope.subjectOfferingId,
    scope.gradingPeriod,
    scope.teachingGroupId ?? user.id,
  ) as Row[];
  return rows.map((row) => activitySummary(row, user, scope));
}

function assessmentStream(user: AuthUser, scope: ActivityScope): Record<string, unknown> {
  const items = listActivities(user, scope) as Array<Record<string, unknown> & {
    id: string;
    topic: Record<string, unknown> | null;
    manualPosition: number | null;
    opensAt: string;
    deadlineAt: string;
    updatedAt: string;
    title: string;
  }>;
  const topicRows = db.prepare(`
    SELECT * FROM assessment_topics
    WHERE subject_offering_id = ? AND grading_period = ?
  `).all(scope.subjectOfferingId, scope.gradingPeriod) as Row[];
  const topics = topicRows.map(topicFromRow) as Array<Record<string, unknown> & {
    id: string;
    title: string;
    manualPosition: number | null;
  }>;

  const automaticItems = (matching: typeof items) => [...matching].sort((left, right) =>
    Date.parse(left.opensAt) - Date.parse(right.opensAt)
    || Date.parse(left.deadlineAt) - Date.parse(right.deadlineAt)
    || Date.parse(left.updatedAt) - Date.parse(right.updatedAt)
    || left.title.localeCompare(right.title),
  );
  const orderedItems = new Map<string | null, typeof items>();
  for (const topic of topics) {
    orderedItems.set(topic.id, applyManualPositions(automaticItems(items.filter((item) => item.topic?.id === topic.id))));
  }
  orderedItems.set(null, applyManualPositions(automaticItems(items.filter((item) => !item.topic))));

  const earliest = (topicId: string) => {
    const first = automaticItems(items.filter((item) => item.topic?.id === topicId))[0];
    return first ? Date.parse(first.opensAt) : Number.POSITIVE_INFINITY;
  };
  const automaticallySortedTopics = [...topics].sort((left, right) =>
    earliest(left.id) - earliest(right.id) || left.title.localeCompare(right.title),
  );
  const orderedTopics = applyManualPositions(automaticallySortedTopics);
  const sections: Array<{ topic: (typeof orderedTopics)[number] | null; items: typeof items }> = orderedTopics
    .map((topic) => ({ topic, items: orderedItems.get(topic.id) ?? [] }))
    .filter((section) => user.role === "faculty" || section.items.length > 0);
  const unassigned = orderedItems.get(null) ?? [];
  if (unassigned.length) sections.push({ topic: null, items: unassigned });

  return {
    subjectOfferingId: scope.subjectOfferingId,
    gradingPeriod: scope.gradingPeriod,
    teachingGroupId: scope.teachingGroupId ?? "all",
    topics: orderedTopics,
    sections,
  };
}

/** Evidence authority does not reveal a later private draft. Use a qualifying immutable release. */
function facultyActivityView(row: Row, user: AuthUser, scope: ActivityScope): Row | undefined {
  if (instructorAuthority.canRead(row, user, scope.teachingGroupId)) return row;
  const filter = instructorAuthority.submissionFilter(user, scope.teachingGroupId);
  const release = db.prepare(`SELECT r.* FROM submissions s JOIN activities a ON a.id=s.activity_id
    JOIN activity_releases r ON r.id=s.release_id
    WHERE s.activity_id=? AND s.is_current_submission=1 AND ${filter.sql}
    ORDER BY r.version DESC LIMIT 1`).get(String(row.id), ...filter.params) as Row | undefined;
  if (!release) return undefined;
  const snapshot = JSON.parse(String(release.snapshot_json)) as ActivitySnapshot;
  return { ...row, evidence_only: true, title: snapshot.title, instructions: snapshot.instructions,
    requirements_json: JSON.stringify(snapshot.requirements), opens_at: snapshot.opensAt, deadline_at: snapshot.deadlineAt,
    max_bytes: snapshot.maxBytes, accepted_extensions_json: JSON.stringify(snapshot.acceptedExtensions),
    content_json: JSON.stringify(snapshot.contentDocument ?? legacyActivityDocument(snapshot.instructions, snapshot.requirements)),
    blueprint_json: JSON.stringify(snapshot.blueprint ?? defaultActivityBlueprint()),
    current_release_id: release.id, release_snapshot: release.snapshot_json, release_version: release.version,
    status: "published", published_at: release.published_at, updated_at: release.published_at,
    topic_id: null, manual_position: null, draft_revision: 0 };
}

function activitySummary(row: Row, user: AuthUser, scope: ActivityScope): Record<string, unknown> {
  const snapshot = user.role === "student" && row.release_snapshot
    ? JSON.parse(String(row.release_snapshot)) as ActivitySnapshot
    : null;
  const activityId = String(row.id);
  const contentDocument = snapshot?.contentDocument
    ? normalizeLegacySubmissionTerminology(validateActivityDocument(snapshot.contentDocument))
    : snapshot
      ? normalizeLegacySubmissionTerminology(legacyActivityDocument(snapshot.instructions, snapshot.requirements))
      : activityDocumentFromRow(row);
  const summaryBlueprint = snapshot?.blueprint ? validateActivityBlueprint(snapshot.blueprint) : activityBlueprintFromRow(row);
  const topic = row.topic_id
    ? db.prepare("SELECT * FROM assessment_topics WHERE id = ? AND subject_offering_id = ? AND grading_period = ?")
      .get(String(row.topic_id), String(row.subject_offering_id), String(row.grading_period)) as Row | undefined
    : undefined;
  const submissionState = user.role === "student" ? studentSubmissionState(activityId, user.id) : null;
  return {
    id: activityId,
    evidenceOnly: Boolean(row.evidence_only),
    subjectOfferingId: String(row.subject_offering_id),
    gradingPeriod: String(row.grading_period),
    title: snapshot?.title ?? String(row.title),
    status: String(row.status),
    opensAt: snapshot?.opensAt ?? String(row.opens_at),
    deadlineAt: snapshot?.deadlineAt ?? String(row.deadline_at),
    submissionCount: countCurrentSubmissions(activityId, scope, user),
    studentCount: countEligibleStudents(activityId, scope, user),
    releaseVersion: row.release_version ? Number(row.release_version) : null,
    publishedAt: row.published_at ? String(row.published_at) : null,
    updatedAt: String(row.updated_at),
    overviewExcerpt: overviewExcerpt(contentDocument) || (summaryBlueprint.parts[0] ? overviewExcerpt(summaryBlueprint.parts[0].contentDocument) : null),
    scheduleState: scheduleState(snapshot?.opensAt ?? String(row.opens_at), snapshot?.deadlineAt ?? String(row.deadline_at)),
    contentAvailable: user.role === "faculty" || Date.now() >= Date.parse(snapshot?.opensAt ?? String(row.opens_at)),
    topic: topic ? topicFromRow(topic) : null,
    manualPosition: row.manual_position === null || row.manual_position === undefined ? null : Number(row.manual_position),
    currentUserSubmissionState: submissionState,
    draftRevision: user.role === "faculty" ? Number(row.draft_revision ?? 1) : undefined,
    targetGroups: row.evidence_only ? [] : activityTargetRows(activityId).map(groupFromRow),
    publishedScope: row.current_release_id ? releaseScopeRows(String(row.current_release_id)) : [],
  };
}

function getActivityDetail(activityId: string, user: AuthUser, scope: ActivityScope): Record<string, unknown> {
  let row = db.prepare(`
    SELECT a.*, r.snapshot_json AS release_snapshot,
      r.version AS release_version, r.published_at
    FROM activities a
    LEFT JOIN activity_releases r ON r.id = a.current_release_id
    WHERE a.id = ?
  `).get(activityId) as Row | undefined;
  if (!row || String(row.subject_offering_id) !== scope.subjectOfferingId || String(row.grading_period) !== scope.gradingPeriod) {
    throw new HttpError(404, "Activity not found");
  }
  assertOfferingAccess(user, String(row.subject_offering_id));
  if (user.role === "faculty") row = facultyActivityView(row, user, scope);
  else if (!activityVisibleInScope(row, user, scope)) row = undefined;
  if (!row) throw new HttpError(404, "Activity not found");

  const snapshot = user.role === "student" && row.release_snapshot
    ? JSON.parse(String(row.release_snapshot)) as ActivitySnapshot
    : null;
  const summary = activitySummary(row, user, scope);
  if (user.role === "student" && Date.now() < Date.parse(snapshot?.opensAt ?? String(row.opens_at))) {
    return {
      ...summary,
      contentAvailable: false,
      lockedReason: "not_open",
    };
  }
  const contentDocument = snapshot?.contentDocument
    ? normalizeLegacySubmissionTerminology(validateActivityDocument(snapshot.contentDocument))
    : snapshot
      ? normalizeLegacySubmissionTerminology(legacyActivityDocument(snapshot.instructions, snapshot.requirements))
      : activityDocumentFromRow(row);
  const blueprint = blueprintForUser(
    snapshot?.blueprint ? validateActivityBlueprint(snapshot.blueprint) : activityBlueprintFromRow(row),
    user,
  );
  const detail: Record<string, unknown> = {
    ...summary,
    contentAvailable: true,
    contentDocument,
    blueprint,
    instructions: (snapshot?.instructions ?? String(row.instructions)).replace(/\bcurrent candidate\b/gi, "current submission"),
    requirements: snapshot?.requirements ?? parseStringArray(String(row.requirements_json)),
    acceptedExtensions: snapshot?.acceptedExtensions ?? parseAcceptedExtensions(String(row.accepted_extensions_json)),
    maxBytes: snapshot?.maxBytes ?? Number(row.max_bytes),
    assets: user.role === "student" || row.evidence_only
      ? listReleaseAssets(String(row.current_release_id)).map(assetFromRow)
      : listActivityAssetRows(activityId).map(assetFromRow),
  };

  if (user.role === "faculty") {
    detail.submissions = listCurrentSubmissions(activityId, scope, user);
    detail.draftRevision = Number(row.draft_revision);
    detail.permissions = row.evidence_only ? { isCreator: false, canEdit: false, canPublish: false, canManageCollaborators: false } : activityPermissions(row, user);
    detail.collaborators = row.evidence_only ? [] : listActivityCollaborators(activityId);
    detail.availableCollaborators = row.evidence_only ? [] : listOfferingFaculty(String(row.subject_offering_id), String(row.created_by));
  } else {
    const history = (db.prepare(`
      SELECT s.*, e.id AS evaluation_id, e.score, e.manual_deduction,
        e.comments, e.annotations, e.evaluated_at
      FROM submissions s
      LEFT JOIN evaluations e ON e.submission_id = s.id
      WHERE s.activity_id = ? AND s.student_id = ?
      ORDER BY s.received_at DESC
    `).all(activityId, user.id) as Row[]).map(submissionFromRow);
    detail.submissionHistory = history;
    detail.currentSubmission = history.find((submission) => submission.isCurrentSubmission) ?? null;
  }
  return detail;
}

function activityVisibleInScope(row: Row, user: AuthUser, scope: ActivityScope): boolean {
  if (user.role === "faculty") return instructorAuthority.canRead(row, user, scope.teachingGroupId);
  if (user.role === "student" && String(row.status) !== "published") return false;
  const source = user.role === "student" ? "activity_release_scopes" : "activity_targets";
  const ownerColumn = user.role === "student" ? "release_id" : "activity_id";
  const ownerId = user.role === "student" ? String(row.current_release_id ?? "") : String(row.id);
  if (!ownerId) return false;
  if (scope.teachingGroupId) {
    return Boolean(db.prepare(`
      SELECT 1 FROM ${source} WHERE ${ownerColumn} = ? AND teaching_group_id = ?
    `).get(ownerId, scope.teachingGroupId));
  }
  return Boolean(db.prepare(`
    SELECT 1 FROM ${source} x WHERE x.${ownerColumn} = ? AND x.teaching_group_id IN (
      ${user.role === "student"
        ? `SELECT sgp.teaching_group_id FROM student_group_placements sgp
           JOIN enrollments e ON e.id = sgp.enrollment_id
           WHERE e.student_id = ? AND e.status = 'active'`
        : "SELECT teaching_group_id FROM faculty_group_assignments WHERE faculty_id = ?"}
    )
  `).get(ownerId, user.id));
}

function activityTargetRows(activityId: string): Row[] {
  return db.prepare(`
    SELECT tg.* FROM activity_targets at
    JOIN teaching_groups tg ON tg.id = at.teaching_group_id
    WHERE at.activity_id = ? ORDER BY tg.sort_order, tg.label
  `).all(activityId) as Row[];
}

function releaseScopeRows(releaseId: string): Record<string, unknown>[] {
  return (db.prepare(`
    SELECT tg.*, ars.grading_period FROM activity_release_scopes ars
    JOIN teaching_groups tg ON tg.id = ars.teaching_group_id
    WHERE ars.release_id = ? ORDER BY tg.sort_order, tg.label
  `).all(releaseId) as Row[]).map((row) => ({
    ...groupFromRow(row),
    gradingPeriod: String(row.grading_period),
  }));
}

function eligibleStudentWhere(activityId: string, scope: ActivityScope): { sql: string; params: string[] } {
  if (scope.teachingGroupId) {
    return {
      sql: `e.student_id IN (
        SELECT e2.student_id FROM enrollments e2
        JOIN student_group_placements sgp ON sgp.enrollment_id = e2.id
        JOIN activity_targets at ON at.teaching_group_id = sgp.teaching_group_id
        WHERE at.activity_id = ? AND sgp.teaching_group_id = ? AND e2.status = 'active'
      )`,
      params: [activityId, scope.teachingGroupId],
    };
  }
  return {
    sql: `e.student_id IN (
      SELECT DISTINCT e2.student_id FROM enrollments e2
      JOIN student_group_placements sgp ON sgp.enrollment_id = e2.id
      JOIN activity_targets at ON at.teaching_group_id = sgp.teaching_group_id
      WHERE at.activity_id = ? AND e2.status = 'active'
    )`,
    params: [activityId],
  };
}

function countEligibleStudents(activityId: string, scope: ActivityScope, user: AuthUser): number {
  if (user.role === "faculty") return instructorAuthority.eligibleStudentCount(activityId, user, scope.teachingGroupId);
  const eligible = eligibleStudentWhere(activityId, scope);
  return Number((db.prepare(`
    SELECT COUNT(DISTINCT e.student_id) AS count FROM enrollments e
    WHERE e.subject_offering_id = ? AND e.status = 'active' AND ${eligible.sql}
  `).get(scope.subjectOfferingId, ...eligible.params) as { count: number }).count);
}

function countCurrentSubmissions(activityId: string, scope: ActivityScope, user: AuthUser): number {
  if (user.role === "student") {
    return Number((db.prepare(`
      SELECT COUNT(*) AS count FROM submissions
      WHERE activity_id = ? AND student_id = ? AND is_current_submission = 1
    `).get(activityId, user.id) as { count: number }).count);
  }
  const eligible = instructorAuthority.submissionFilter(user, scope.teachingGroupId);
  return Number((db.prepare(`
    SELECT COUNT(*) AS count FROM submissions s JOIN activities a ON a.id = s.activity_id
    WHERE s.activity_id = ? AND s.is_current_submission = 1 AND ${eligible.sql}
  `).get(activityId, ...eligible.params) as { count: number }).count);
}

function listCurrentSubmissions(activityId: string, scope: ActivityScope, user: AuthUser): Record<string, unknown>[] {
  const eligible = instructorAuthority.submissionFilter(user, scope.teachingGroupId);
  return (db.prepare(`
    SELECT s.*, u.student_number, u.display_name,
      e.id AS evaluation_id, e.score, e.manual_deduction, e.comments, e.annotations, e.evaluated_at
    FROM submissions s
    JOIN users u ON u.id = s.student_id
    JOIN activities a ON a.id = s.activity_id
    LEFT JOIN evaluations e ON e.submission_id = s.id
    WHERE s.activity_id = ? AND s.is_current_submission = 1
      AND ${eligible.sql}
    ORDER BY u.student_number
  `).all(activityId, ...eligible.params) as Row[]).map(submissionFromRow);
}

function submissionFromRow(row: Row): Record<string, unknown> {
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    studentNumber: row.student_number ? String(row.student_number) : null,
    studentName: row.display_name ? String(row.display_name) : null,
    originalFilename: String(row.original_filename),
    normalizedFilename: String(row.normalized_filename),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    receivedAt: String(row.received_at),
    status: String(row.status),
    isCurrentSubmission: Number(row.is_current_submission) === 1,
    completedThroughPartId: row.completed_through_part_id ? String(row.completed_through_part_id) : null,
    validationReport: row.validation_json ? parseValidationReport(String(row.validation_json)) : null,
    evaluation: row.evaluation_id ? {
      id: String(row.evaluation_id),
      score: Number(row.score),
      manualDeduction: Number(row.manual_deduction),
      comments: String(row.comments ?? ""),
      annotations: String(row.annotations ?? ""),
      evaluatedAt: String(row.evaluated_at),
    } : null,
  };
}

function activityInput(
  body: Record<string, unknown>,
  user: AuthUser,
  options: { allowOfferingGroups?: boolean } = {},
) {
  const subjectOfferingId = requiredText(body.subjectOfferingId, "Subject offering");
  assertOfferingAccess(user, subjectOfferingId);
  const teachingGroupIds = uniqueStringArray(body.teachingGroupIds);
  if (!teachingGroupIds.length) throw new HttpError(400, "Select at least one teaching group");
  for (const groupId of teachingGroupIds) {
    if (options.allowOfferingGroups) assertGroupBelongsToOffering(subjectOfferingId, groupId);
    else assertGroupAccess(user, subjectOfferingId, groupId);
  }
  const opensAt = requiredDate(body.opensAt, "Opening date");
  const deadlineAt = requiredDate(body.deadlineAt, "Deadline");
  ensureDateOrder(opensAt, deadlineAt);
  const contentDocument = body.contentDocument
    ? validateActivityDocument(body.contentDocument)
    : legacyActivityDocument(
      typeof body.instructions === "string" ? body.instructions : "",
      stringArray(body.requirements),
    );
  const legacy = legacyFieldsFromDocument(contentDocument);
  const acceptedExtensions = uniqueStringArray(body.acceptedExtensions ?? [".py", ".zip"]);
  if (!acceptedExtensions.length || acceptedExtensions.some((item) => item !== ".py" && item !== ".zip")) {
    throw new HttpError(400, "Choose Python files, ZIP projects, or both");
  }
  const maxBytes = Number(body.maxBytes ?? 50 * 1024 * 1024);
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 * 1024 || maxBytes > 50 * 1024 * 1024) {
    throw new HttpError(400, "Submission size must be between 1 MB and 50 MB");
  }
  return {
    subjectOfferingId,
    gradingPeriod: requiredGradingPeriod(body.gradingPeriod),
    teachingGroupIds,
    title: requiredText(body.title, "Activity title"),
    instructions: legacy.instructions,
    requirements: legacy.requirements,
    contentDocument,
    blueprint: validateActivityBlueprint(body.blueprint),
    acceptedExtensions,
    maxBytes,
    opensAt,
    deadlineAt,
  };
}

function replaceActivityTargets(activityId: string, groupIds: string[]): void {
  db.prepare("DELETE FROM activity_targets WHERE activity_id = ?").run(activityId);
  const insert = db.prepare(
    "INSERT INTO activity_targets (activity_id, teaching_group_id) VALUES (?, ?)",
  );
  for (const groupId of groupIds) insert.run(activityId, groupId);
}

function legacySubjectForOffering(offeringId: string): string {
  const row = db.prepare("SELECT legacy_subject_id FROM subject_offerings WHERE id = ?").get(offeringId) as Row | undefined;
  if (!row?.legacy_subject_id) throw new HttpError(409, "This subject offering is not linked to a subject record");
  return String(row.legacy_subject_id);
}

function getActivityRow(activityId: string): Row {
  const row = db.prepare("SELECT * FROM activities WHERE id = ?").get(activityId) as Row | undefined;
  if (!row) throw new HttpError(404, "Activity not found");
  return row;
}

function getTopicRow(topicId: string): Row {
  const row = db.prepare("SELECT * FROM assessment_topics WHERE id = ?").get(topicId) as Row | undefined;
  if (!row) throw new HttpError(404, "Topic not found");
  return row;
}

function topicFromRow(row: Row): Record<string, unknown> {
  return {
    id: String(row.id),
    subjectOfferingId: String(row.subject_offering_id),
    gradingPeriod: String(row.grading_period),
    title: String(row.title),
    manualPosition: row.manual_position === null || row.manual_position === undefined ? null : Number(row.manual_position),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function compatibleTopicId(value: unknown, offeringId: string, period: GradingPeriod): string | null {
  if (!value) return null;
  return db.prepare("SELECT 1 FROM assessment_topics WHERE id=? AND subject_offering_id=? AND grading_period=?")
    .get(String(value), offeringId, period) ? String(value) : null;
}

function topicTitle(value: unknown): string {
  const title = requiredText(value, "Topic name");
  if (title.length > 120) throw new HttpError(400, "Topic names cannot exceed 120 characters");
  return title;
}

function assertUniqueTopicTitle(offeringId: string, gradingPeriod: GradingPeriod, title: string, excludingId?: string): void {
  const row = db.prepare(`
    SELECT id FROM assessment_topics
    WHERE subject_offering_id = ? AND grading_period = ? AND lower(title) = lower(?)
      AND (? IS NULL OR id <> ?)
  `).get(offeringId, gradingPeriod, title, excludingId ?? null, excludingId ?? null);
  if (row) throw new HttpError(409, "A topic with this name already exists in this grading period");
}

function assertTopicScope(topic: Row, offeringId: string, gradingPeriod: GradingPeriod): void {
  if (String(topic.subject_offering_id) !== offeringId || String(topic.grading_period) !== gradingPeriod) {
    throw new HttpError(404, "Topic not found in this assessment stream");
  }
}

function moveManualEntity(table: "assessment_topics", entityId: string, targetIndex: number, scopeSql: string, scopeParams: Array<string | number | null>): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE ${table} SET manual_position = manual_position + 1
      WHERE ${scopeSql} AND id <> ? AND manual_position IS NOT NULL AND manual_position >= ?
    `).run(...scopeParams, entityId, targetIndex);
    db.prepare(`UPDATE ${table} SET manual_position = ?, updated_at = ? WHERE id = ?`)
      .run(targetIndex, new Date().toISOString(), entityId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function moveActivity(activity: Row, targetIndex: number, topicId: string | null, user: AuthUser): void {
  const affected = db.prepare(`SELECT * FROM activities
    WHERE subject_offering_id=? AND grading_period=? AND topic_id IS ?
      AND id<>? AND manual_position IS NOT NULL AND manual_position>=?`)
    .all(String(activity.subject_offering_id), String(activity.grading_period), topicId, String(activity.id), targetIndex) as Row[];
  for (const sibling of affected) assertActivityPermission(sibling, user, "edit");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (topicId) {
      db.prepare(`
        UPDATE activities SET manual_position = manual_position + 1
        WHERE subject_offering_id = ? AND grading_period = ? AND topic_id = ?
          AND id <> ? AND manual_position IS NOT NULL AND manual_position >= ?
      `).run(String(activity.subject_offering_id), String(activity.grading_period), topicId, String(activity.id), targetIndex);
    } else {
      db.prepare(`
        UPDATE activities SET manual_position = manual_position + 1
        WHERE subject_offering_id = ? AND grading_period = ? AND topic_id IS NULL
          AND id <> ? AND manual_position IS NOT NULL AND manual_position >= ?
      `).run(String(activity.subject_offering_id), String(activity.grading_period), String(activity.id), targetIndex);
    }
    db.prepare("UPDATE activities SET manual_position = ?, updated_at = ? WHERE id = ?")
      .run(targetIndex, new Date().toISOString(), String(activity.id));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function studentSubmissionState(activityId: string, studentId: string): Record<string, unknown> {
  const row = db.prepare(`
    SELECT s.received_at, e.id AS evaluation_id
    FROM submissions s
    LEFT JOIN evaluations e ON e.submission_id = s.id
    WHERE s.activity_id = ? AND s.student_id = ? AND s.is_current_submission = 1
  `).get(activityId, studentId) as Row | undefined;
  if (!row) return { state: "not_submitted", receivedAt: null };
  return {
    state: row.evaluation_id ? "evaluated" : "submitted",
    receivedAt: String(row.received_at),
  };
}

function auditOrganization(request: Request, user: AuthUser, eventType: string, details: Record<string, unknown>): void {
  insertOrganizationAudit(user, eventType, details, request.ip ?? "");
}

function insertOrganizationAudit(user: AuthUser, eventType: string, details: Record<string, unknown>, sourceAddress: string): void {
  db.prepare(`
    INSERT INTO auth_audit_events (
      id, user_id, actor_user_id, event_type, details_json, source_address, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), user.id, user.id, eventType, JSON.stringify(details), sourceAddress, new Date().toISOString());
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${label} is required`);
  return value.trim();
}

function optionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requiredDate(value: unknown, label: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${label} is invalid`);
  }
  return new Date(value).toISOString();
}

function ensureDateOrder(opensAt: string, deadlineAt: string): void {
  if (Date.parse(opensAt) >= Date.parse(deadlineAt)) {
    throw new HttpError(400, "The deadline must be later than the opening date");
  }
}

function requiredGradingPeriod(value: unknown): GradingPeriod {
  if (value !== "midterm" && value !== "final_term") {
    throw new HttpError(400, "Grading period must be Midterm or Final Term");
  }
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim());
}

function uniqueStringArray(value: unknown): string[] {
  return [...new Set(stringArray(value))];
}

function parseStringArray(value: string): string[] {
  try {
    return stringArray(JSON.parse(value));
  } catch {
    return [];
  }
}

function parseAcceptedExtensions(value: string): string[] {
  const extensions = parseStringArray(value).filter((item) => item === ".py" || item === ".zip");
  return extensions.length ? extensions : [".py", ".zip"];
}

function activityDocumentFromRow(row: Row): ActivityDocumentV1 {
  try {
    if (row.content_json) return normalizeLegacySubmissionTerminology(validateActivityDocument(JSON.parse(String(row.content_json))));
  } catch {
    // Fall through to the legacy fields so an old activity remains readable.
  }
  return normalizeLegacySubmissionTerminology(legacyActivityDocument(
    String(row.instructions ?? ""),
    parseStringArray(String(row.requirements_json ?? "[]")),
  ));
}

function activityBlueprintFromRow(row: Row): ActivityBlueprintV1 {
  try {
    if (row.blueprint_json) return validateActivityBlueprint(JSON.parse(String(row.blueprint_json)));
  } catch {
    // Keep pre-migration and damaged optional authoring metadata readable as a simple activity.
  }
  return defaultActivityBlueprint();
}

function blueprintForUser(blueprint: ActivityBlueprintV1, user: AuthUser): ActivityBlueprintV1 {
  if (user.role === "faculty" || blueprint.rubric?.visibleToStudents !== false) return blueprint;
  return { ...blueprint, rubric: null };
}

function parseValidationReport(value: string): Record<string, unknown> | null {
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
}

function assertActivityPermission(activity: Row, user: AuthUser, permission: "edit" | "publish"): void {
  instructorAuthority.assertRead(activity, user);
  const permissions = activityPermissions(activity, user);
  if (permission === "edit" && !permissions.canEdit) throw new HttpError(403, "You cannot edit this activity");
  if (permission === "publish" && !permissions.canPublish) throw new HttpError(403, "You cannot change this activity's publication state");
}

function assertActivityCreator(activity: Row, user: AuthUser): void {
  instructorAuthority.assertRead(activity, user);
  if (String(activity.created_by) !== user.id) throw new HttpError(403, "Only the activity creator can manage collaborators");
}

function activityPermissions(activity: Row, user: AuthUser): Record<string, boolean> {
  const isCreator = String(activity.created_by) === user.id;
  if (isCreator) return { isCreator: true, canEdit: true, canPublish: true, canManageCollaborators: true };
  const collaborator = db.prepare(`
    SELECT can_edit, can_publish FROM activity_collaborators
    WHERE activity_id = ? AND faculty_id = ?
  `).get(String(activity.id), user.id) as Row | undefined;
  return {
    isCreator: false,
    canEdit: Number(collaborator?.can_edit ?? 0) === 1,
    canPublish: Number(collaborator?.can_publish ?? 0) === 1,
    canManageCollaborators: false,
  };
}

function listActivityCollaborators(activityId: string): Record<string, unknown>[] {
  return (db.prepare(`
    SELECT ac.*, u.display_name FROM activity_collaborators ac
    JOIN users u ON u.id = ac.faculty_id
    WHERE ac.activity_id = ? ORDER BY u.display_name
  `).all(activityId) as Row[]).map((row) => ({
    facultyId: String(row.faculty_id),
    displayName: String(row.display_name),
    canEdit: Number(row.can_edit) === 1,
    canPublish: Number(row.can_publish) === 1,
  }));
}

function listOfferingFaculty(offeringId: string, creatorId: string): Record<string, unknown>[] {
  return (db.prepare(`
    SELECT DISTINCT u.id, u.display_name FROM users u
    JOIN faculty_group_assignments fga ON fga.faculty_id = u.id
    JOIN teaching_groups tg ON tg.id = fga.teaching_group_id
    WHERE tg.subject_offering_id = ? AND u.id <> ?
    ORDER BY u.display_name
  `).all(offeringId, creatorId) as Row[]).map((row) => ({
    id: String(row.id),
    displayName: String(row.display_name),
  }));
}

function facultyAssignedToOffering(facultyId: string, offeringId: string): boolean {
  return Boolean(db.prepare(`
    SELECT 1 FROM faculty_group_assignments fga
    JOIN teaching_groups tg ON tg.id = fga.teaching_group_id
    WHERE fga.faculty_id = ? AND tg.subject_offering_id = ? LIMIT 1
  `).get(facultyId, offeringId));
}

function assertGroupBelongsToOffering(offeringId: string, groupId: string): void {
  const row = db.prepare("SELECT 1 FROM teaching_groups WHERE id = ? AND subject_offering_id = ?").get(groupId, offeringId);
  if (!row) throw new HttpError(400, "Teaching group does not belong to this subject offering");
}

function listManagedStudents(facultyId: string, offeringId: string): Record<string, unknown>[] {
  const rows = db.prepare(`
    SELECT DISTINCT u.id, u.student_number, u.display_name, tg.id AS group_id, tg.label AS group_label,
      c.must_change_password
    FROM users u
    JOIN enrollments e ON e.student_id = u.id AND e.subject_offering_id = ? AND e.status = 'active'
    JOIN student_group_placements sgp ON sgp.enrollment_id = e.id
    JOIN teaching_groups tg ON tg.id = sgp.teaching_group_id
    JOIN faculty_group_assignments fga ON fga.teaching_group_id = tg.id AND fga.faculty_id = ?
    LEFT JOIN auth_credentials c ON c.user_id = u.id
    ORDER BY u.student_number, tg.sort_order
  `).all(offeringId, facultyId) as Row[];
  const students = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = String(row.id);
    const student = students.get(id) ?? {
      id,
      studentNumber: row.student_number ? String(row.student_number) : null,
      displayName: String(row.display_name),
      mustChangePassword: Number(row.must_change_password ?? 0) === 1,
      groups: [],
    };
    (student.groups as Array<Record<string, string>>).push({ id: String(row.group_id), label: String(row.group_label) });
    students.set(id, student);
  }
  return [...students.values()];
}

function facultySharesStudentGroup(facultyId: string, offeringId: string, studentId: string): boolean {
  return Boolean(db.prepare(`
    SELECT 1 FROM faculty_group_assignments fga
    JOIN teaching_groups tg ON tg.id = fga.teaching_group_id AND tg.subject_offering_id = ?
    JOIN student_group_placements sgp ON sgp.teaching_group_id = tg.id
    JOIN enrollments e ON e.id = sgp.enrollment_id AND e.student_id = ? AND e.status = 'active'
    WHERE fga.faculty_id = ? LIMIT 1
  `).get(offeringId, studentId, facultyId));
}

function listActivityAssetRows(activityId: string): Row[] {
  return db.prepare("SELECT * FROM activity_assets WHERE activity_id = ? ORDER BY created_at, original_filename").all(activityId) as Row[];
}

function listReleaseAssets(releaseId: string): Row[] {
  return db.prepare(`
    SELECT ara.*, aa.kind, aa.activity_id, aa.uploaded_by, aa.created_at
    FROM activity_release_assets ara JOIN activity_assets aa ON aa.id = ara.asset_id
    WHERE ara.release_id = ? ORDER BY aa.created_at, ara.original_filename
  `).all(releaseId) as Row[];
}

function getActivityAssetRow(assetId: string): Row {
  const row = db.prepare("SELECT * FROM activity_assets WHERE id = ?").get(assetId) as Row | undefined;
  if (!row) throw new HttpError(404, "Teaching file not found");
  return row;
}

function assetFromRow(row: Row): Record<string, unknown> {
  return {
    id: String(row.id ?? row.asset_id),
    kind: String(row.kind),
    originalFilename: String(row.original_filename),
    normalizedFilename: String(row.normalized_filename),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    fileUrl: `/api/activity-assets/${String(row.id ?? row.asset_id)}/file`,
  };
}

function assertDocumentAssets(activityId: string, document: ActivityDocumentV1): void {
  for (const assetId of referencedAssetIds(document)) {
    const row = db.prepare("SELECT 1 FROM activity_assets WHERE id = ? AND activity_id = ?").get(assetId, activityId);
    if (!row) throw new HttpError(400, "Activity content refers to a teaching file that is unavailable");
  }
}

function remapDocumentAssets(document: ActivityDocumentV1, ids: Map<string, string>): ActivityDocumentV1 {
  const cloned = structuredClone(document) as ActivityDocumentV1;
  const visit = (node: { attrs?: Record<string, unknown>; content?: unknown[] }) => {
    if (typeof node.attrs?.assetId === "string" && ids.has(node.attrs.assetId)) {
      node.attrs.assetId = ids.get(node.attrs.assetId);
    }
    for (const child of node.content ?? []) visit(child as { attrs?: Record<string, unknown>; content?: unknown[] });
  };
  for (const section of cloned.sections) visit(section.content);
  return cloned;
}

function remapBlueprintAssets(blueprint: ActivityBlueprintV1, ids: Map<string, string>): ActivityBlueprintV1 {
  return {
    ...structuredClone(blueprint),
    parts: blueprint.parts.map((part) => ({ ...part, contentDocument: remapDocumentAssets(part.contentDocument, ids) })),
  };
}

async function inspectActivityAsset(path: string, originalFilename: string, size: number): Promise<{ kind: "image" | "attachment"; mimeType: string }> {
  const extension = originalFilename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const allowed: Record<string, { kind: "image" | "attachment"; mimeType: string }> = {
    ".png": { kind: "image", mimeType: "image/png" },
    ".jpg": { kind: "image", mimeType: "image/jpeg" },
    ".jpeg": { kind: "image", mimeType: "image/jpeg" },
    ".webp": { kind: "image", mimeType: "image/webp" },
    ".pdf": { kind: "attachment", mimeType: "application/pdf" },
    ".docx": { kind: "attachment", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    ".xlsx": { kind: "attachment", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    ".csv": { kind: "attachment", mimeType: "text/csv; charset=utf-8" },
    ".txt": { kind: "attachment", mimeType: "text/plain; charset=utf-8" },
    ".zip": { kind: "attachment", mimeType: "application/zip" },
  };
  const detected = allowed[extension];
  if (!detected) throw new HttpError(415, "Use PNG, JPEG, WebP, PDF, DOCX, XLSX, CSV, TXT, or ZIP teaching files");
  if (detected.kind === "image" && size > 10 * 1024 * 1024) throw new HttpError(413, "Images must be 10 MB or smaller");
  const handle = await open(path, "r");
  const header = Buffer.alloc(16);
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  const signatureValid = extension === ".png"
    ? header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : extension === ".jpg" || extension === ".jpeg"
      ? header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
      : extension === ".webp"
        ? header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WEBP"
        : extension === ".pdf"
          ? header.subarray(0, 5).toString() === "%PDF-"
          : [".docx", ".xlsx", ".zip"].includes(extension)
            ? header[0] === 0x50 && header[1] === 0x4b
            : !header.includes(0);
  if (!signatureValid) throw new HttpError(415, "The teaching file content does not match its extension");
  return detected;
}

function normalizeAssetFilename(value: string): string {
  const cleaned = cleanOriginalFilename(value).normalize("NFKC");
  const safe = cleaned.replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-");
  return (safe || "teaching-file").slice(-140);
}

function nonNegativeNumber(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new HttpError(400, `${label} must be zero or greater`);
  return number;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new HttpError(400, `${label} must be a non-negative whole number`);
  return parsed;
}

function requiredQuery(request: Request, name: string): string {
  const value = optionalQuery(request, name);
  if (!value) throw new HttpError(400, `Missing query parameter: ${name}`);
  return value;
}

function optionalQuery(request: Request, name: string): string | null {
  const value = request.query[name];
  if (value !== undefined && typeof value !== "string") throw new HttpError(400, `Invalid ${name}`);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function routeParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string" || !value) throw new HttpError(400, `Missing route parameter: ${name}`);
  return value;
}
