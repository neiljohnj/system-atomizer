import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAtomDatabase, STUDENT_ID } from "./db.js";
import { DEMO_ACCOUNTS, seedDemoAccounts } from "./demo-accounts.js";
import { verifyPassword } from "./security.js";
import { issueActivation, transaction } from "./account-activation.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("explicit demo accounts", () => {
  it("refuses predictable demo resets for a managed identity and rolls back earlier rows", () => {
    const root = mkdtempSync(join(tmpdir(), "atom-demo-managed-"));
    roots.push(root);
    const { db } = openAtomDatabase(root, { sample: true });
    try {
      seedDemoAccounts(db);
      transaction(db, () => issueActivation(db, STUDENT_ID));
      const snapshot = () => JSON.stringify(["users", "auth_credentials", "managed_accounts", "auth_sessions", "auth_audit_events"].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
      const before = snapshot();
      expect(() => seedDemoAccounts(db)).toThrow(/secure activation reissue/);
      expect(snapshot()).toBe(before);
    } finally {
      db.close();
    }
  });
  it("creates three usable credentials without forcing a password change", async () => {
    const root = mkdtempSync(join(tmpdir(), "atom-demo-accounts-"));
    roots.push(root);
    const database = openAtomDatabase(root, { sample: true });
    try {
      expect(seedDemoAccounts(database.db)).toHaveLength(3);
      for (const account of DEMO_ACCOUNTS) {
        const credential = database.db.prepare(`
          SELECT login_identifier, password_hash, password_salt, password_params_json,
            must_change_password
          FROM auth_credentials WHERE user_id = ?
        `).get(account.userId) as Record<string, unknown>;
        expect(credential.login_identifier).toBe(account.loginIdentifier);
        expect(credential.password_hash).not.toBe(account.password);
        expect(credential.must_change_password).toBe(0);
        await expect(verifyPassword(
          account.password,
          String(credential.password_salt),
          String(credential.password_hash),
          String(credential.password_params_json),
        )).resolves.toBe(true);
      }
    } finally {
      database.db.close();
    }
  });
});
