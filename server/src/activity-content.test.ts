import { describe, expect, it } from "vitest";
import {
  defaultActivityDocument,
  legacyActivityDocument,
  legacyFieldsFromDocument,
  normalizeLegacySubmissionTerminology,
  plainTextFromDocument,
  referencedAssetIds,
  validateActivityDocument,
} from "./activity-content.js";

describe("activity document validation", () => {
  it("normalizes obsolete terminology in legacy stored documents", () => {
    const document = legacyActivityDocument("The current candidate remains available.", []);
    const normalized = normalizeLegacySubmissionTerminology(document);
    expect(plainTextFromDocument(normalized)).toContain("current submission");
    expect(plainTextFromDocument(normalized)).not.toContain("candidate");
  });
  it("starts new activities with three empty named sections", () => {
    const document = defaultActivityDocument();
    expect(document.sections.map((section) => section.kind)).toEqual([
      "overview",
      "requirements",
      "submission_notes",
    ]);
    expect(plainTextFromDocument(document)).toBe("");
  });

  it("migrates legacy overview and requirements without losing their meaning", () => {
    const document = legacyActivityDocument("Process a command stream.", ["Handle add", "Handle remove"]);
    expect(legacyFieldsFromDocument(document)).toEqual({
      instructions: "Process a command stream.",
      requirements: ["Handle add", "Handle remove"],
    });
    expect(validateActivityDocument(document).version).toBe(1);
  });

  it("rejects unsafe links and unknown rich-content nodes", () => {
    const document = legacyActivityDocument("Safe", []);
    document.sections[0].content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "bad", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }],
    };
    expect(() => validateActivityDocument(document)).toThrow("Links must use http, https, or mailto");
    document.sections[0].content = { type: "doc", content: [{ type: "script" }] };
    expect(() => validateActivityDocument(document)).toThrow("Unsupported activity content node");
  });

  it("collects protected asset identifiers from image and attachment nodes", () => {
    const document = legacyActivityDocument("Assets", []);
    document.sections[0].content = {
      type: "doc",
      content: [
        { type: "image", attrs: { assetId: "asset-image", alt: "Diagram" } },
        { type: "attachment", attrs: { assetId: "asset-file", label: "Dataset" } },
      ],
    };
    expect([...referencedAssetIds(document)]).toEqual(["asset-image", "asset-file"]);
  });
});
