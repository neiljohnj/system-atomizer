import { randomUUID } from "node:crypto";
import { HttpError } from "./errors.js";

export type ActivitySectionKind = "overview" | "requirements" | "submission_notes" | "custom";

export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export interface ActivitySection {
  id: string;
  kind: ActivitySectionKind;
  title: string;
  content: RichTextNode;
}

export interface ActivityDocumentV1 {
  version: 1;
  sections: ActivitySection[];
}

const ALLOWED_NODE_TYPES = new Set([
  "doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem",
  "blockquote", "hardBreak", "horizontalRule", "codeBlock", "table", "tableRow",
  "tableHeader", "tableCell", "image", "mathematics", "inlineMath", "blockMath",
  "attachment",
]);
const ALLOWED_MARK_TYPES = new Set(["bold", "italic", "strike", "code", "link", "underline"]);
const SECTION_KINDS = new Set<ActivitySectionKind>(["overview", "requirements", "submission_notes", "custom"]);
const SAFE_LINK = /^(https?:|mailto:)/i;

export function defaultActivityDocument(): ActivityDocumentV1 {
  return {
    version: 1,
    sections: [
      section("overview", "Activity overview", paragraphDocument("")),
      section("requirements", "Requirements", listDocument([])),
      section("submission_notes", "Submission notes", paragraphDocument("")),
    ],
  };
}

export function legacyActivityDocument(instructions: string, requirements: string[]): ActivityDocumentV1 {
  const document = defaultActivityDocument();
  document.sections[0].content = paragraphDocument(instructions);
  document.sections[1].content = listDocument(requirements, true);
  return document;
}

export function validateActivityDocument(value: unknown): ActivityDocumentV1 {
  if (!value || typeof value !== "object") throw new HttpError(400, "Activity content is invalid");
  const document = value as Partial<ActivityDocumentV1>;
  if (document.version !== 1 || !Array.isArray(document.sections)) {
    throw new HttpError(400, "Activity content version is not supported");
  }
  if (document.sections.length < 1 || document.sections.length > 40) {
    throw new HttpError(400, "An activity must contain between 1 and 40 sections");
  }
  const ids = new Set<string>();
  const sections = document.sections.map((item) => {
    if (!item || typeof item !== "object") throw new HttpError(400, "Activity section is invalid");
    const sectionInput = item as Partial<ActivitySection>;
    if (typeof sectionInput.id !== "string" || !sectionInput.id.trim() || ids.has(sectionInput.id)) {
      throw new HttpError(400, "Every activity section needs a unique identifier");
    }
    ids.add(sectionInput.id);
    if (!sectionInput.kind || !SECTION_KINDS.has(sectionInput.kind)) {
      throw new HttpError(400, "Activity section type is invalid");
    }
    const title = typeof sectionInput.title === "string" ? sectionInput.title.trim() : "";
    if (!title || title.length > 120) throw new HttpError(400, "Activity section title is required");
    const content = validateRichNode(sectionInput.content, 0);
    if (content.type !== "doc") throw new HttpError(400, "Activity section content must be a document");
    return { id: sectionInput.id, kind: sectionInput.kind, title, content };
  });
  const serialized = JSON.stringify({ version: 1, sections });
  if (Buffer.byteLength(serialized, "utf8") > 1_000_000) {
    throw new HttpError(413, "Activity content is larger than 1 MB");
  }
  return { version: 1, sections };
}

export function plainTextFromDocument(document: ActivityDocumentV1): string {
  return document.sections.map((item) => richNodeText(item.content)).filter(Boolean).join("\n\n");
}

export function normalizeLegacySubmissionTerminology(document: ActivityDocumentV1): ActivityDocumentV1 {
  return {
    ...document,
    sections: document.sections.map((section) => ({
      ...section,
      content: normalizeNodeTerminology(section.content),
    })),
  };
}

function normalizeNodeTerminology(node: RichTextNode): RichTextNode {
  return {
    ...node,
    ...(node.text ? {
      text: node.text
        .replace(/\bCurrent candidates\b/g, "Current submissions")
        .replace(/\bCurrent candidate\b/g, "Current submission")
        .replace(/\bcurrent candidates\b/g, "current submissions")
        .replace(/\bcurrent candidate\b/g, "current submission")
        .replace(/\bcandidates\b/g, "submissions")
        .replace(/\bcandidate\b/g, "submission"),
    } : {}),
    ...(node.content ? { content: node.content.map(normalizeNodeTerminology) } : {}),
  };
}

