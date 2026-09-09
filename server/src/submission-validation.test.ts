import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AUTHORING_STRESS_FIXTURES } from "./authoring-fixtures.js";
import { validateSubmissionFile } from "./submission-validation.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const temporaryFile = (name: string, content: Buffer | string) => { const root = mkdtempSync(join(tmpdir(), "atom-submission-")); roots.push(root); const path = join(root, name); writeFileSync(path, content); return path; };

describe("submission preflight", () => {
  it("validates a sequential claim against every required prefix", async () => {
    const blueprint = structuredClone(AUTHORING_STRESS_FIXTURES[0].blueprint);
    blueprint.submission.delivery = "zip";
    const entries = ["Jamoya_Neil_Level1.py", "Jamoya_Neil_Level2.py"];
    const path = temporaryFile("levels.zip", centralDirectoryZip(entries));
    const report = await validateSubmissionFile({ path, originalFilename: "levels.zip", blueprint, completedThroughPartId: blueprint.parts[1].id, student: { studentNumber: "2026-00001", displayName: "Neil Jamoya" } });
    expect(report.valid).toBe(true);
    expect(report.matched).toHaveLength(2);
  });

  it("records warning discrepancies but detects traversal, encryption, and suspicious expansion", async () => {
    const blueprint = structuredClone(AUTHORING_STRESS_FIXTURES[2].blueprint);
    blueprint.submission.delivery = "zip";
    blueprint.submission.validationMode = "warning";
    const path = temporaryFile("unsafe.zip", centralDirectoryZip(["../delimiter_auditor.py"], { encrypted: true, compressedSize: 1, uncompressedSize: 2_000_000 }));
    const report = await validateSubmissionFile({ path, originalFilename: "unsafe.zip", blueprint, completedThroughPartId: null, student: { studentNumber: "2026-00001", displayName: "Neil Jamoya" } });
    expect(report.valid).toBe(false);
    expect(report.invalid.join(" ")).toContain("Unsafe archive path");
    expect(report.invalid.join(" ")).toContain("Encrypted archive entry");
    expect(report.invalid.join(" ")).toContain("Suspicious compression ratio");
  });

  it("leaves descriptive mode non-blocking without inspecting file contents", async () => {
    const blueprint = structuredClone(AUTHORING_STRESS_FIXTURES[5].blueprint);
    const path = temporaryFile("anything.zip", "not actually a zip");
    const report = await validateSubmissionFile({ path, originalFilename: "anything.zip", blueprint, completedThroughPartId: null, student: { studentNumber: "2026-00001", displayName: "Neil Jamoya" } });
    expect(report).toMatchObject({ valid: true, mode: "descriptive", invalid: [] });
  });
});

function centralDirectoryZip(names: string[], options: { encrypted?: boolean; compressedSize?: number; uncompressedSize?: number } = {}): Buffer {
  const entries = names.map((name) => {
    const encoded = Buffer.from(name, "utf8");
    const entry = Buffer.alloc(46 + encoded.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(options.encrypted ? 1 : 0, 8);
    entry.writeUInt32LE(options.compressedSize ?? 0, 20);
    entry.writeUInt32LE(options.uncompressedSize ?? 0, 24);
    entry.writeUInt16LE(encoded.length, 28);
    encoded.copy(entry, 46);
    return entry;
  });
  const directory = Buffer.concat(entries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(0, 16);
  return Buffer.concat([directory, end]);
}
