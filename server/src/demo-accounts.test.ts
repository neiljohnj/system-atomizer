import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAtomDatabase } from "./db.js";
import { DEMO_ACCOUNTS, seedDemoAccounts } from "./demo-accounts.js";
import { verifyPassword } from "./security.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("explicit demo accounts", () => {
  it("creates three usable credentials without forcing a password change", async () => {
    const root = mkdtempSync(join(tmpdir(), "atom-demo-accounts-"));
    roots.push(root);
    const database = openAtomDatabase(root);
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
