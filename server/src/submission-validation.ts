import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { HttpError } from "./errors.js";
import type { ActivityBlueprintV1, SubmissionRequirement } from "./activity-blueprint.js";

export interface SubmissionValidationReport {
  valid: boolean;
  mode: "strict" | "warning" | "descriptive";
  completedThroughPartId: string | null;
  matched: string[];
  missing: string[];
  unexpected: string[];
  invalid: string[];
}

interface StudentIdentity {
  studentNumber: string;
  displayName: string;
}

interface ArchiveEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  encrypted: boolean;
}

export async function validateSubmissionFile(options: {
  path: string;
  originalFilename: string;
  blueprint: ActivityBlueprintV1;
  completedThroughPartId: string | null;
  student: StudentIdentity;
}): Promise<SubmissionValidationReport> {
  const { blueprint, originalFilename, student } = options;
  const spec = blueprint.submission;
  const completedThroughPartId = validatePartClaim(blueprint, options.completedThroughPartId);
  const report: SubmissionValidationReport = {
    valid: true,
    mode: spec.validationMode,
    completedThroughPartId,
    matched: [],
    missing: [],
    unexpected: [],
    invalid: [],
  };
  if (spec.validationMode === "descriptive") return report;

  const outerExtension = extname(originalFilename).toLowerCase();
  if (spec.delivery === "zip" && outerExtension !== ".zip") report.invalid.push("Submit a ZIP bundle for this activity");
  if (spec.delivery === "single_file" && outerExtension === ".zip") report.invalid.push("Submit an individual file for this activity");

  const activeRequirements = requirementsForClaim(blueprint, completedThroughPartId);
  let files: string[] = [cleanEntryName(originalFilename)];
  if (outerExtension === ".zip") {
    const archive = inspectZip(await readFile(options.path));
    report.invalid.push(...archive.invalid);
    files = archive.entries.filter((entry) => !entry.name.endsWith("/")).map((entry) => entry.name);
  }

  const covered = new Set<string>();
  for (const requirement of activeRequirements) {
    const matcher = requirementMatcher(requirement, blueprint, completedThroughPartId, student);
    const matches = files.filter((name) => matcher.test(name) && requirement.allowedExtensions.includes(extname(name).toLowerCase()));
    if (matches.length >= requirement.minCount) {
      report.matched.push(requirement.label);
      matches.forEach((name) => covered.add(name));
    } else if (requirement.required) {
      report.missing.push(`${requirement.label} (${matches.length}/${requirement.minCount})`);
    }
  }
  if (!spec.allowExtraFiles) report.unexpected.push(...files.filter((name) => !covered.has(name)));
  report.valid = !report.missing.length && !report.unexpected.length && !report.invalid.length;
  return report;
}

export function validatePartClaim(blueprint: ActivityBlueprintV1, requested: string | null): string | null {
  if (blueprint.mode === "simple") return null;
  if (!requested) throw new HttpError(400, "Select the highest activity part you completed");
  if (!blueprint.parts.some((part) => part.id === requested)) throw new HttpError(400, "The selected completed part is not part of this activity release");
  return requested;
}

function requirementsForClaim(blueprint: ActivityBlueprintV1, partId: string | null): SubmissionRequirement[] {
  if (blueprint.mode === "simple") return blueprint.submission.requirements.filter((item) => !item.partId);
  const partIndex = blueprint.parts.findIndex((part) => part.id === partId);
  const included = new Set(blueprint.progression === "sequential"
    ? blueprint.parts.slice(0, partIndex + 1).map((part) => part.id)
    : [partId!]);
  return blueprint.submission.requirements.filter((item) => !item.partId || included.has(item.partId));
}

function requirementMatcher(requirement: SubmissionRequirement, blueprint: ActivityBlueprintV1, claim: string | null, student: StudentIdentity): RegExp {
  const [firstName = "", ...rest] = student.displayName.trim().split(/\s+/);
  const lastName = rest.at(-1) ?? firstName;
  const part = blueprint.parts.find((item) => item.id === (requirement.partId ?? claim));
  const tokens: Record<string, string> = {
    student_number: student.studentNumber,
    first_name: firstName,
    last_name: lastName,
    part: part?.shortLabel ?? "part",
  };
  let expression = "";
  const template = requirement.filenameTemplate.replace(/\\/g, "/");
  for (let index = 0; index < template.length;) {
    if (template[index] === "{") {
      const end = template.indexOf("}", index);
      const token = end >= 0 ? template.slice(index + 1, end) : "";
      expression += token in tokens ? escapeRegex(tokens[token].replace(/\s+/g, "_")) : "[^/]+";
      index = end >= 0 ? end + 1 : index + 1;
    } else if (template[index] === "*") {
      if (template[index + 1] === "*") { expression += ".*"; index += 2; }
      else { expression += "[^/]*"; index += 1; }
    } else {
      expression += escapeRegex(template[index]);
      index += 1;
    }
  }
  return new RegExp(`^${expression}$`, "i");
}

function inspectZip(buffer: Buffer): { entries: ArchiveEntry[]; invalid: string[] } {
  const invalid: string[] = [];
  const entries: ArchiveEntry[] = [];
  const minimum = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) return { entries, invalid: ["The ZIP directory is missing or damaged"] };
  if (buffer.readUInt16LE(eocd + 4) !== 0 || buffer.readUInt16LE(eocd + 6) !== 0) invalid.push("Multi-disk ZIP archives are not accepted");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount > 1_000) invalid.push("The ZIP contains more than 1000 entries");
  if (directoryOffset + directorySize > buffer.length) return { entries, invalid: [...invalid, "The ZIP directory is outside the uploaded file"] };
  let offset = directoryOffset;
  let expandedTotal = 0;
  for (let index = 0; index < entryCount && index < 1_001; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      invalid.push("The ZIP directory contains a damaged entry");
      break;
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.length) { invalid.push("The ZIP directory contains a truncated entry"); break; }
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString((flags & 0x800) ? "utf8" : "latin1");
    const name = cleanEntryName(rawName);
    const unsafe = unsafeEntryName(rawName);
    if (unsafe) invalid.push(`Unsafe archive path: ${rawName.slice(0, 120)}`);
    if ((flags & 0x1) !== 0) invalid.push(`Encrypted archive entry: ${name}`);
    expandedTotal += uncompressedSize;
    if (uncompressedSize > 1024 * 1024 && compressedSize > 0 && uncompressedSize / compressedSize > 200) invalid.push(`Suspicious compression ratio: ${name}`);
    entries.push({ name, compressedSize, uncompressedSize, encrypted: (flags & 0x1) !== 0 });
    offset = end;
  }
  if (expandedTotal > 250 * 1024 * 1024) invalid.push("The ZIP expands beyond the 250 MB safety limit");
  return { entries, invalid: [...new Set(invalid)] };
}

function unsafeEntryName(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..");
}

function cleanEntryName(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
