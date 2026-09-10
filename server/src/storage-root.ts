import { resolve } from "node:path";

/** All application and maintenance entry points interpret relative ATOM_ROOT from cwd. */
export function storageRoot(configured = process.env.ATOM_ROOT, cwd = process.cwd()): string {
  return resolve(cwd, configured?.trim() || ".");
}
