import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  LAB_2A_ID,
  LAB_2AX_ID,
  SUBJECT_OFFERING_ID,
  migrateAtomDatabase,
  openAtomDatabase,
} from "./db.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "atom-db-test-"));
  temporaryRoots.push(root);
  return root;
}

describe("ATOM database migrations", () => {
  it("creates the subject foundation on a fresh database and is idempotent", () => {
    const root = temporaryRoot();
    const first = openAtomDatabase(root);
    const activityBefore = first.db.prepare(`
      SELECT id, current_release_id FROM activities WHERE title = 'Laboratory Activity 01'
    `).get() as { id: string; current_release_id: string };
    expect(first.db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 6 });
    expect(first.db.prepare("SELECT grading_period FROM activities WHERE id = ?").get(activityBefore.id)).toEqual({ grading_period: "midterm" });
    expect(first.db.prepare("SELECT COUNT(*) AS count FROM activity_targets WHERE activity_id = ?").get(activityBefore.id)).toEqual({ count: 2 });
    expect(first.db.prepare("SELECT COUNT(*) AS count FROM activity_release_scopes WHERE release_id = ?").get(activityBefore.current_release_id)).toEqual({ count: 2 });
    expect(first.db.prepare("SELECT json_extract(content_json, '$.version') AS version FROM activities WHERE id = ?").get(activityBefore.id)).toEqual({ version: 1 });
    expect(first.db.prepare("SELECT must_change_password FROM auth_credentials WHERE user_id = 'user-student-demo'").get()).toEqual({ must_change_password: 1 });
    expect(first.db.prepare("SELECT COUNT(*) AS count FROM auth_credentials WHERE user_id = 'user-faculty-demo'").get()).toEqual({ count: 0 });
    expect(first.db.prepare("SELECT topic_id, manual_position FROM activities WHERE id = ?").get(activityBefore.id)).toEqual({ topic_id: null, manual_position: null });
    expect(first.db.prepare("SELECT json_extract(blueprint_json, '$.version') AS version FROM activities WHERE id = ?").get(activityBefore.id)).toEqual({ version: 1 });
    first.db.close();

    const second = openAtomDatabase(root);
    const activityAfter = second.db.prepare(`
      SELECT id, current_release_id FROM activities WHERE title = 'Laboratory Activity 01'
    `).get() as { id: string; current_release_id: string };
    expect(activityAfter).toEqual(activityBefore);
    expect(second.db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 6 });
    second.db.close();
  });

  it("upgrades the current laboratory schema without changing stored relationship IDs", () => {
    const root = temporaryRoot();
    const path = join(root, "legacy.sqlite");
    const legacy = new DatabaseSync(path);
    createCurrentSchemaFixture(legacy);
    migrateAtomDatabase(legacy);

    expect(legacy.prepare("SELECT subject_offering_id, grading_period FROM activities WHERE id = 'activity-existing'").get()).toEqual({
      subject_offering_id: SUBJECT_OFFERING_ID,
      grading_period: "midterm",
    });
    expect(legacy.prepare("SELECT release_id FROM submissions WHERE id = 'submission-existing'").get()).toEqual({ release_id: "release-existing" });
    expect(legacy.prepare("SELECT COUNT(*) AS count FROM activity_targets WHERE activity_id = 'activity-existing' AND teaching_group_id IN (?, ?)").get(LAB_2A_ID, LAB_2AX_ID)).toEqual({ count: 2 });
    expect(legacy.prepare("SELECT is_current_submission FROM submissions WHERE id = 'submission-existing'").get()).toEqual({ is_current_submission: 1 });
    expect(legacy.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 6 });
    expect(legacy.prepare("SELECT draft_revision, accepted_extensions_json FROM activities WHERE id = 'activity-existing'").get()).toEqual({ draft_revision: 1, accepted_extensions_json: '[\".py\",\".zip\"]' });
    expect(legacy.prepare("SELECT json_extract(content_json, '$.sections[0].title') AS title FROM activities WHERE id = 'activity-existing'").get()).toEqual({ title: "Activity overview" });
    expect(legacy.prepare("SELECT topic_id, manual_position FROM activities WHERE id = 'activity-existing'").get()).toEqual({ topic_id: null, manual_position: null });
    expect(legacy.prepare("SELECT json_extract(blueprint_json, '$.mode') AS mode FROM activities WHERE id = 'activity-existing'").get()).toEqual({ mode: "simple" });
    expect((legacy.prepare("PRAGMA table_info(submissions)").all() as Array<{ name: string }>).map((column) => column.name)).toEqual(expect.arrayContaining(["completed_through_part_id", "validation_json"]));

    migrateAtomDatabase(legacy);
    expect(legacy.prepare("SELECT COUNT(*) AS count FROM activity_release_scopes WHERE release_id = 'release-existing'").get()).toEqual({ count: 2 });
    legacy.close();
  });

  it("repairs upgraded authentication sessions that predate preview identities", () => {
    const root = temporaryRoot();
    const database = openAtomDatabase(root);
    try {
      database.db.prepare("DELETE FROM schema_migrations WHERE version = 4").run();
      database.db.exec("ALTER TABLE auth_sessions DROP COLUMN development_preview");
      expect((database.db.prepare("PRAGMA table_info(auth_sessions)").all() as Array<{ name: string }>)
        .some((column) => column.name === "development_preview")).toBe(false);

      migrateAtomDatabase(database.db);

      const repaired = database.db.prepare("PRAGMA table_info(auth_sessions)").all() as Array<{
        name: string;
        dflt_value: string | null;
      }>;
      expect(repaired.find((column) => column.name === "development_preview")?.dflt_value).toBe("0");
      expect(database.db.prepare("SELECT name FROM schema_migrations WHERE version = 4").get()).toEqual({
        name: "repair_auth_session_preview_flag",
      });
    } finally {
      database.db.close();
    }
  });
});