export function legacyFieldsFromDocument(document: ActivityDocumentV1): { instructions: string; requirements: string[] } {
  const overview = document.sections.find((item) => item.kind === "overview");
  const requirements = document.sections.find((item) => item.kind === "requirements");
  return {
    instructions: overview ? richNodeText(overview.content) : plainTextFromDocument(document),
    requirements: requirements ? topLevelListItems(requirements.content) : [],
  };
}

export function referencedAssetIds(document: ActivityDocumentV1): Set<string> {
  const ids = new Set<string>();
  for (const sectionItem of document.sections) visitNode(sectionItem.content, (node) => {
    if ((node.type === "image" || node.type === "attachment") && typeof node.attrs?.assetId === "string") {
      ids.add(node.attrs.assetId);
    }
  });
  return ids;
}

function section(kind: ActivitySectionKind, title: string, content: RichTextNode): ActivitySection {
  return { id: randomUUID(), kind, title, content };
}

function paragraphDocument(text: string): RichTextNode {
  return { type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] };
}

function listDocument(items: string[], ordered = false): RichTextNode {
  return {
    type: "doc",
    content: items.length ? [{
      type: ordered ? "orderedList" : "bulletList",
      content: items.map((text) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      })),
    }] : [{ type: "paragraph" }],
  };
}

function validateRichNode(value: unknown, depth: number): RichTextNode {
  if (depth > 30 || !value || typeof value !== "object") throw new HttpError(400, "Activity content nesting is invalid");
  const source = value as RichTextNode;
  if (typeof source.type !== "string" || !ALLOWED_NODE_TYPES.has(source.type)) {
    throw new HttpError(400, `Unsupported activity content node: ${String(source.type || "unknown")}`);
  }
  const node: RichTextNode = { type: source.type };
  if (source.type === "text") {
    if (typeof source.text !== "string") throw new HttpError(400, "Text content is invalid");
    node.text = source.text.slice(0, 100_000);
  }
  if (Array.isArray(source.marks)) {
    node.marks = source.marks.map((mark) => {
      if (!mark || !ALLOWED_MARK_TYPES.has(mark.type)) throw new HttpError(400, "Text formatting is not supported");
      if (mark.type === "link") {
        const href = typeof mark.attrs?.href === "string" ? mark.attrs.href.trim() : "";
        if (!SAFE_LINK.test(href)) throw new HttpError(400, "Links must use http, https, or mailto");
        return { type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer" } };
      }
      return { type: mark.type };
    });
  }
  const attrs = validateNodeAttributes(source.type, source.attrs);
  if (attrs) node.attrs = attrs;
  if (Array.isArray(source.content)) node.content = source.content.map((child) => validateRichNode(child, depth + 1));
  return node;
}

function validateNodeAttributes(type: string, source: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const attrs = source ?? {};
  if (type === "heading") return { level: [1, 2, 3].includes(Number(attrs.level)) ? Number(attrs.level) : 2 };
  if (type === "codeBlock") return { language: typeof attrs.language === "string" ? attrs.language.slice(0, 40) : null };
  if (type === "orderedList") return { start: Math.max(1, Number(attrs.start) || 1) };
  if (type === "tableCell" || type === "tableHeader") {
    return { colspan: Math.max(1, Number(attrs.colspan) || 1), rowspan: Math.max(1, Number(attrs.rowspan) || 1) };
  }
  if (type === "image") {
    const assetId = typeof attrs.assetId === "string" ? attrs.assetId : "";
    if (!assetId) throw new HttpError(400, "Images must reference a stored ATOM asset");
    return {
      assetId,
      alt: typeof attrs.alt === "string" ? attrs.alt.slice(0, 300) : "",
      caption: typeof attrs.caption === "string" ? attrs.caption.slice(0, 500) : "",
    };
  }
  if (type === "attachment") {
    const assetId = typeof attrs.assetId === "string" ? attrs.assetId : "";
    if (!assetId) throw new HttpError(400, "Attachments must reference a stored ATOM asset");
    return { assetId, label: typeof attrs.label === "string" ? attrs.label.slice(0, 300) : "Attachment" };
  }
  if (type === "mathematics" || type === "inlineMath" || type === "blockMath") {
    return { latex: typeof attrs.latex === "string" ? attrs.latex.slice(0, 10_000) : "" };
  }
  return undefined;
}

function richNodeText(node: RichTextNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(richNodeText).filter(Boolean).join(node.type === "paragraph" ? "" : "\n").trim();
}

function topLevelListItems(node: RichTextNode): string[] {
  const list = (node.content ?? []).find((item) => item.type === "orderedList" || item.type === "bulletList");
  return (list?.content ?? []).map(richNodeText).filter(Boolean);
}

function visitNode(node: RichTextNode, visitor: (node: RichTextNode) => void): void {
  visitor(node);
  for (const child of node.content ?? []) visitNode(child, visitor);
}
