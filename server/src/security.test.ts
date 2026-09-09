import { describe, expect, it } from "vitest";
import { createPasswordRecord, normalizeLoginIdentifier, verifyPassword } from "./security.js";

describe("password storage", () => {
  it("stores salted scrypt output and verifies with timing-safe comparison", async () => {
    const first = createPasswordRecord("a-valid-password");
    const second = createPasswordRecord("a-valid-password");
    expect(first.passwordHash).not.toBe("a-valid-password");
    expect(first.passwordHash).not.toBe(second.passwordHash);
    expect(Buffer.from(first.passwordSalt, "base64")).toHaveLength(16);
    await expect(verifyPassword("a-valid-password", first.passwordSalt, first.passwordHash, first.passwordParams)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", first.passwordSalt, first.passwordHash, first.passwordParams)).resolves.toBe(false);
  });

  it("normalizes login identifiers without changing the stored display value", () => {
    expect(normalizeLoginIdentifier("  Faculty.Demo  ")).toBe("faculty.demo");
  });
});
