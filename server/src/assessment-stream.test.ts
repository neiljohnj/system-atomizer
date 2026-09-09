import { describe, expect, it } from "vitest";
import { applyManualPositions, overviewExcerpt, scheduleState } from "./assessment-stream.js";

describe("assessment stream presentation", () => {
  it("derives schedule states from the server clock", () => {
    const now = Date.parse("2026-08-14T02:00:00.000Z");
    expect(scheduleState("2026-08-15T00:00:00.000Z", "2026-08-20T00:00:00.000Z", now)).toBe("scheduled");
    expect(scheduleState("2026-08-10T00:00:00.000Z", "2026-08-20T00:00:00.000Z", now)).toBe("open");
    expect(scheduleState("2026-08-01T00:00:00.000Z", "2026-08-12T00:00:00.000Z", now)).toBe("closed");
  });

  it("extracts a compact plain-text overview without exposing markup", () => {
    expect(overviewExcerpt({ version: 1, sections: [{
      id: "overview",
      kind: "overview",
      title: "Overview",
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Build" }, { type: "text", text: "a queue processor." }] }] },
    }] })).toBe("Build a queue processor.");
  });

  it("reserves manual slots while automatic items fill the remaining positions", () => {
    const items = [
      { id: "automatic-a", manualPosition: null },
      { id: "automatic-b", manualPosition: null },
      { id: "manual", manualPosition: 1 },
      { id: "automatic-c", manualPosition: null },
    ];
    expect(applyManualPositions(items).map((item) => item.id)).toEqual([
      "automatic-a", "manual", "automatic-b", "automatic-c",
    ]);
  });
});
