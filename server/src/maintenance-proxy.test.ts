import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request } from "node:http";
import { createServer as createListener } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("proxy mode denies maintenance through a real loopback proxy that strips all forwarding headers", async () => {
  const root = mkdtempSync(join(tmpdir(), "atom-maintenance-proxy-"));
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  expect(resolve(root, "data")).not.toBe(resolve(repo, "data"));
  const listener = createListener(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = (listener.address() as { port: number }).port; await new Promise<void>(done => listener.close(() => done()));
  const child = fork(join(repo, "server/test-fixtures/authority-server.mjs"), [], { cwd: repo, execArgv: ["--import", "tsx"], windowsHide: true,
    env: { ...process.env, ATOM_ROOT: root, PORT: String(port), ATOM_HOST: "127.0.0.1", ATOM_BEHIND_PROXY: "true", ATOM_DEVELOPMENT_PREVIEW: "false", ATOM_HTTPS: "false" }, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const proxy = createServer((incoming, outgoing) => {
    const upstream = request(`http://127.0.0.1:${port}${incoming.url}`, { method: incoming.method }, response => {
      outgoing.writeHead(response.statusCode!, response.headers); response.pipe(outgoing);
    });
    upstream.on("error", () => outgoing.destroy()); incoming.pipe(upstream);
  });
  try {
    for (let n = 0; ; n++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {}
      if (n > 100) throw new Error("Owned server did not start"); await new Promise(done => setTimeout(done, 50)); }
    proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
    const base = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
    for (const [path, method] of [["/api/local-recovery/faculty", "GET"], ["/api/local-recovery/faculty/user-faculty-demo/reset", "POST"], ["/api/setup", "POST"]]) {
      const response = await fetch(base + path, { method });
      expect(response.status).toBe(403); expect(await response.text()).not.toContain("temporaryPassword");
    }
    expect((await fetch(base + "/api/health")).status).toBe(200);
  } finally {
    if (proxy.listening) await new Promise<void>(done => proxy.close(() => done()));
    if (child.exitCode === null) { const ended = once(child, "exit"); child.send("stop"); await ended; }
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
