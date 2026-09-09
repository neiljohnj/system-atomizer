import { describe, expect, it } from "vitest";
import { AUTHORING_STRESS_FIXTURES } from "./authoring-fixtures.js";
import { publishBlueprintWarnings, rubricTotal, validateActivityBlueprint } from "./activity-blueprint.js";
import { validateActivityDocument } from "./activity-content.js";

describe("structured activity blueprints", () => {
  it("loads every stress fixture through normal document and blueprint validators", () => {
    expect(AUTHORING_STRESS_FIXTURES).toHaveLength(6);
    for (const fixture of AUTHORING_STRESS_FIXTURES) {
      expect(validateActivityDocument(fixture.document).version).toBe(1);
      const validated = validateActivityBlueprint(fixture.blueprint);
      expect(validated.version).toBe(1);
      expect(publishBlueprintWarnings(validated)).toEqual([]);
      if (validated.rubric) expect(rubricTotal(validated.rubric)).toBe(validated.rubric.expectedPoints);
    }
  });

  it("requires a publish acknowledgement when rubric points do not match", () => {
    const source = structuredClone(AUTHORING_STRESS_FIXTURES[2].blueprint);
    source.rubric!.expectedPoints += 5;
    expect(publishBlueprintWarnings(validateActivityBlueprint(source))).toEqual([expect.stringContaining("Rubric criteria total")]);
  });

  it("rejects unstable identifiers, invalid part scopes, and unsafe filename templates", () => {
    const duplicate = structuredClone(AUTHORING_STRESS_FIXTURES[0].blueprint);
    duplicate.parts[1].id = duplicate.parts[0].id;
    expect(() => validateActivityBlueprint(duplicate)).toThrow("unique identifier");
    const missingPart = structuredClone(AUTHORING_STRESS_FIXTURES[0].blueprint);
    missingPart.submission.requirements[0].partId = "missing";
    expect(() => validateActivityBlueprint(missingPart)).toThrow("unknown activity part");
    const traversal = structuredClone(AUTHORING_STRESS_FIXTURES[2].blueprint);
    traversal.submission.requirements[0].filenameTemplate = "../solution.py";
    expect(() => validateActivityBlueprint(traversal)).toThrow("cannot escape");
  });
});
