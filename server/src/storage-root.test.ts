import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { storageRoot } from "./storage-root.js";

describe("storage-root isolation", () => {
  it("resolves relative configuration consistently", () => {
    expect(storageRoot("fixture", tmpdir())).toBe(resolve(tmpdir(), "fixture"));
    expect(storageRoot("", tmpdir())).toBe(resolve(tmpdir()));
  });
  it("stress seeding from cwd A writes only explicit root B and resolves shipped assets", () => {
    const a = mkdtempSync(join(tmpdir(), "atom-root-a-"));
    const b = mkdtempSync(join(tmpdir(), "atom-root-b-"));
    try {
      const script = fileURLToPath(new URL(process.env.ATOM_TEST_COMPILED === "true" ? "../../dist-server/seed-authoring-stress.js" : "./seed-authoring-stress.ts", import.meta.url));
      const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
      const options = { cwd: a, env: { ...process.env, ATOM_ROOT: b }, encoding: "utf8" as const, windowsHide: true };
      const denied = spawnSync(process.execPath, ["--import", loader, script], options);
      expect(denied.status).not.toBe(0); expect(existsSync(join(b, "data"))).toBe(false);
      const seeded = spawnSync(process.execPath, ["--import", loader, script, "--development-fixture"], options);
      expect(seeded.status, seeded.stderr).toBe(0);
      expect(existsSync(join(a, "data"))).toBe(false);
      expect(existsSync(join(b, "data", "atom.sqlite"))).toBe(true);
      expect(existsSync(join(b, "data", "uploads", "activity-assets", "stress-command-resource-processor", "stress-command-starter-level-1", "command-resource-level1.py"))).toBe(true);
    } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
  }, 20000);
});
