import { describe, expect, it } from "vitest";
import {
  cleanOriginalFilename,
  extensionOf,
  normalizeSubmissionFilename,
  safeStoredFile,
} from "./files.js";

describe("submission file rules", () => {
  it("accepts only source and ZIP extensions", () => {
    expect(extensionOf("answer.PY")).toBe(".py");
    expect(extensionOf("project.zip")).toBe(".zip");
    expect(extensionOf("program.exe")).toBeNull();
  });

  it("normalizes submission filenames", () => {
    expect(
      normalizeSubmissionFilename("2026-00001", "Laboratory Activity 01", 3, "My Final.PY"),
    ).toBe("2026-00001_laboratory-activity-01_r3.py");
  });

  it("removes path components from original names", () => {
    expect(cleanOriginalFilename("../nested/solution.py")).toBe("solution.py");
  });

  it("rejects stored paths outside the data directory", () => {
    expect(() => safeStoredFile("C:\\atom\\data", "..\\secret.txt")).toThrow();
  });
});
