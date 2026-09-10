import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const root = mkdtempSync(join(tmpdir(), "atom-phase0a-smoke-"));
if (!resolve(root, "data").startsWith(resolve(tmpdir()) + sep) || resolve(root, "data") === resolve(repo, "data")) throw new Error("Unsafe fixture root");
const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
const port = listener.address().port; await new Promise(done => listener.close(done));
const base = `http://127.0.0.1:${port}`;
const server = fork(join(repo, "server/test-fixtures/authority-server.mjs"), [], { cwd: repo, execArgv: ["--import", "tsx"], windowsHide: true,
  env: { ...process.env, ATOM_ROOT: root, PORT: String(port), ATOM_DEVELOPMENT_PREVIEW: "false", ATOM_HTTPS: "false", ATOM_ALLOWED_ORIGINS: "" }, stdio: ["ignore", "ignore", "ignore", "ipc"] });
try {
  for (let n = 0; ; n++) {
    try { if ((await fetch(base + "/api/health")).ok) break; } catch {}
    if (n === 100) throw new Error("Owned smoke server did not start");
    await new Promise(done => setTimeout(done, 100));
  }
  const smoke = spawn(process.execPath, [join(repo, "server/smoke.mjs")], { cwd: repo, windowsHide: true, env: { ...process.env, ATOM_SMOKE_BASE: base }, stdio: "inherit" });
  const [code] = await once(smoke, "exit");
  if (code !== 0) throw new Error(`Existing smoke failed (${code})`);
} finally {
  if (server.exitCode === null) { const ended = once(server, "exit"); server.send("stop"); await ended; }
  if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes("atom-phase0a-smoke-")) rmSync(root, { recursive: true, force: true });
}
