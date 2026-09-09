import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { validateActivityDocument } from "./activity-content.js";
import { validateActivityBlueprint } from "./activity-blueprint.js";
import { AUTHORING_STRESS_FIXTURES } from "./authoring-fixtures.js";
import { FACULTY_ID, LAB_2AX_ID, LAB_2A_ID, LEGACY_SUBJECT_ID, SUBJECT_OFFERING_ID, openAtomDatabase } from "./db.js";

const refresh = process.argv.includes("--refresh");
const { db, dataDir } = openAtomDatabase(process.cwd());
const now = new Date().toISOString();
const topicId = "topic-authoring-stress-tests";

const offering = db.prepare("SELECT id FROM subject_offerings WHERE id = ?").get(SUBJECT_OFFERING_ID);
if (!offering) throw new Error("The sample ITCC47 subject offering is unavailable. Start ATOM once before seeding the corpus.");
db.prepare(`INSERT OR IGNORE INTO assessment_topics (id, subject_offering_id, grading_period, title, manual_position, created_by, created_at, updated_at) VALUES (?, ?, 'midterm', 'Authoring stress tests', NULL, ?, ?, ?)`)
  .run(topicId, SUBJECT_OFFERING_ID, FACULTY_ID, now, now);
const finalTopicId = `${topicId}-final`;
db.prepare(`INSERT OR IGNORE INTO assessment_topics (id, subject_offering_id, grading_period, title, manual_position, created_by, created_at, updated_at) VALUES (?, ?, 'final_term', 'Authoring stress tests', NULL, ?, ?, ?)`)
  .run(finalTopicId, SUBJECT_OFFERING_ID, FACULTY_ID, now, now);

let created = 0;
let refreshed = 0;
let skipped = 0;
let assetsAdded = 0;
for (const fixture of AUTHORING_STRESS_FIXTURES) {
  const content = validateActivityDocument(fixture.document);
  const blueprint = validateActivityBlueprint(fixture.blueprint);
  const existing = db.prepare("SELECT id, status, draft_revision FROM activities WHERE id = ?").get(fixture.id) as { id: string; status: string; draft_revision: number } | undefined;
  if (existing) {
    const releaseCount = Number((db.prepare("SELECT COUNT(*) AS count FROM activity_releases WHERE activity_id = ?").get(fixture.id) as { count: number }).count);
    const submissionCount = Number((db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE activity_id = ?").get(fixture.id) as { count: number }).count);
    if (!refresh || existing.status !== "draft" || existing.draft_revision !== 1 || releaseCount || submissionCount) { skipped += 1; continue; }
    db.prepare("UPDATE activities SET title = ?, content_json = ?, blueprint_json = ?, grading_period = ?, topic_id = ?, instructions = ?, requirements_json = ?, updated_at = ? WHERE id = ?")
      .run(fixture.title, JSON.stringify(content), JSON.stringify(blueprint), fixture.gradingPeriod, fixture.gradingPeriod === "midterm" ? topicId : finalTopicId, fixture.title, JSON.stringify([]), now, fixture.id);
    refreshed += 1;
    continue;
  }
  const opensAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const deadlineAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO activities (id, subject_id, subject_offering_id, grading_period, title, instructions, requirements_json, opens_at, deadline_at, status, max_bytes, created_by, created_at, updated_at, content_json, draft_revision, accepted_extensions_json, last_edited_by, topic_id, manual_position, blueprint_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?)`)
      .run(fixture.id, LEGACY_SUBJECT_ID, SUBJECT_OFFERING_ID, fixture.gradingPeriod, fixture.title, fixture.title, JSON.stringify([]), opensAt, deadlineAt, 50 * 1024 * 1024, FACULTY_ID, now, now, JSON.stringify(content), JSON.stringify([".py", ".zip"]), FACULTY_ID, fixture.gradingPeriod === "midterm" ? topicId : finalTopicId, JSON.stringify(blueprint));
    db.prepare("INSERT INTO activity_targets (activity_id, teaching_group_id) VALUES (?, ?)").run(fixture.id, LAB_2A_ID);
    db.prepare("INSERT INTO activity_targets (activity_id, teaching_group_id) VALUES (?, ?)").run(fixture.id, LAB_2AX_ID);
    db.exec("COMMIT");
    created += 1;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
const commandRow = db.prepare("SELECT status, draft_revision FROM activities WHERE id = 'stress-command-resource-processor'").get() as { status: string; draft_revision: number } | undefined;
const commandHasRelease = Number((db.prepare("SELECT COUNT(*) AS count FROM activity_releases WHERE activity_id = 'stress-command-resource-processor'").get() as { count: number }).count) > 0;
if (commandRow?.status === "draft" && commandRow.draft_revision === 1 && !commandHasRelease) {
  for (let level = 1; level <= 4; level += 1) {
    const assetId = `stress-command-starter-level-${level}`;
    if (db.prepare("SELECT 1 FROM activity_assets WHERE id = ?").get(assetId)) continue;
    const filename = `command-resource-level${level}.py`;
    const source = join(process.cwd(), "server", "fixtures", "authoring", filename);
    const stored = join(dataDir, "uploads", "activity-assets", "stress-command-resource-processor", assetId, filename);
    mkdirSync(dirname(stored), { recursive: true });
    copyFileSync(source, stored);
    const bytes = readFileSync(source);
    db.prepare(`INSERT INTO activity_assets (id, activity_id, uploaded_by, kind, original_filename, normalized_filename, stored_path, mime_type, size_bytes, sha256, created_at) VALUES (?, 'stress-command-resource-processor', ?, 'attachment', ?, ?, ?, 'text/x-python', ?, ?, ?)`)
      .run(assetId, FACULTY_ID, filename, filename, relative(dataDir, stored), statSync(stored).size, createHash("sha256").update(bytes).digest("hex"), now);
    assetsAdded += 1;
  }
}
db.close();
console.log(`Authoring stress corpus: ${created} created, ${refreshed} refreshed, ${skipped} preserved; ${assetsAdded} starter files added.`);
