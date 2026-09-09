import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { FACULTY_ID, SECOND_STUDENT_ID, STUDENT_ID } from "./db.js";
import { createPasswordRecord, normalizeLoginIdentifier } from "./security.js";

export interface DemoAccount {
  userId: string;
  role: "faculty" | "student";
  displayName: string;
  loginIdentifier: string;
  password: string;
  studentNumber: string | null;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    userId: FACULTY_ID,
    role: "faculty",
    displayName: "Faculty Demo",
    loginIdentifier: "faculty-demo",
    password: "faculty-demo",
    studentNumber: null,
  },
  {
    userId: STUDENT_ID,
    role: "student",
    displayName: "Student Demo",
    loginIdentifier: "2026-00001",
    password: "2026-00001",
    studentNumber: "2026-00001",
  },
  {
    userId: SECOND_STUDENT_ID,
    role: "student",
    displayName: "Second Student",
    loginIdentifier: "2026-00002",
    password: "2026-00002",
    studentNumber: "2026-00002",
  },
];

export function seedDemoAccounts(db: DatabaseSync): DemoAccount[] {
  const prepared = DEMO_ACCOUNTS.map((account) => ({
    account,
    password: createPasswordRecord(account.password),
  }));
  const now = new Date().toISOString();
  const findUser = db.prepare("SELECT role FROM users WHERE id = ?");
  const updateUser = db.prepare(`
    UPDATE users SET display_name = ?, student_number = ? WHERE id = ?
  `);
  const upsertCredential = db.prepare(`
    INSERT INTO auth_credentials (
      user_id, login_identifier, login_identifier_normalized, password_hash, password_salt,
      password_params_json, must_change_password, password_changed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      login_identifier = excluded.login_identifier,
      login_identifier_normalized = excluded.login_identifier_normalized,
      password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      password_params_json = excluded.password_params_json,
      must_change_password = 0,
      password_changed_at = excluded.password_changed_at
  `);
  const revokeSessions = db.prepare(`
    UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL
  `);
  const addAuditEvent = db.prepare(`
    INSERT INTO auth_audit_events (
      id, user_id, actor_user_id, event_type, details_json, source_address, created_at
    ) VALUES (?, ?, NULL, 'demo_credentials_seeded', ?, 'local-maintenance', ?)
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { account, password } of prepared) {
      const user = findUser.get(account.userId) as { role: string } | undefined;
      if (!user || user.role !== account.role) {
        throw new Error(`Required ${account.role} demo identity is missing: ${account.userId}`);
      }
      updateUser.run(account.displayName, account.studentNumber, account.userId);
      upsertCredential.run(
        account.userId,
        account.loginIdentifier,
        normalizeLoginIdentifier(account.loginIdentifier),
        password.passwordHash,
        password.passwordSalt,
        password.passwordParams,
        now,
        now,
      );
      revokeSessions.run(now, account.userId);
      addAuditEvent.run(
        randomUUID(),
        account.userId,
        JSON.stringify({ loginIdentifier: account.loginIdentifier }),
        now,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return DEMO_ACCOUNTS.map((account) => ({ ...account }));
}
