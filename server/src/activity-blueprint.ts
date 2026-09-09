import { HttpError } from "./errors.js";
import { validateActivityDocument, type ActivityDocumentV1 } from "./activity-content.js";

export type ActivityMode = "simple" | "progressive";
export type ProgressionMode = "independent" | "sequential";
export type SubmissionDelivery = "single_file" | "zip" | "either";
export type SubmissionValidationMode = "strict" | "warning" | "descriptive";

export interface ActivityPart {
  id: string;
  title: string;
  shortLabel: string;
  contentDocument: ActivityDocumentV1;
}

export interface SubmissionRequirement {
  id: string;
  partId: string | null;
  label: string;
  kind: "file" | "file_set";
  filenameTemplate: string;
  allowedExtensions: string[];
  minCount: number;
  required: boolean;
}

export interface SubmissionSpecificationV1 {
  version: 1;
  delivery: SubmissionDelivery;
  validationMode: SubmissionValidationMode;
  allowExtraFiles: boolean;
  requirements: SubmissionRequirement[];
}

export interface RubricCriterion {
  id: string;
  partId: string | null;
  title: string;
  description: string;
  fullCreditEvidence: string;
  points: number;
}

export interface ActivityRubricV1 {
  version: 1;
  mode: "overall" | "per_part";
  expectedPoints: number;
  visibleToStudents: boolean;
  criteria: RubricCriterion[];
}

export interface ActivityBlueprintV1 {
  version: 1;
  mode: ActivityMode;
  progression: ProgressionMode;
  parts: ActivityPart[];
  submission: SubmissionSpecificationV1;
  rubric: ActivityRubricV1 | null;
}

const SAFE_INNER_EXTENSIONS = new Set([
  ".py", ".js", ".java", ".kt", ".php", ".html", ".css", ".md", ".txt",
  ".pdf", ".csv", ".json", ".in", ".out", ".xlsx", ".docx", ".zip",
]);
const TEMPLATE_TOKEN = /\{(?:student_number|first_name|last_name|part)\}/g;

export function defaultActivityBlueprint(): ActivityBlueprintV1 {
  return {
    version: 1,
    mode: "simple",
    progression: "independent",
    parts: [],
    submission: {
      version: 1,
      delivery: "either",
      validationMode: "descriptive",
      allowExtraFiles: true,
      requirements: [],
    },
    rubric: null,
  };
}

export function validateActivityBlueprint(value: unknown): ActivityBlueprintV1 {
  if (value === undefined || value === null) return defaultActivityBlueprint();
  if (!value || typeof value !== "object") throw new HttpError(400, "Activity structure is invalid");
  const source = value as Partial<ActivityBlueprintV1>;
  if (source.version !== 1) throw new HttpError(400, "Activity structure version is not supported");
  const mode = source.mode === "progressive" ? "progressive" : source.mode === "simple" ? "simple" : null;
  if (!mode) throw new HttpError(400, "Activity structure mode is invalid");
  const progression = source.progression === "sequential" ? "sequential" : source.progression === "independent" ? "independent" : null;
  if (!progression) throw new HttpError(400, "Activity progression mode is invalid");
  const rawParts = Array.isArray(source.parts) ? source.parts : [];
  if (rawParts.length > 20) throw new HttpError(400, "An activity cannot contain more than 20 parts");
  if (mode === "simple" && rawParts.length) throw new HttpError(400, "Simple activities cannot contain progressive parts");
  const partIds = new Set<string>();
  const parts = rawParts.map((raw) => {
    if (!raw || typeof raw !== "object") throw new HttpError(400, "Activity part is invalid");
    const part = raw as Partial<ActivityPart>;
    const id = stableId(part.id, "Activity part", partIds);
    const title = boundedText(part.title, "Part title", 120);
    const shortLabel = boundedText(part.shortLabel || title, "Part label", 40);
    return { id, title, shortLabel, contentDocument: validateActivityDocument(part.contentDocument) };
  });
  const submission = validateSubmissionSpecification(source.submission, partIds);
  const rubric = source.rubric === null || source.rubric === undefined ? null : validateRubric(source.rubric, partIds);
  return { version: 1, mode, progression: mode === "simple" ? "independent" : progression, parts, submission, rubric };
}

export function rubricTotal(rubric: ActivityRubricV1 | null): number {
  return rubric?.criteria.reduce((total, criterion) => total + criterion.points, 0) ?? 0;
}

export function publishBlueprintWarnings(blueprint: ActivityBlueprintV1): string[] {
  const warnings: string[] = [];
  if (blueprint.mode === "progressive" && blueprint.parts.length < 2) {
    throw new HttpError(409, "A progressive activity needs at least two parts before publishing");
  }
  if (blueprint.rubric && Math.abs(rubricTotal(blueprint.rubric) - blueprint.rubric.expectedPoints) > 0.0001) {
    warnings.push(`Rubric criteria total ${rubricTotal(blueprint.rubric)} points, but the activity maximum is ${blueprint.rubric.expectedPoints}`);
  }
  return warnings;
}

export function blueprintDocuments(blueprint: ActivityBlueprintV1): ActivityDocumentV1[] {
  return blueprint.parts.map((part) => part.contentDocument);
}

