// Synthetic browser fixture only. Faults are injected by this proxy, never by application code.
import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const root = mkdtempSync(join(tmpdir(), "atom-phase0-browser-"));
const reserve = createServer(); reserve.listen(0, "0.0.0.0"); await once(reserve, "listening");
const port = reserve.address().port; await new Promise(done => reserve.close(done));
const child = fork(join(repo, "server/test-fixtures/authority-server.mjs"), ["--compiled", "--sample-data"], { cwd: repo, execArgv: [], windowsHide: true,
  env: { ...process.env, ATOM_ROOT: root, PORT: String(port), ATOM_HOST: "0.0.0.0", ATOM_BEHIND_PROXY: "false", ATOM_DEVELOPMENT_PREVIEW: "false", ATOM_HTTPS: "false", ATOM_ALLOWED_ORIGINS: "" }, stdio: ["ignore", "ignore", "inherit", "ipc"] });
const base = `http://127.0.0.1:${port}`;
for (let n = 0; ; n++) {
  try { if ((await fetch(base + "/api/health")).ok) break; } catch {}
  if (n === 100) throw new Error("Fixture did not start");
  await new Promise(done => setTimeout(done, 100));
}
const smoke = spawn(process.execPath, [join(repo, "server/smoke.mjs")], { cwd: repo, windowsHide: true, env: { ...process.env, ATOM_SMOKE_BASE: base }, stdio: "inherit" });
if ((await once(smoke, "exit"))[0] !== 0) throw new Error("Fixture failed");
writeFileSync(join(root, "solution.py"), "print('Phase 0 browser upload')\n");
let fault = 503;
const proxy = createServer((req, res) => {
  if (req.method === "PATCH" && req.url.startsWith("/api/activities/") && fault) {
    req.resume(); res.writeHead(fault, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "Synthetic save failure" })); return;
  }
  const upstream = request(base + req.url, { method: req.method, headers: req.headers }, result => {
    if (result.headers["content-type"]?.includes("text/html")) {
      const chunks = []; result.on("data", chunk => chunks.push(chunk)); result.on("end", () => {
        const html = Buffer.concat(chunks).toString().replace("<head>", '<head><script>Object.defineProperty(window,"indexedDB",{get(){throw new Error("Synthetic unavailable device storage")}})</script>');
        const headers = { ...result.headers }; delete headers["content-length"]; delete headers["content-encoding"];
        res.writeHead(result.statusCode, headers); res.end(html);
      });
    } else { res.writeHead(result.statusCode, result.headers); result.pipe(res); }
  });
  upstream.on("error", () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
});
proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
console.log(JSON.stringify({ base, lan: Object.values(networkInterfaces()).flat().filter(x => x && x.family === "IPv4" && !x.internal).map(x => `http://${x.address}:${port}`), faultBase: `http://127.0.0.1:${proxy.address().port}`, upload: join(root, "solution.py") }));
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  if (line.trim() === "stop") break;
  fault = line.trim() === "recover" ? 0 : line.trim() === "expire" ? 401 : 503;
  console.log(`Synthetic PATCH status: ${fault || "pass through"}`);
}
lines.close(); await new Promise(done => proxy.close(done));
if (child.exitCode === null) { const ended = once(child, "exit"); child.send("stop"); await ended; }
if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes("atom-phase0-browser-")) rmSync(root, { recursive: true, force: true });
