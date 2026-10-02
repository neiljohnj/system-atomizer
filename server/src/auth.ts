import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { issueActivation, transaction } from "./account-activation.js";
import { HttpError } from "./errors.js";
import {
  createPasswordRecord,
  normalizeLoginIdentifier,
  validatePassword,
  verifyPassword,
} from "./security.js";

type Row = Record<string, unknown>;
export type Role = "faculty" | "student";

export interface AuthUser {
  id: string;
  studentNumber: string | null;
  displayName: string;
  role: Role;
}

export interface AuthSessionResult {
  currentUser: AuthUser;
  mustChangePassword: boolean;
  expiresAt: string;
  idleExpiresAt: string;
}

interface AttemptState {
  count: number;
  startedAt: number;
  blockedUntil: number;
}

const SESSION_COOKIE = "atom_session";
const ABSOLUTE_SESSION_MS = 8 * 60 * 60 * 1000;
const IDLE_SESSION_MS = 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 5 * 60 * 1000;

export class AuthService {
  private readonly attempts = new Map<string, AttemptState>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly options: { developmentPreviewEnabled: boolean; secureCookies: boolean; behindProxy?: boolean },
  ) {}

  setupStatus(): { setupRequired: boolean; httpWarning: boolean } {
    return { setupRequired: this.isSetupRequired(), httpWarning: !this.options.secureCookies };
  }

  session(request: Request, options: { allowPasswordChange?: boolean } = {}): AuthSessionResult {
    const token = parseCookies(request.header("cookie") ?? "")[SESSION_COOKIE];
    if (!token) throw new HttpError(401, "Sign in to continue", "authentication_required");
    const tokenHash = hashToken(token);
    const row = this.db.prepare(`
      SELECT s.*, u.student_number, u.display_name, u.role, c.must_change_password
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN auth_credentials c ON c.user_id = u.id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL
    `).get(tokenHash) as Row | undefined;
    if (!row) throw new HttpError(401, "Your ATOM session is no longer active", "authentication_required");
    const now = Date.now();
    const expiresAt = Date.parse(String(row.expires_at));
    const lastSeenAt = Date.parse(String(row.last_seen_at));
    if (now >= expiresAt || now - lastSeenAt >= IDLE_SESSION_MS) {
      this.db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?").run(new Date().toISOString(), tokenHash);
      throw new HttpError(401, "Your ATOM session expired. Sign in again.", "session_expired");
    }
    if (now - lastSeenAt >= 5 * 60 * 1000) {
      this.db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?").run(new Date(now).toISOString(), tokenHash);
    }
    const mustChangePassword = Number(row.must_change_password ?? 0) === 1 && Number(row.development_preview ?? 0) !== 1;
    const activation = this.db.prepare("SELECT * FROM managed_accounts WHERE user_id=?").get(String(row.user_id));
    if (activation && !activation.activated_at && (!activation.activation_expires_at || Date.parse(String(activation.activation_expires_at)) <= now)) {
      throw new HttpError(401, "Activation expired. Ask your operator to reissue access.", "activation_expired");
    }
    if (mustChangePassword && !options.allowPasswordChange) {
      throw new HttpError(403, "Change your temporary password before continuing", "password_change_required");
    }
    return {
      currentUser: userFromRow(row),
      mustChangePassword,
      expiresAt: String(row.expires_at),
      idleExpiresAt: new Date(now + IDLE_SESSION_MS).toISOString(),
    };
  }

  optionalSession(request: Request): AuthSessionResult | null {
    try {
      return this.session(request, { allowPasswordChange: true });
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) return null;
      throw error;
    }
  }

  async login(request: Request, response: Response, body: Record<string, unknown>): Promise<AuthSessionResult> {
    if (this.isSetupRequired()) throw new HttpError(409, "Complete ATOM setup before signing in", "setup_required");
    const identifier = requiredString(body.identifier, "Username or student number");
    const password = requiredString(body.password, "Password", false);
    const normalized = normalizeLoginIdentifier(identifier);
    const attemptKey = `${request.ip}|${normalized}`;
    this.assertNotThrottled(attemptKey);
    const row = this.db.prepare(`
      SELECT c.*, u.student_number, u.display_name, u.role
      FROM auth_credentials c JOIN users u ON u.id = c.user_id
      WHERE c.login_identifier_normalized = ?
    `).get(normalized) as Row | undefined;
    const valid = row ? await verifyPassword(
      password,
      String(row.password_salt),
      String(row.password_hash),
      String(row.password_params_json),
    ) : false;
    if (!row || !valid) {
      this.recordFailedAttempt(attemptKey);
      this.audit(null, null, "login_failed", { identifier: normalized }, request.ip ?? "");
      throw new HttpError(401, "Username, student number, or password is incorrect", "invalid_credentials");
    }
    this.attempts.delete(attemptKey);
    return transaction(this.db, () => {
      const latest = this.db.prepare("SELECT password_hash FROM auth_credentials WHERE user_id=?").get(String(row.user_id));
      if (latest?.password_hash !== row.password_hash) throw new HttpError(401, "Credentials changed. Sign in again.", "invalid_credentials");
      const activation = this.db.prepare("SELECT * FROM managed_accounts WHERE user_id=?").get(String(row.user_id));
      if (activation && !activation.activated_at) {
        if (!activation.activation_expires_at || Date.parse(String(activation.activation_expires_at)) <= Date.now()) throw new HttpError(401, "Activation expired. Ask your operator to reissue access.", "activation_expired");
        if (activation.activation_claimed_at) throw new HttpError(401, "Activation was already used. Finish the password change in your signed-in session, or request reissue.", "activation_used");
        this.db.prepare("UPDATE managed_accounts SET activation_claimed_at=? WHERE user_id=?").run(new Date().toISOString(),String(row.user_id));
      }
      return this.issueSession(response, String(row.user_id), request, "login_succeeded");
    });
  }

  logout(request: Request, response: Response): void {
    const token = parseCookies(request.header("cookie") ?? "")[SESSION_COOKIE];
    if (token) {
      const tokenHash = hashToken(token);
      const row = this.db.prepare("SELECT user_id FROM auth_sessions WHERE token_hash = ?").get(tokenHash) as Row | undefined;
      this.db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(new Date().toISOString(), tokenHash);
      this.audit(row ? String(row.user_id) : null, row ? String(row.user_id) : null, "logout", {}, request.ip ?? "");
    }
    clearSessionCookie(response, this.options.secureCookies);
  }

  async changePassword(request: Request, body: Record<string, unknown>): Promise<AuthSessionResult> {
    const current = this.session(request, { allowPasswordChange: true });
    const currentPassword = requiredString(body.currentPassword, "Current password", false);
    const newPassword = passwordValue(body.newPassword);
    const credential = this.db.prepare("SELECT * FROM auth_credentials WHERE user_id = ?").get(current.currentUser.id) as Row | undefined;
    if (!credential || !await verifyPassword(
      currentPassword,
      String(credential.password_salt),
      String(credential.password_hash),
      String(credential.password_params_json),
    )) {
      throw new HttpError(400, "Current password is incorrect", "invalid_current_password");
    }
    if (currentPassword === newPassword) throw new HttpError(400, "Choose a password different from the current password");
    const password = createPasswordRecord(newPassword);
    const now = new Date().toISOString();
    return transaction(this.db, () => {
    this.session(request, { allowPasswordChange: true });
    if (this.db.prepare("SELECT password_hash FROM auth_credentials WHERE user_id=?").get(current.currentUser.id)?.password_hash !== credential.password_hash) throw new HttpError(409, "Credentials changed. Sign in again.");
    this.db.prepare(`
      UPDATE auth_credentials SET password_hash = ?, password_salt = ?, password_params_json = ?,
        must_change_password = 0, password_changed_at = ? WHERE user_id = ?
    `).run(password.passwordHash, password.passwordSalt, password.passwordParams, now, current.currentUser.id);
    this.db.prepare("UPDATE managed_accounts SET activated_at=?,activation_expires_at=NULL WHERE user_id=?").run(now,current.currentUser.id);
    this.audit(current.currentUser.id, current.currentUser.id, "password_changed", {}, request.ip ?? "");
    return { ...current, mustChangePassword: false };
    });
  }

  initialize(request: Request, response: Response, body: Record<string, unknown>): AuthSessionResult {
    this.requireLoopback(request);
    if (!this.isSetupRequired()) throw new HttpError(409, "ATOM setup is already complete", "setup_complete");
    const displayName = requiredString(body.displayName, "Display name");
    const username = requiredString(body.username, "Username");
    const normalized = normalizeLoginIdentifier(username);
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized)) {
      throw new HttpError(400, "Username must be 3–64 characters using letters, numbers, dots, dashes, or underscores");
    }
    const password = createPasswordRecord(passwordValue(body.password));
    const duplicate = this.db.prepare("SELECT 1 FROM auth_credentials WHERE login_identifier_normalized = ?").get(normalized);
    if (duplicate) throw new HttpError(409, "That username is already in use");
    const fresh = !this.db.prepare("SELECT 1 FROM users LIMIT 1").get();
    const faculty = typeof body.facultyId === "string" ? this.db.prepare("SELECT id FROM users WHERE id=? AND role='faculty'").get(body.facultyId) : undefined;
    if (!fresh && !faculty) throw new HttpError(409, "Select the exact existing faculty identity on this host. Existing identities are never chosen automatically.", "faculty_selection_required");
    const facultyId = fresh ? randomUUID() : String(faculty!.id);
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.isSetupRequired()) throw new HttpError(409, "ATOM setup is already complete", "setup_complete");
      if (fresh) this.db.prepare("INSERT INTO users(id,display_name,role) VALUES (?,?,'faculty')").run(facultyId,displayName);
      else this.db.prepare("UPDATE users SET display_name=? WHERE id=?").run(displayName,facultyId);
      this.db.prepare(`
        INSERT INTO auth_credentials (
          user_id, login_identifier, login_identifier_normalized, password_hash, password_salt,
          password_params_json, must_change_password, password_changed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(facultyId, username.trim(), normalized, password.passwordHash, password.passwordSalt, password.passwordParams, now, now);
      if (fresh) this.db.prepare("INSERT INTO installation_owners VALUES (?,?)").run(facultyId,now);
      this.audit(facultyId, facultyId, "setup_completed", {}, request.ip ?? "");
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.issueSession(response, facultyId, request, "setup_login");
  }

  listRecoverableFaculty(request: Request): AuthUser[] {
    this.requireLoopback(request);
    return (this.db.prepare("SELECT * FROM users WHERE role = 'faculty' ORDER BY display_name").all() as Row[]).map(userFromRow);
  }

  resetFaculty(request: Request, facultyId: string): { temporaryPassword: string } {
    this.requireLoopback(request);
    const faculty = this.db.prepare("SELECT * FROM users WHERE id = ? AND role = 'faculty'").get(facultyId) as Row | undefined;
    if (!faculty) throw new HttpError(404, "Faculty account not found");
    return transaction(this.db, () => {
      if (!this.db.prepare("SELECT 1 FROM auth_credentials WHERE user_id=?").get(facultyId)) this.replaceCredential(facultyId, this.facultyLoginIdentifier(facultyId), randomBytes(24).toString("base64url"), true);
      const handoff = issueActivation(this.db, facultyId);
      this.audit(facultyId, null, "faculty_recovered_locally", {}, request.ip ?? "");
      return handoff;
    });
  }

  resetStudent(request: Request, actor: AuthUser, studentId: string) {
    const student = this.db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(studentId) as Row | undefined;
    if (!student?.student_number) throw new HttpError(404, "Student account not found");
    return transaction(this.db, () => {
      this.session(request);
      const handoff = issueActivation(this.db, studentId);
      this.audit(studentId, actor.id, "student_password_reset", {}, request.ip ?? "");
      return handoff;
    });
  }

  bootstrapOwner(request: Request, confirmUserId: unknown): void {
    this.requireLoopback(request);
    transaction(this.db, () => {
      const user = this.session(request).currentUser;
      if (user.role !== "faculty" || confirmUserId !== user.id) throw new HttpError(403, "Confirm the exact signed-in faculty identity for the operator grant");
      if (this.db.prepare("SELECT 1 FROM installation_owners LIMIT 1").get()) throw new HttpError(409, "An installation owner is already established");
      this.db.prepare("INSERT INTO installation_owners VALUES (?,?)").run(user.id,new Date().toISOString());
      this.audit(user.id,user.id,"installation_owner_granted_locally",{},request.ip ?? "");
    });
  }

  assumeIdentity(request: Request, response: Response, userId: string): AuthSessionResult {
    if (!this.options.developmentPreviewEnabled) throw new HttpError(404, "Development preview is disabled");
    const user = this.db.prepare("SELECT id FROM users WHERE id = ?").get(userId) as Row | undefined;
    if (!user) throw new HttpError(404, "Preview identity not found");
    return this.issueSession(response, userId, request, "development_identity_assumed", false);
  }

  revokeUserSessions(userId: string): void {
    this.db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(new Date().toISOString(), userId);
  }

  private issueSession(
    response: Response,
    userId: string,
    request: Request,
    eventType: string,
    respectPasswordState = true,
  ): AuthSessionResult {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ABSOLUTE_SESSION_MS);
    const credential = this.db.prepare("SELECT must_change_password FROM auth_credentials WHERE user_id = ?").get(userId) as Row | undefined;
    this.db.prepare(`
      INSERT INTO auth_sessions (
        token_hash, user_id, created_at, last_seen_at, expires_at, revoked_at, user_agent,
        development_preview
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(hashToken(token), userId, now.toISOString(), now.toISOString(), expiresAt.toISOString(), request.header("user-agent")?.slice(0, 300) ?? "", respectPasswordState ? 0 : 1);
    setSessionCookie(response, token, this.options.secureCookies);
    this.audit(userId, userId, eventType, {}, request.ip ?? "");
    const user = this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Row;
    return {
      currentUser: userFromRow(user),
      mustChangePassword: respectPasswordState && Number(credential?.must_change_password ?? 0) === 1,
      expiresAt: expiresAt.toISOString(),
      idleExpiresAt: new Date(now.getTime() + IDLE_SESSION_MS).toISOString(),
    };
  }

  private isSetupRequired(): boolean {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM auth_credentials c
      JOIN users u ON u.id = c.user_id WHERE u.role = 'faculty'
    `).get() as { count: number };
    return Number(row.count) === 0;
  }

  private replaceCredential(userId: string, identifier: string, passwordValue: string, mustChange: boolean): void {
    const password = createPasswordRecord(passwordValue);
    const normalized = normalizeLoginIdentifier(identifier);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO auth_credentials (
        user_id, login_identifier, login_identifier_normalized, password_hash, password_salt,
        password_params_json, must_change_password, password_changed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        login_identifier = excluded.login_identifier,
        login_identifier_normalized = excluded.login_identifier_normalized,
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        password_params_json = excluded.password_params_json,
        must_change_password = excluded.must_change_password,
        password_changed_at = NULL
    `).run(userId, identifier, normalized, password.passwordHash, password.passwordSalt, password.passwordParams, mustChange ? 1 : 0, now);
  }

  private facultyLoginIdentifier(userId: string): string {
    const row = this.db.prepare("SELECT login_identifier FROM auth_credentials WHERE user_id = ?").get(userId) as Row | undefined;
    return row ? String(row.login_identifier) : `faculty-${userId.slice(-6)}`;
  }

  private requireLoopback(request: Request): void {
    if (this.options.behindProxy) throw new HttpError(403, "Web maintenance is disabled while ATOM is configured behind a proxy. Use the host-only maintenance procedure.");
    const address = request.socket.remoteAddress ?? "";
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) {
      throw new HttpError(403, "This maintenance action is available only on the ATOM host computer");
    }
  }

  private assertNotThrottled(key: string): void {
    const attempt = this.attempts.get(key);
    if (!attempt) return;
    if (Date.now() >= attempt.blockedUntil) {
      if (Date.now() - attempt.startedAt >= ATTEMPT_WINDOW_MS) this.attempts.delete(key);
      return;
    }
    throw new HttpError(429, "Too many sign-in attempts. Wait a few minutes and try again.", "login_throttled");
  }

  private recordFailedAttempt(key: string): void {
    const now = Date.now();
    const current = this.attempts.get(key);
    const attempt = !current || now - current.startedAt >= ATTEMPT_WINDOW_MS
      ? { count: 0, startedAt: now, blockedUntil: 0 }
      : current;
    attempt.count += 1;
    if (attempt.count >= 5) attempt.blockedUntil = now + BLOCK_MS;
    this.attempts.set(key, attempt);
  }

  private audit(
    userId: string | null,
    actorUserId: string | null,
    eventType: string,
    details: Record<string, unknown>,
    sourceAddress: string,
  ): void {
    this.db.prepare(`
      INSERT INTO auth_audit_events (
        id, user_id, actor_user_id, event_type, details_json, source_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), userId, actorUserId, eventType, JSON.stringify(details), sourceAddress.slice(0, 100), new Date().toISOString());
  }
}

export function userFromRow(row: Row): AuthUser {
  return {
    id: String(row.id ?? row.user_id),
    studentNumber: row.student_number ? String(row.student_number) : null,
    displayName: String(row.display_name),
    role: String(row.role) as Role,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    result[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return result;
}

function setSessionCookie(response: Response, token: string, secure: boolean): void {
  response.setHeader("set-cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ABSOLUTE_SESSION_MS / 1000}${secure ? "; Secure" : ""}`);
}

function clearSessionCookie(response: Response, secure: boolean): void {
  response.setHeader("set-cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`);
}

function requiredString(value: unknown, label: string, trim = true): string {
  if (typeof value !== "string" || !value) throw new HttpError(400, `${label} is required`);
  return trim ? value.trim() : value;
}

function passwordValue(value: unknown): string {
  try {
    return validatePassword(value);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Password is invalid");
  }
}
