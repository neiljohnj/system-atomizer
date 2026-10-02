import type { DatabaseSync } from "node:sqlite";

/** Additive upgrade. Unknown legacy catalog identities and placement history stay unknown. */
export function migrateAcademicSetup(db: DatabaseSync): void {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=7").get()) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE courses (id TEXT PRIMARY KEY, code TEXT NOT NULL COLLATE NOCASE UNIQUE, title TEXT NOT NULL);
      ALTER TABLE subject_offerings ADD COLUMN course_id TEXT REFERENCES courses(id);
      ALTER TABLE subject_offerings ADD COLUMN display_label TEXT NOT NULL DEFAULT '';
      ALTER TABLE subject_offerings ADD COLUMN setup_state TEXT NOT NULL DEFAULT 'legacy' CHECK(setup_state IN ('legacy','draft','ready'));
      ALTER TABLE subject_offerings ADD COLUMN required_components_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE subject_offerings ADD COLUMN configuration_locked_at TEXT;
      ALTER TABLE subject_offerings ADD COLUMN setup_revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE subject_offerings ADD COLUMN setup_issue TEXT;
      CREATE UNIQUE INDEX offerings_catalog_term ON subject_offerings(course_id,academic_term_id) WHERE course_id IS NOT NULL;
      CREATE TABLE installation_owners (user_id TEXT PRIMARY KEY REFERENCES users(id), granted_at TEXT NOT NULL);
      CREATE TABLE offering_setup_managers (
        offering_id TEXT NOT NULL REFERENCES subject_offerings(id), user_id TEXT NOT NULL REFERENCES users(id),
        granted_by TEXT NOT NULL REFERENCES users(id), granted_at TEXT NOT NULL, PRIMARY KEY(offering_id,user_id));
      CREATE TABLE group_associations (
        offering_id TEXT NOT NULL REFERENCES subject_offerings(id), lecture_id TEXT NOT NULL REFERENCES teaching_groups(id),
        laboratory_id TEXT NOT NULL REFERENCES teaching_groups(id), PRIMARY KEY(lecture_id,laboratory_id));
      CREATE TABLE managed_accounts (
        user_id TEXT PRIMARY KEY REFERENCES users(id), activation_expires_at TEXT, activation_claimed_at TEXT,
        activated_at TEXT, credential_version INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE roster_batches (
        offering_id TEXT NOT NULL REFERENCES subject_offerings(id), actor_id TEXT NOT NULL REFERENCES users(id),
        request_key TEXT NOT NULL, request_digest TEXT NOT NULL, result_json TEXT NOT NULL,
        PRIMARY KEY(offering_id,actor_id,request_key));
      UPDATE subject_offerings SET display_label=subject_code,
        configuration_locked_at=(SELECT MIN(r.published_at) FROM activities a JOIN activity_releases r ON r.activity_id=a.id WHERE a.subject_offering_id=subject_offerings.id);
      UPDATE subject_offerings SET configuration_locked_at=COALESCE(configuration_locked_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        WHERE EXISTS(SELECT 1 FROM activities a WHERE a.subject_offering_id=subject_offerings.id AND (a.status='published' OR a.current_release_id IS NOT NULL));
      UPDATE subject_offerings SET setup_issue='Legacy placement crosses offerings; setup is quarantined pending review.'
        WHERE id IN (SELECT e.subject_offering_id FROM student_group_placements p JOIN enrollments e ON e.id=p.enrollment_id JOIN teaching_groups g ON g.id=p.teaching_group_id WHERE e.subject_offering_id<>g.subject_offering_id)
           OR id IN (SELECT g.subject_offering_id FROM student_group_placements p JOIN enrollments e ON e.id=p.enrollment_id JOIN teaching_groups g ON g.id=p.teaching_group_id WHERE e.subject_offering_id<>g.subject_offering_id);
      CREATE TRIGGER publication_locks_setup AFTER INSERT ON activity_releases BEGIN
        UPDATE subject_offerings SET configuration_locked_at=COALESCE(configuration_locked_at,NEW.published_at)
          WHERE id=(SELECT subject_offering_id FROM activities WHERE id=NEW.activity_id);
      END;
      CREATE TRIGGER permanent_setup_lock BEFORE UPDATE OF configuration_locked_at ON subject_offerings
        WHEN OLD.configuration_locked_at IS NOT NULL AND NEW.configuration_locked_at IS NOT OLD.configuration_locked_at
        BEGIN SELECT RAISE(ABORT,'configuration_locked'); END;
    `);
    for (const action of ["INSERT", "UPDATE"] as const) {
      db.exec(`CREATE TRIGGER placement_scope_${action.toLowerCase()} BEFORE ${action} ON student_group_placements
        WHEN NOT EXISTS(SELECT 1 FROM enrollments e JOIN teaching_groups g ON g.subject_offering_id=e.subject_offering_id
          WHERE e.id=NEW.enrollment_id AND g.id=NEW.teaching_group_id)
        BEGIN SELECT RAISE(ABORT,'placement_offering_mismatch'); END;
        CREATE TRIGGER association_scope_${action.toLowerCase()} BEFORE ${action} ON group_associations
        WHEN NOT EXISTS(SELECT 1 FROM teaching_groups l JOIN teaching_groups b ON b.subject_offering_id=l.subject_offering_id
          WHERE l.id=NEW.lecture_id AND b.id=NEW.laboratory_id AND l.subject_offering_id=NEW.offering_id AND l.component_kind='lecture' AND b.component_kind='laboratory')
        BEGIN SELECT RAISE(ABORT,'association_scope_mismatch'); END;`);
    }
    db.exec(`
      CREATE TRIGGER enrollment_scope_update BEFORE UPDATE OF subject_offering_id ON enrollments
        WHEN EXISTS(SELECT 1 FROM student_group_placements p JOIN teaching_groups g ON g.id=p.teaching_group_id WHERE p.enrollment_id=OLD.id AND g.subject_offering_id<>NEW.subject_offering_id)
        BEGIN SELECT RAISE(ABORT,'placement_offering_mismatch'); END;
      CREATE TRIGGER group_identity_update BEFORE UPDATE OF subject_offering_id,component_kind ON teaching_groups
        WHEN EXISTS(SELECT 1 FROM student_group_placements p JOIN enrollments e ON e.id=p.enrollment_id WHERE p.teaching_group_id=OLD.id AND e.subject_offering_id<>NEW.subject_offering_id)
          OR EXISTS(SELECT 1 FROM group_associations x WHERE (x.lecture_id=OLD.id AND (x.offering_id<>NEW.subject_offering_id OR NEW.component_kind<>'lecture')) OR (x.laboratory_id=OLD.id AND (x.offering_id<>NEW.subject_offering_id OR NEW.component_kind<>'laboratory')))
        BEGIN SELECT RAISE(ABORT,'group_identity_in_use'); END;
    `);
    // Preserve unsafe legacy rows verbatim. The operator sees quarantine, never an invented repair.
    if (db.prepare("PRAGMA foreign_key_check").all().length) {
      db.prepare("UPDATE subject_offerings SET setup_issue=COALESCE(setup_issue,?)").run("Legacy foreign-key violations require operator review; setup is quarantined.");
    }
    const integrity = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    if (integrity.integrity_check !== "ok") throw new Error("Migration preflight failed: SQLite integrity check. Restore and inspect a private copy.");
    db.prepare("INSERT INTO schema_migrations VALUES (7,?,?)").run("fixed_roster_academic_setup", new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
