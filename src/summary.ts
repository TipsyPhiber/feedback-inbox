import { CATEGORIES, type Category, type StoredItem } from "./types.js";

export interface WeeklySummary {
  title: string;
  periodStart: Date;
  periodEnd: Date;
  total: number;
  byCategory: Record<Category, number>;
  /** Highest-urgency open items, most urgent first. */
  needsAttention: StoredItem[];
  /** Original items with how many reports repeated them, biggest first. */
  repeated: Array<{ original: StoredItem; reports: number }>;
  openCount: number;
}

const CLOSED = new Set(["Done", "Won't fix"]);

/** Pure function so the summary logic is testable without Notion. */
export function buildWeeklySummary(items: StoredItem[], end: Date, days = 7): WeeklySummary {
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const inWindow = items.filter((i) => {
    if (!i.receivedAt) return false;
    const t = new Date(i.receivedAt).getTime();
    return t >= start.getTime() && t <= end.getTime();
  });

  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  for (const item of inWindow) byCategory[item.category ?? "Other"]++;

  const open = inWindow.filter((i) => !CLOSED.has(i.status ?? "New"));
  const needsAttention = open
    .filter((i) => !i.duplicateOf && (i.urgency ?? 0) >= 4)
    .sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0) || a.title.localeCompare(b.title))
    .slice(0, 10);

  // Count repeats against the whole inbox, so an old bug that people keep hitting shows up again.
  const byId = new Map(items.map((i) => [i.externalId, i]));
  const repeatCounts = new Map<string, number>();
  for (const item of inWindow) {
    if (item.duplicateOf) repeatCounts.set(item.duplicateOf, (repeatCounts.get(item.duplicateOf) ?? 0) + 1);
  }
  const repeated = [...repeatCounts.entries()]
    .map(([id, count]) => ({ original: byId.get(id), reports: count + 1 }))
    .filter((r): r is { original: StoredItem; reports: number } => Boolean(r.original))
    .sort((a, b) => b.reports - a.reports)
    .slice(0, 5);

  const label = (d: Date) => d.toISOString().slice(0, 10);
  return {
    title: `Feedback summary: ${label(start)} to ${label(end)}`,
    periodStart: start,
    periodEnd: end,
    total: inWindow.length,
    byCategory,
    needsAttention,
    repeated,
    openCount: open.length,
  };
}

/** Plain-text rendering, used for --dry-run output and as the opening paragraph of the Notion page. */
export function headline(summary: WeeklySummary): string {
  if (summary.total === 0) return "No new feedback this period.";
  const noun: Record<Category, [string, string]> = {
    Bug: ["bug", "bugs"],
    "Feature request": ["feature request", "feature requests"],
    Question: ["question", "questions"],
    Praise: ["praise", "praise"],
    Other: ["other", "other"],
  };
  const parts = CATEGORIES.filter((c) => summary.byCategory[c] > 0).map((c) => {
    const n = summary.byCategory[c];
    return `${n} ${noun[c][n === 1 ? 0 : 1]}`;
  });
  return `${summary.total} new item${summary.total === 1 ? "" : "s"}: ${parts.join(", ")}. ${summary.openCount} still open.`;
}
