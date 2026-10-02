import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { legacyActivityDocument } from "./activity-content.js";
import { defaultActivityBlueprint } from "./activity-blueprint.js";
import { createPasswordRecord, normalizeLoginIdentifier } from "./security.js";
import { migrateAcademicSetup } from "./academic-migration.js";

export const FACULTY_ID = "user-faculty-demo";
export const STUDENT_ID = "user-student-demo";
export const SECOND_STUDENT_ID = "user-student-two";
export const LEGACY_SUBJECT_ID = "subject-itcc47-demo";
export const ACADEMIC_TERM_ID = "term-ay-2026-2027-first-semester";
export const SUBJECT_OFFERING_ID = "offering-itcc47-2026-first";
export const LECTURE_2A_ID = "group-itcc47-lecture-2a";
export const LAB_2A_ID = "group-itcc47-laboratory-2a";
export const LAB_2AX_ID = "group-itcc47-laboratory-2ax";

export interface AtomDatabase {
  db: DatabaseSync;
  dataDir: string;
}

export function openAtomDatabase(rootDir: string, options: { sample?: boolean } = {}): AtomDatabase {
  const dataDir = join(rootDir, "data");
  mkdirSync(dataDir, { recursive: true });

  const db = new DatabaseSync(join(dataDir, "atom.sqlite"));
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  migrateAtomDatabase(db, options);

  return { db, dataDir };
}

export function migrateAtomDatabase(db: DatabaseSync, options: { sample?: boolean } = {}): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  if (!hasMigration(db, 1)) {
    db.exec("BEGIN IMMEDIATE");
    try {
      createLegacySchema(db);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, ?, ?)",
      ).run("legacy_laboratory_mvp", new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  // Synthetic data is an explicit fresh-fixture choice, never normal initialization.
  if (options.sample && !hasMigration(db, 2)) seedLegacySample(db);

  if (!hasMigration(db, 2)) {
    applySubjectFoundation(db);
  }

  if (!hasMigration(db, 3)) {
    applyAuthenticationAndAuthoring(db);
  }

  if (!hasMigration(db, 4)) {
    repairAuthenticationSessionSchema(db);
  }

  if (!hasMigration(db, 5)) {
    applyAssessmentTopics(db);
  }

  if (!hasMigration(db, 6)) {
    applyStructuredActivityAuthoring(db);
  }
  migrateAcademicSetup(db);
}

function hasMigration(db: DatabaseSync, version: number): boolean {
  return Boolean(db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version));
}

function createLegacySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      term TEXT NOT NULL,
      section_label TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      student_number TEXT UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('faculty', 'student'))
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id),
      title TEXT NOT NULL,
      instructions TEXT NOT NULL,
      requirements_json TEXT NOT NULL DEFAULT '[]',
      opens_at TEXT NOT NULL,
      deadline_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
      current_release_id TEXT,
      max_bytes INTEGER NOT NULL DEFAULT 52428800,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_releases (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id),
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      published_at TEXT NOT NULL,
      published_by TEXT NOT NULL REFERENCES users(id),
      UNIQUE(activity_id, version)
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id),
      release_id TEXT NOT NULL REFERENCES activity_releases(id),
      student_id TEXT NOT NULL REFERENCES users(id),
      original_filename TEXT NOT NULL,
      normalized_filename TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      received_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status = 'fully_received'),
      is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
      UNIQUE(activity_id, student_id, idempotency_key)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS submissions_one_current
      ON submissions(activity_id, student_id)
      WHERE is_current = 1;

    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),
      score REAL NOT NULL,
      manual_deduction REAL NOT NULL DEFAULT 0,
      comments TEXT NOT NULL DEFAULT '',
      annotations TEXT NOT NULL DEFAULT '',
      evaluated_by TEXT NOT NULL REFERENCES users(id),
      evaluated_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function seedLegacySample(db: DatabaseSync): void {
  const subjectCount = Number(
    (db.prepare("SELECT COUNT(*) AS count FROM subjects").get() as { count: number }).count,
  );
  if (subjectCount > 0) return;

  const now = new Date();
  const opensAt = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const deadlineAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const createdAt = now.toISOString();
  const activityId = randomUUID();
  const releaseId = randomUUID();
  const requirements = [
    "Level 1 — accept and process the basic command set.",
    "Level 2 — organize the solution using the required functions.",
    "Level 3 — handle the complete dataset and validation rules.",
    "Level 4 — produce the final required behavior and output.",
  ];

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO subjects (id, code, title, term, section_label) VALUES (?, ?, ?, ?, ?)",
    ).run(
      LEGACY_SUBJECT_ID,
      "ITCC47",
      "Data Structures and Algorithms",
      "AY 2026–2027 · First Semester",
      "2A / 2Ax",
    );
    db.prepare(
      "INSERT INTO users (id, student_number, display_name, role) VALUES (?, ?, ?, ?)",
    ).run(FACULTY_ID, null, "Faculty Demo", "faculty");
    db.prepare(
      "INSERT INTO users (id, student_number, display_name, role) VALUES (?, ?, ?, ?)",
    ).run(STUDENT_ID, "2026-00001", "Student Demo", "student");
    db.prepare(
      "INSERT INTO users (id, student_number, display_name, role) VALUES (?, ?, ?, ?)",
    ).run(SECOND_STUDENT_ID, "2026-00002", "Second Student", "student");

    const instructions = "Write a Python program that processes a sequence of commands. Submit the source you want the instructor to evaluate. ATOM stores the most recently fully received upload as your current submission.";
    db.prepare(`
      INSERT INTO activities (
        id, subject_id, title, instructions, requirements_json, opens_at,
        deadline_at, status, current_release_id, max_bytes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?)
    `).run(
      activityId,
      LEGACY_SUBJECT_ID,
      "Laboratory Activity 01",
      instructions,
      JSON.stringify(requirements),
      opensAt,
      deadlineAt,
      releaseId,
      50 * 1024 * 1024,
      FACULTY_ID,
      createdAt,
      createdAt,
    );
    db.prepare(`
      INSERT INTO activity_releases (id, activity_id, version, snapshot_json, published_at, published_by)
      VALUES (?, ?, 1, ?, ?, ?)
    `).run(
      releaseId,
      activityId,
      JSON.stringify({
        title: "Laboratory Activity 01",
        instructions,
        requirements,
        opensAt,
        deadlineAt,
        acceptedExtensions: [".py", ".zip"],
        maxBytes: 50 * 1024 * 1024,
      }),
      createdAt,
      FACULTY_ID,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applySubjectFoundation(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE academic_terms (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        starts_on TEXT,
        ends_on TEXT
      );

      CREATE TABLE subject_offerings (
        id TEXT PRIMARY KEY,
        academic_term_id TEXT NOT NULL REFERENCES academic_terms(id),
        subject_code TEXT NOT NULL,
        subject_title TEXT NOT NULL,
        legacy_subject_id TEXT UNIQUE REFERENCES subjects(id),
        UNIQUE(academic_term_id, subject_code)
      );

      CREATE TABLE teaching_groups (
        id TEXT PRIMARY KEY,
        subject_offering_id TEXT NOT NULL REFERENCES subject_offerings(id),
        component_kind TEXT NOT NULL CHECK (component_kind IN ('lecture', 'laboratory', 'combined')),
        label TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(subject_offering_id, component_kind, label)
      );

      CREATE TABLE enrollments (
        id TEXT PRIMARY KEY,
        subject_offering_id TEXT NOT NULL REFERENCES subject_offerings(id),
        student_id TEXT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        UNIQUE(subject_offering_id, student_id)
      );

      CREATE TABLE student_group_placements (
        enrollment_id TEXT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
        teaching_group_id TEXT NOT NULL REFERENCES teaching_groups(id) ON DELETE CASCADE,
        PRIMARY KEY(enrollment_id, teaching_group_id)
      );

      CREATE TABLE faculty_group_assignments (
        faculty_id TEXT NOT NULL REFERENCES users(id),
        teaching_group_id TEXT NOT NULL REFERENCES teaching_groups(id) ON DELETE CASCADE,
        PRIMARY KEY(faculty_id, teaching_group_id)
      );

      CREATE TABLE activity_targets (
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        teaching_group_id TEXT NOT NULL REFERENCES teaching_groups(id),
        PRIMARY KEY(activity_id, teaching_group_id)
      );

      CREATE TABLE activity_release_scopes (
        release_id TEXT NOT NULL REFERENCES activity_releases(id) ON DELETE CASCADE,
        teaching_group_id TEXT NOT NULL REFERENCES teaching_groups(id),
        grading_period TEXT NOT NULL CHECK (grading_period IN ('midterm', 'final_term')),
        PRIMARY KEY(release_id, teaching_group_id)
      );
    `);

    if (db.prepare("SELECT 1 FROM subjects WHERE id=?").get(LEGACY_SUBJECT_ID)) {
    db.prepare("INSERT INTO academic_terms (id, label) VALUES (?, ?)").run(
      ACADEMIC_TERM_ID,
      "AY 2026–2027 · First Semester",
    );
    db.prepare(`
      INSERT INTO subject_offerings (
        id, academic_term_id, subject_code, subject_title, legacy_subject_id
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      SUBJECT_OFFERING_ID,
      ACADEMIC_TERM_ID,
      "ITCC47",
      "Data Structures and Algorithms",
      LEGACY_SUBJECT_ID,
    );
    const insertGroup = db.prepare(`
      INSERT INTO teaching_groups (id, subject_offering_id, component_kind, label, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertGroup.run(LECTURE_2A_ID, SUBJECT_OFFERING_ID, "lecture", "Lecture 2A", 10);
    insertGroup.run(LAB_2A_ID, SUBJECT_OFFERING_ID, "laboratory", "Laboratory 2A", 20);
    insertGroup.run(LAB_2AX_ID, SUBJECT_OFFERING_ID, "laboratory", "Laboratory 2Ax", 30);

    const assignFaculty = db.prepare(
      "INSERT INTO faculty_group_assignments (faculty_id, teaching_group_id) VALUES (?, ?)",
    );
    for (const groupId of [LECTURE_2A_ID, LAB_2A_ID, LAB_2AX_ID]) {
      assignFaculty.run(FACULTY_ID, groupId);
    }

    const insertEnrollment = db.prepare(`
      INSERT INTO enrollments (id, subject_offering_id, student_id) VALUES (?, ?, ?)
    `);
    const firstEnrollmentId = "enrollment-itcc47-student-demo";
    const secondEnrollmentId = "enrollment-itcc47-student-two";
    insertEnrollment.run(firstEnrollmentId, SUBJECT_OFFERING_ID, STUDENT_ID);
    insertEnrollment.run(secondEnrollmentId, SUBJECT_OFFERING_ID, SECOND_STUDENT_ID);
    const placeStudent = db.prepare(`
      INSERT INTO student_group_placements (enrollment_id, teaching_group_id) VALUES (?, ?)
    `);
    placeStudent.run(firstEnrollmentId, LECTURE_2A_ID);
    placeStudent.run(firstEnrollmentId, LAB_2A_ID);
    placeStudent.run(secondEnrollmentId, LECTURE_2A_ID);
    placeStudent.run(secondEnrollmentId, LAB_2AX_ID);
    }

    db.exec("ALTER TABLE activities ADD COLUMN subject_offering_id TEXT REFERENCES subject_offerings(id)");
    db.exec("ALTER TABLE activities ADD COLUMN grading_period TEXT CHECK (grading_period IN ('midterm', 'final_term'))");
    db.prepare(`
      UPDATE activities SET subject_offering_id = ?, grading_period = 'midterm'
      WHERE subject_id = ?
    `).run(SUBJECT_OFFERING_ID, LEGACY_SUBJECT_ID);

    const targetRows = db.prepare("SELECT id FROM activities WHERE subject_offering_id=?").all(SUBJECT_OFFERING_ID) as Array<{ id: string }>;
    const insertTarget = db.prepare(`
      INSERT INTO activity_targets (activity_id, teaching_group_id) VALUES (?, ?)
    `);
    const insertReleaseScope = db.prepare(`
      INSERT OR IGNORE INTO activity_release_scopes (release_id, teaching_group_id, grading_period)
      SELECT id, ?, 'midterm' FROM activity_releases WHERE activity_id = ?
    `);
    for (const activity of targetRows) {
      for (const groupId of [LAB_2A_ID, LAB_2AX_ID]) {
        insertTarget.run(activity.id, groupId);
        insertReleaseScope.run(groupId, activity.id);
      }
    }

    const submissionColumns = db.prepare("PRAGMA table_info(submissions)").all() as Array<{ name: string }>;
    if (submissionColumns.some((column) => column.name === "is_current")) {
      db.exec("DROP INDEX IF EXISTS submissions_one_current");
      db.exec("ALTER TABLE submissions RENAME COLUMN is_current TO is_current_submission");
    }
    db.exec(`
      CREATE UNIQUE INDEX submissions_one_current_submission
      ON submissions(activity_id, student_id)
      WHERE is_current_submission = 1
    `);

    db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (2, ?, ?)",
    ).run("subject_section_grading_period_foundation", now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyAuthenticationAndAuthoring(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE auth_credentials (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        login_identifier TEXT NOT NULL,
        login_identifier_normalized TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_params_json TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
        password_changed_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        user_agent TEXT NOT NULL DEFAULT '',
        development_preview INTEGER NOT NULL DEFAULT 0 CHECK (development_preview IN (0, 1))
      );
      CREATE INDEX auth_sessions_user ON auth_sessions(user_id, revoked_at);

      CREATE TABLE auth_audit_events (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        actor_user_id TEXT REFERENCES users(id),
        event_type TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        source_address TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX auth_audit_events_user ON auth_audit_events(user_id, created_at);

      CREATE TABLE activity_assets (
        id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        uploaded_by TEXT NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL CHECK (kind IN ('image', 'attachment')),
        original_filename TEXT NOT NULL,
        normalized_filename TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX activity_assets_activity ON activity_assets(activity_id);

      CREATE TABLE activity_release_assets (
        release_id TEXT NOT NULL REFERENCES activity_releases(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES activity_assets(id),
        original_filename TEXT NOT NULL,
        normalized_filename TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        PRIMARY KEY(release_id, asset_id)
      );

      CREATE TABLE activity_collaborators (
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        faculty_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        can_edit INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0, 1)),
        can_publish INTEGER NOT NULL DEFAULT 0 CHECK (can_publish IN (0, 1)),
        added_by TEXT NOT NULL REFERENCES users(id),
        added_at TEXT NOT NULL,
        PRIMARY KEY(activity_id, faculty_id)
      );
    `);

    db.exec("ALTER TABLE activities ADD COLUMN content_json TEXT");
    db.exec("ALTER TABLE activities ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 1");
    db.exec("ALTER TABLE activities ADD COLUMN accepted_extensions_json TEXT NOT NULL DEFAULT '[\".py\",\".zip\"]'");
    db.exec("ALTER TABLE activities ADD COLUMN last_edited_by TEXT REFERENCES users(id)");

    const activities = db.prepare("SELECT id, instructions, requirements_json, created_by FROM activities").all() as Array<{
      id: string;
      instructions: string;
      requirements_json: string;
      created_by: string;
    }>;
    const updateActivity = db.prepare("UPDATE activities SET content_json = ?, last_edited_by = ? WHERE id = ?");
    for (const activity of activities) {
      let requirements: string[] = [];
      try {
        const parsed = JSON.parse(activity.requirements_json) as unknown;
        requirements = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
      } catch {
        requirements = [];
      }
      updateActivity.run(
        JSON.stringify(legacyActivityDocument(activity.instructions, requirements)),
        activity.created_by,
        activity.id,
      );
    }

    const students = db.prepare(`
      SELECT id, student_number FROM users
      WHERE role = 'student' AND student_number IS NOT NULL
    `).all() as Array<{ id: string; student_number: string }>;
    const insertCredential = db.prepare(`
      INSERT INTO auth_credentials (
        user_id, login_identifier, login_identifier_normalized, password_hash, password_salt,
        password_params_json, must_change_password, password_changed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?)
    `);
    for (const student of students) {
      const password = createPasswordRecord(student.student_number);
      insertCredential.run(
        student.id,
        student.student_number,
        normalizeLoginIdentifier(student.student_number),
        password.passwordHash,
        password.passwordSalt,
        password.passwordParams,
        now,
      );
    }

    db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (3, ?, ?)",
    ).run("authentication_activity_authoring", now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function repairAuthenticationSessionSchema(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const sessionColumns = db.prepare("PRAGMA table_info(auth_sessions)").all() as Array<{ name: string }>;
    if (!sessionColumns.some((column) => column.name === "development_preview")) {
      db.exec(`
        ALTER TABLE auth_sessions
        ADD COLUMN development_preview INTEGER NOT NULL DEFAULT 0
        CHECK (development_preview IN (0, 1))
      `);
    }
    db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (4, ?, ?)",
    ).run("repair_auth_session_preview_flag", now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyAssessmentTopics(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE assessment_topics (
        id TEXT PRIMARY KEY,
        subject_offering_id TEXT NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
        grading_period TEXT NOT NULL CHECK (grading_period IN ('midterm', 'final_term')),
        title TEXT NOT NULL,
        manual_position INTEGER CHECK (manual_position IS NULL OR manual_position >= 0),
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX assessment_topics_unique_title
      ON assessment_topics(subject_offering_id, grading_period, lower(title));

      CREATE INDEX assessment_topics_stream_order
      ON assessment_topics(subject_offering_id, grading_period, manual_position);

      ALTER TABLE activities
      ADD COLUMN topic_id TEXT REFERENCES assessment_topics(id) ON DELETE SET NULL;

      ALTER TABLE activities
      ADD COLUMN manual_position INTEGER CHECK (manual_position IS NULL OR manual_position >= 0);

      CREATE INDEX activities_topic_order
      ON activities(subject_offering_id, grading_period, topic_id, manual_position);
    `);
    db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (5, ?, ?)",
    ).run("topic_based_assessment_stream", now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyStructuredActivityAuthoring(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const defaultBlueprint = JSON.stringify(defaultActivityBlueprint()).replaceAll("'", "''");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      ALTER TABLE activities
      ADD COLUMN blueprint_json TEXT NOT NULL DEFAULT '${defaultBlueprint}';

      ALTER TABLE submissions
      ADD COLUMN completed_through_part_id TEXT;

      ALTER TABLE submissions
      ADD COLUMN validation_json TEXT;
    `);
    db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (6, ?, ?)",
    ).run("structured_activity_authoring", now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
