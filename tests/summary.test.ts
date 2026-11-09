import { describe, expect, it } from "vitest";
import { rulesClassifier } from "../src/classify/index.js";
import { feedbackFromCsvFile } from "../src/sources/csv.js";
import { MemoryStore } from "../src/store.js";
import { buildWeeklySummary, headline } from "../src/summary.js";
import { syncFeedback } from "../src/sync.js";

const SAMPLE = new URL("../examples/sample-feedback.csv", import.meta.url).pathname;

describe("buildWeeklySummary", () => {
  it("surfaces urgent open items and repeated reports for the week", async () => {
    const store = new MemoryStore();
    await syncFeedback(await feedbackFromCsvFile(SAMPLE), store, rulesClassifier);
    const summary = buildWeeklySummary(store.items, new Date("2026-11-08T00:00:00Z"));

    expect(summary.total).toBe(9);
    expect(summary.needsAttention.map((i) => i.externalId)).toContain("csv:r-104");
    // Repeats are reported against their original, not listed again as urgent items.
    expect(summary.needsAttention.map((i) => i.externalId)).not.toContain("csv:r-109");
    expect(summary.repeated.map((r) => [r.original.externalId, r.reports])).toEqual(
      expect.arrayContaining([["csv:r-101", 2], ["csv:r-104", 2]]),
    );
    expect(headline(summary)).toMatch(/^9 new items: .*bugs?.*\. 9 still open\.$/);
  });

  it("leaves closed items out of what needs attention", async () => {
    const store = new MemoryStore();
    await syncFeedback(await feedbackFromCsvFile(SAMPLE), store, rulesClassifier);
    for (const i of store.items) i.status = "Done";
    const summary = buildWeeklySummary(store.items, new Date("2026-11-08T00:00:00Z"));
    expect(summary.needsAttention).toHaveLength(0);
    expect(summary.openCount).toBe(0);
  });

  it("says so when the week was quiet", () => {
    expect(headline(buildWeeklySummary([], new Date()))).toBe("No new feedback this period.");
  });
});
