import type { ActivityDocumentV1, RichTextNode } from "./activity-content.js";

export type ScheduleState = "scheduled" | "open" | "closed";

export interface ManuallyPositioned {
  id: string;
  manualPosition: number | null;
}

export function scheduleState(opensAt: string, deadlineAt: string, now = Date.now()): ScheduleState {
  if (now < Date.parse(opensAt)) return "scheduled";
  if (now > Date.parse(deadlineAt)) return "closed";
  return "open";
}

export function overviewExcerpt(document: ActivityDocumentV1 | undefined, maximumLength = 180): string | null {
  const overview = document?.sections.find((section) => section.kind === "overview");
  if (!overview) return null;
  const normalized = textFromNode(overview.content).replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= maximumLength) return normalized;
  const truncated = normalized.slice(0, maximumLength + 1);
  const boundary = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, boundary > maximumLength * 0.6 ? boundary : maximumLength).trim()}…`;
}

export function applyManualPositions<T extends ManuallyPositioned>(automaticallySorted: T[]): T[] {
  if (automaticallySorted.length < 2) return automaticallySorted;
  const result = new Array<T | undefined>(automaticallySorted.length);
  const manual = automaticallySorted
    .filter((item) => item.manualPosition !== null)
    .sort((left, right) => (left.manualPosition ?? 0) - (right.manualPosition ?? 0) || left.id.localeCompare(right.id));

  for (const item of manual) {
    let slot = Math.min(item.manualPosition ?? 0, result.length - 1);
    while (slot < result.length && result[slot]) slot += 1;
    if (slot >= result.length) {
      slot = result.length - 1;
      while (slot >= 0 && result[slot]) slot -= 1;
    }
    if (slot >= 0) result[slot] = item;
  }

  const automatic = automaticallySorted.filter((item) => item.manualPosition === null);
  let automaticIndex = 0;
  for (let index = 0; index < result.length; index += 1) {
    if (!result[index]) result[index] = automatic[automaticIndex++];
  }
  return result as T[];
}

function textFromNode(node: RichTextNode | undefined): string {
  if (!node) return "";
  const own = node.text ?? "";
  const children = node.content?.map(textFromNode).join(" ") ?? "";
  return `${own} ${children}`;
}