function validateSubmissionSpecification(value: unknown, partIds: Set<string>): SubmissionSpecificationV1 {
  const fallback = defaultActivityBlueprint().submission;
  if (value === undefined || value === null) return fallback;
  if (!value || typeof value !== "object") throw new HttpError(400, "Submission requirements are invalid");
  const source = value as Partial<SubmissionSpecificationV1>;
  if (source.version !== 1) throw new HttpError(400, "Submission requirement version is not supported");
  if (!source.delivery || !["single_file", "zip", "either"].includes(source.delivery)) throw new HttpError(400, "Submission delivery mode is invalid");
  if (!source.validationMode || !["strict", "warning", "descriptive"].includes(source.validationMode)) throw new HttpError(400, "Submission validation mode is invalid");
  const rawRequirements = Array.isArray(source.requirements) ? source.requirements : [];
  if (rawRequirements.length > 100) throw new HttpError(400, "An activity cannot contain more than 100 submission requirements");
  const ids = new Set<string>();
  const requirements = rawRequirements.map((raw) => {
    if (!raw || typeof raw !== "object") throw new HttpError(400, "Submission requirement is invalid");
    const item = raw as Partial<SubmissionRequirement>;
    const id = stableId(item.id, "Submission requirement", ids);
    const partId = optionalPartId(item.partId, partIds, "Submission requirement");
    const kind: SubmissionRequirement["kind"] | null = item.kind === "file_set" ? "file_set" : item.kind === "file" ? "file" : null;
    if (!kind) throw new HttpError(400, "Submission requirement kind is invalid");
    const filenameTemplate = validateFilenameTemplate(item.filenameTemplate, kind);
    const allowedExtensions = [...new Set(Array.isArray(item.allowedExtensions) ? item.allowedExtensions : [])]
      .filter((extension): extension is string => typeof extension === "string")
      .map((extension) => extension.toLowerCase());
    if (!allowedExtensions.length || allowedExtensions.some((extension) => !SAFE_INNER_EXTENSIONS.has(extension))) {
      throw new HttpError(400, "Submission requirement contains an unsupported file extension");
    }
    const minCount = Number(item.minCount ?? 1);
    if (!Number.isInteger(minCount) || minCount < 1 || minCount > 100) throw new HttpError(400, "Submission requirement count must be between 1 and 100");
    return {
      id,
      partId,
      label: boundedText(item.label, "Submission requirement label", 200),
      kind,
      filenameTemplate,
      allowedExtensions,
      minCount: kind === "file" ? 1 : minCount,
      required: item.required !== false,
    };
  });
  return {
    version: 1,
    delivery: source.delivery,
    validationMode: source.validationMode,
    allowExtraFiles: source.allowExtraFiles !== false,
    requirements,
  };
}

function validateRubric(value: unknown, partIds: Set<string>): ActivityRubricV1 {
  if (!value || typeof value !== "object") throw new HttpError(400, "Activity rubric is invalid");
  const source = value as Partial<ActivityRubricV1>;
  if (source.version !== 1) throw new HttpError(400, "Rubric version is not supported");
  const mode = source.mode === "per_part" ? "per_part" : source.mode === "overall" ? "overall" : null;
  if (!mode) throw new HttpError(400, "Rubric mode is invalid");
  const expectedPoints = finitePoints(source.expectedPoints, "Activity maximum");
  const rawCriteria = Array.isArray(source.criteria) ? source.criteria : [];
  if (!rawCriteria.length || rawCriteria.length > 100) throw new HttpError(400, "A rubric must contain between 1 and 100 criteria");
  const ids = new Set<string>();
  const criteria = rawCriteria.map((raw) => {
    if (!raw || typeof raw !== "object") throw new HttpError(400, "Rubric criterion is invalid");
    const criterion = raw as Partial<RubricCriterion>;
    const partId = optionalPartId(criterion.partId, partIds, "Rubric criterion");
    if (mode === "per_part" && !partId) throw new HttpError(400, "Every per-part rubric criterion must select a part");
    return {
      id: stableId(criterion.id, "Rubric criterion", ids),
      partId: mode === "overall" ? null : partId,
      title: boundedText(criterion.title, "Rubric criterion title", 160),
      description: optionalBoundedText(criterion.description, 2000),
      fullCreditEvidence: optionalBoundedText(criterion.fullCreditEvidence, 2000),
      points: finitePoints(criterion.points, "Rubric criterion points"),
    };
  });
  return { version: 1, mode, expectedPoints, visibleToStudents: source.visibleToStudents !== false, criteria };
}

function stableId(value: unknown, label: string, ids: Set<string>): string {
  if (typeof value !== "string" || !value.trim() || value.length > 100 || ids.has(value)) throw new HttpError(400, `${label} needs a unique identifier`);
  ids.add(value);
  return value;
}

function optionalPartId(value: unknown, partIds: Set<string>, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !partIds.has(value)) throw new HttpError(400, `${label} references an unknown activity part`);
  return value;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${label} is required`);
  const text = value.trim();
  if (text.length > maximum) throw new HttpError(400, `${label} cannot exceed ${maximum} characters`);
  return text;
}

function optionalBoundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function finitePoints(value: unknown, label: string): number {
  const points = Number(value);
  if (!Number.isFinite(points) || points < 0 || points > 10000) throw new HttpError(400, `${label} must be between 0 and 10000`);
  return Math.round(points * 100) / 100;
}

function validateFilenameTemplate(value: unknown, kind: "file" | "file_set"): string {
  const template = boundedText(value, "Submission filename or pattern", 240).replace(/\\/g, "/");
  if (template.startsWith("/") || template.includes("../") || template.includes("\0")) throw new HttpError(400, "Submission filename cannot escape the submitted archive");
  const withoutTokens = template.replace(TEMPLATE_TOKEN, "token");
  if (/[{}:?"<>|]/.test(withoutTokens) || (kind === "file" && withoutTokens.includes("*"))) {
    throw new HttpError(400, "Submission filename contains unsupported characters or template tokens");
  }
  return template;
}