function createCurrentSchemaFixture(db: DatabaseSync): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE subjects (
      id TEXT PRIMARY KEY, code TEXT NOT NULL, title TEXT NOT NULL,
      term TEXT NOT NULL, section_label TEXT NOT NULL
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY, student_number TEXT UNIQUE, display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('faculty', 'student'))
    );
    CREATE TABLE activities (
      id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subjects(id), title TEXT NOT NULL,
      instructions TEXT NOT NULL, requirements_json TEXT NOT NULL DEFAULT '[]', opens_at TEXT NOT NULL,
      deadline_at TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
      current_release_id TEXT, max_bytes INTEGER NOT NULL DEFAULT 52428800,
      created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE activity_releases (
      id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id), version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL, published_at TEXT NOT NULL, published_by TEXT NOT NULL REFERENCES users(id),
      UNIQUE(activity_id, version)
    );
    CREATE TABLE submissions (
      id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id),
      release_id TEXT NOT NULL REFERENCES activity_releases(id), student_id TEXT NOT NULL REFERENCES users(id),
      original_filename TEXT NOT NULL, normalized_filename TEXT NOT NULL, stored_path TEXT NOT NULL,
      mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, received_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, status TEXT NOT NULL CHECK (status = 'fully_received'),
      is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
      UNIQUE(activity_id, student_id, idempotency_key)
    );
    CREATE UNIQUE INDEX submissions_one_current ON submissions(activity_id, student_id) WHERE is_current = 1;
    CREATE TABLE evaluations (
      id TEXT PRIMARY KEY, submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id), score REAL NOT NULL,
      manual_deduction REAL NOT NULL DEFAULT 0, comments TEXT NOT NULL DEFAULT '', annotations TEXT NOT NULL DEFAULT '',
      evaluated_by TEXT NOT NULL REFERENCES users(id), evaluated_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO subjects VALUES ('subject-itcc47-demo', 'ITCC47', 'Data Structures and Algorithms', 'AY 2026–2027 · First Semester', '2A / 2Ax');
    INSERT INTO users VALUES ('user-faculty-demo', NULL, 'Faculty Demo', 'faculty');
    INSERT INTO users VALUES ('user-student-demo', '2026-00001', 'Student Demo', 'student');
    INSERT INTO users VALUES ('user-student-two', '2026-00002', 'Second Student', 'student');
    INSERT INTO activities VALUES (
      'activity-existing', 'subject-itcc47-demo', 'Existing Activity', 'Existing instructions', '[]',
      '2026-08-01T00:00:00.000Z', '2026-08-31T00:00:00.000Z', 'published', 'release-existing',
      52428800, 'user-faculty-demo', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
    );
    INSERT INTO activity_releases VALUES (
      'release-existing', 'activity-existing', 1,
      '{"title":"Existing Activity","instructions":"Existing instructions","requirements":[],"opensAt":"2026-08-01T00:00:00.000Z","deadlineAt":"2026-08-31T00:00:00.000Z","acceptedExtensions":[".py"],"maxBytes":52428800}',
      '2026-08-01T00:00:00.000Z', 'user-faculty-demo'
    );
    INSERT INTO submissions VALUES (
      'submission-existing', 'activity-existing', 'release-existing', 'user-student-demo', 'solution.py',
      '2026-00001_existing_r1.py', 'uploads/existing.py', 'text/x-python', 10, 'abc',
      '2026-08-02T00:00:00.000Z', 'existing-key', 'fully_received', 1
    );
  `);
}
