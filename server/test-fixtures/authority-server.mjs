import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

// Deterministic await barrier in this test-owned process; production has no test hook.
let armed = false, uploadArmed = false, failRename = false, release;
const copy = fs.copyFile;
fs.copyFile = async (...args) => {
  await copy(...args);
  if (armed) {
    armed = false;
    await new Promise(resolve => { release = resolve; process.send?.("copied"); });
  }
};
const rename = fs.rename;
fs.rename = async (...args) => {
  if (failRename) { failRename = false; throw Object.assign(new Error("Synthetic storage failure"), { code: "EACCES" }); }
  await rename(...args);
  if (uploadArmed) {
    uploadArmed = false;
    await new Promise(resolve => { release = resolve; process.send?.("uploaded"); });
  }
};
syncBuiltinESMExports();
// IPC lets Windows tests use ATOM's normal DB-closing shutdown.
process.on("message", (message) => {
  if (message === "stop") process.emit("SIGTERM", "SIGTERM");
  if (message === "arm-copy") { armed = true; process.send?.("armed"); }
  if (message === "arm-upload") { uploadArmed = true; process.send?.("armed"); }
  if (message === "fail-rename") { failRename = true; process.send?.("armed"); }
  if (message === "release-copy") release?.();
});
await import(process.argv.includes("--compiled") ? "../../dist-server/index.js" : "../src/index.ts");
if (process.connected) process.disconnect();
