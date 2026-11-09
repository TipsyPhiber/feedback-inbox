import { describe, expect, it } from "vitest";
import { rulesClassifier } from "../src/classify/index.js";
import { feedbackFromCsvFile } from "../src/sources/csv.js";
import { MemoryStore } from "../src/store.js";
import { syncFeedback } from "../src/sync.js";

const SAMPLE = new URL("../examples/sample-feedback.csv", import.meta.url).pathname;

describe("syncFeedback", () => {
  it("imports, tags, and links repeats in the sample export", async () => {
    const store = new MemoryStore();
    const result = await syncFeedback(await feedbackFromCsvFile(SAMPLE), store, rulesClassifier);

    expect(result.added).toHaveLength(9);
    const byId = new Map(store.items.map((i) => [i.externalId, i]));
    // Two people describe Cook Mode's mic turning off; the later one points at the earlier one.
    expect(byId.get("csv:r-105")?.duplicateOf).toBe("csv:r-101");
    // Two people are locked out after a password reset.
    expect(byId.get("csv:r-109")?.duplicateOf).toBe("csv:r-104");
    expect(byId.get("csv:r-104")).toMatchObject({ category: "Bug", status: "New" });
    expect(byId.get("csv:r-104")!.urgency).toBeGreaterThanOrEqual(4);
  });

  it("is safe to re-run: nothing already in the inbox is added twice", async () => {
    const store = new MemoryStore();
    const items = await feedbackFromCsvFile(SAMPLE);
    await syncFeedback(items, store, rulesClassifier);
    const again = await syncFeedback(items, store, rulesClassifier);
    expect(again.added).toHaveLength(0);
    expect(again.skipped).toBe(items.length);
    expect(store.items).toHaveLength(items.length);
  });

  it("never touches rows people have already triaged", async () => {
    const store = new MemoryStore();
    const items = await feedbackFromCsvFile(SAMPLE);
    await syncFeedback(items.slice(0, 3), store, rulesClassifier);
    store.items[0]!.status = "Planned";
    await syncFeedback(items, store, rulesClassifier);
    expect(store.items[0]!.status).toBe("Planned");
  });

  it("drops the same row repeated inside one batch", async () => {
    const store = new MemoryStore();
    const items = await feedbackFromCsvFile(SAMPLE);
    const result = await syncFeedback([...items, ...items], store, rulesClassifier);
    expect(result.added).toHaveLength(items.length);
  });

  it("writes nothing on a dry run", async () => {
    const store = new MemoryStore();
    const result = await syncFeedback(await feedbackFromCsvFile(SAMPLE), store, rulesClassifier, { dryRun: true });
    expect(result.added.length).toBeGreaterThan(0);
    expect(store.items).toHaveLength(0);
  });
});
