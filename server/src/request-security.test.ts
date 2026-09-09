import { describe, expect, it } from "vitest";
import { configuredAllowedOrigins, isAllowedMutationOrigin } from "./request-security.js";

const baseline = {
  host: "127.0.0.1:4174",
  secureCookies: false,
  allowedOrigins: new Set<string>(),
};

describe("state-changing request origins", () => {
  it("accepts the exact origin served by ATOM", () => {
    expect(isAllowedMutationOrigin({ ...baseline, origin: "http://127.0.0.1:4174" })).toBe(true);
  });

  it("rejects unrelated browser origins unless explicitly configured", () => {
    expect(isAllowedMutationOrigin({ ...baseline, origin: "http://malicious.test" })).toBe(false);
    expect(isAllowedMutationOrigin({ ...baseline, origin: "http://127.0.0.1:5173" })).toBe(false);
    const allowedOrigins = configuredAllowedOrigins("http://192.168.10.150:4174");
    expect(isAllowedMutationOrigin({ ...baseline, origin: "http://192.168.10.150:4174", allowedOrigins })).toBe(true);
  });

  it("uses forwarded public origin metadata when HTTPS is terminated upstream", () => {
    expect(isAllowedMutationOrigin({
      ...baseline,
      origin: "https://atom.local",
      forwardedHost: "atom.local",
      forwardedProtocol: "https",
    })).toBe(true);
  });
});
