import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createPasswordRecord, normalizeLoginIdentifier } from "./security.js";
import { HttpError } from "./errors.js";

export const ACTIVATION_HOURS = 48;
export type ActivationState = "not_issued" | "unclaimed" | "expired" | "password_change_required" | "activated" | "legacy_password_change" | "existing_credentials";

export function activationState(db: DatabaseSync, userId: string): ActivationState {
  const row = db.prepare("SELECT * FROM managed_accounts WHERE user_id=?").get(userId);
  if (!row) {
    const credential = db.prepare("SELECT must_change_password FROM auth_credentials WHERE user_id=?").get(userId);
    return !credential ? "not_issued" : credential.must_change_password ? "legacy_password_change" : "existing_credentials";
  }
  if (row.activated_at) return "activated";
  if (!row.activation_expires_at) return "not_issued";
  if (Date.parse(String(row.activation_expires_at)) <= Date.now()) return "expired";
  return row.activation_claimed_at ? "password_change_required" : "unclaimed";
}

/** Caller owns the transaction and authorization. No secret survives outside its hash. */
export function issueActivation(db: DatabaseSync, userId: string) {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(userId);
  if (!user) throw new HttpError(404, "Account not found");
  const existing = db.prepare("SELECT login_identifier FROM auth_credentials WHERE user_id=?").get(userId);
  const identifier = existing?.login_identifier ?? user.student_number;
  if (!identifier) throw new HttpError(409, "This faculty account needs an explicit username before activation");
  const temporaryPassword = randomBytes(24).toString("base64url");
  const password = createPasswordRecord(temporaryPassword);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ACTIVATION_HOURS * 3600000).toISOString();
  db.prepare(`INSERT INTO auth_credentials (user_id,login_identifier,login_identifier_normalized,password_hash,password_salt,password_params_json,must_change_password,password_changed_at,created_at)
    VALUES (?,?,?,?,?,?,1,NULL,?) ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,password_salt=excluded.password_salt,
    password_params_json=excluded.password_params_json,must_change_password=1,password_changed_at=NULL`)
    .run(userId,String(identifier),normalizeLoginIdentifier(String(identifier)),password.passwordHash,password.passwordSalt,password.passwordParams,now);
  db.prepare(`INSERT INTO managed_accounts(user_id,activation_expires_at,credential_version) VALUES (?,?,1)
    ON CONFLICT(user_id) DO UPDATE SET activation_expires_at=excluded.activation_expires_at,activation_claimed_at=NULL,activated_at=NULL,credential_version=credential_version+1`).run(userId,expiresAt);
  db.prepare("UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").run(now,userId);
  return { userId, identifier: String(identifier), temporaryPassword, expiresAt };
}

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = work(); db.exec("COMMIT"); return result; }
  catch (error) {
    db.exec("ROLLBACK");
    if (error instanceof Error && /constraint|_mismatch|_in_use/i.test(error.message)) {
      throw new HttpError(409, "The configuration conflicts with an existing identity, placement, or referenced record. Reload and review it.", "configuration_conflict");
    }
    throw error;
  }
}
