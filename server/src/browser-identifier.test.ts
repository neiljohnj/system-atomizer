import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { newIdentifier } from "../../src/identifier.js";

describe("LAN browser identifiers", () => {
  it("generates UUID v4 without secure-context randomUUID", () => {
    const source = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } as Crypto;
    const ids = Array.from({ length: 100 }, () => newIdentifier(source));
    expect(new Set(ids).size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("uses native UUID when present and fails explicitly without a random source", () => {
    expect(newIdentifier({ randomUUID: () => "00000000-0000-4000-8000-000000000000" } as Crypto)).toBe("00000000-0000-4000-8000-000000000000");
    expect(() => newIdentifier({} as Crypto)).toThrow("supported browser");
  });
});
