import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";

const SAFE_SEGMENT = /[^a-z0-9]+/g;

export function extensionOf(filename: string): ".py" | ".zip" | null {
  const extension = extname(filename).toLowerCase();
  return extension === ".py" || extension === ".zip" ? extension : null;
}

export function normalizeSubmissionFilename(
  studentNumber: string,
  activityTitle: string,
  revision: number,
  originalFilename: string,
): string {
  const extension = extensionOf(originalFilename);
  if (!extension) throw new Error("Unsupported file extension");

  const student = slug(studentNumber) || "student";
  const activity = slug(activityTitle) || "activity";
  return `${student}_${activity}_r${revision}${extension}`;
}

export function safeStoredFile(dataDir: string, storedPath: string): string {
  const root = resolve(dataDir);
  const resolvedPath = resolve(root, storedPath);
  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${sep}`)) {
    throw new Error("Stored path escaped the ATOM data directory");
  }
  return resolvedPath;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

export function cleanOriginalFilename(filename: string): string {
  return basename(filename).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240);
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(SAFE_SEGMENT, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
