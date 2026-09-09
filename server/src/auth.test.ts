import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { AuthService } from "./auth.js";
import { openAtomDatabase } from "./db.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("local account lifecycle", () => {
  it("claims the existing faculty identity once and creates a revocable session", async () => {
    const root = mkdtempSync(join(tmpdir(), "atom-auth-test-"));
    roots.push(root);
    const database = openAtomDatabase(root);
    try {
      const auth = new AuthService(database.db, { developmentPreviewEnabled: false, secureCookies: false });
      const headers = new Map<string, string>();
      const response = { setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value) } as unknown as Response;
      const setupRequest = request({ remoteAddress: "127.0.0.1" });
      expect(auth.setupStatus().setupRequired).toBe(true);
      const session = auth.initialize(setupRequest, response, {
        displayName: "Neil Faculty",
        username: "neil.faculty",
        password: "faculty-password",
      });
      expect(session.currentUser.id).toBe("user-faculty-demo");
      expect(session.currentUser.displayName).toBe("Neil Faculty");
      expect(auth.setupStatus().setupRequired).toBe(false);
      expect(() => auth.initialize(setupRequest, response, { displayName: "Again", username: "again", password: "another-password" })).toThrow("already complete");

      const loginResponse = { setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value) } as unknown as Response;
      await auth.login(request(), loginResponse, { identifier: "NEIL.FACULTY", password: "faculty-password" });
      const cookie = headers.get("set-cookie")?.split(";")[0] ?? "";
      expect(auth.session(request({ cookie })).currentUser.id).toBe("user-faculty-demo");
      auth.logout(request({ cookie }), loginResponse);
      expect(() => auth.session(request({ cookie }))).toThrow("no longer active");
    } finally {
      database.db.close();
    }
  });

  it("forces a student using the default student-number password to change it", async () => {
    const root = mkdtempSync(join(tmpdir(), "atom-auth-test-"));
    roots.push(root);
    const database = openAtomDatabase(root);
    try {
      const auth = new AuthService(database.db, { developmentPreviewEnabled: false, secureCookies: false });
      const headers = new Map<string, string>();
      const response = { setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value) } as unknown as Response;
      auth.initialize(request({ remoteAddress: "127.0.0.1" }), response, {
        displayName: "Faculty",
        username: "faculty",
        password: "faculty-password",
      });
      const session = await auth.login(request(), response, { identifier: "2026-00001", password: "2026-00001" });
      expect(session.mustChangePassword).toBe(true);
      const cookie = headers.get("set-cookie")?.split(";")[0] ?? "";
      expect(() => auth.session(request({ cookie }))).toThrow("Change your temporary password");
      const changed = await auth.changePassword(request({ cookie }), { currentPassword: "2026-00001", newPassword: "student-password" });
      expect(changed.mustChangePassword).toBe(false);
      expect(auth.session(request({ cookie })).currentUser.id).toBe("user-student-demo");
    } finally {
      database.db.close();
    }
  });
});

function request(options: { cookie?: string; remoteAddress?: string } = {}): Request {
  const headers = new Map<string, string>();
  if (options.cookie) headers.set("cookie", options.cookie);
  return {
    ip: "127.0.0.1",
    socket: { remoteAddress: options.remoteAddress ?? "127.0.0.1" },
    header: (name: string) => headers.get(name.toLowerCase()),
  } as unknown as Request;
}
