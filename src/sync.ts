import { classifyAll, type Classifier } from "./classify/index.js";
import { dedupeText, findDuplicates } from "./dedupe.js";
import type { InboxStore } from "./store.js";
import type { FeedbackItem, TriagedItem } from "./types.js";

export interface SyncResult {
  fetched: number;
  skipped: number;
  added: TriagedItem[];
}

/**
 * Add new feedback to the inbox.
 * - Idempotent: items already in the inbox (matched on externalId) are skipped, so re-running is safe.
 * - Never edits existing rows, so triage decisions made by people or agents are never overwritten.
 * - Marks near-duplicates of existing or earlier items instead of hiding them; repeats are signal.
 */
export async function syncFeedback(
  items: FeedbackItem[],
  store: InboxStore,
  classifier: Classifier,
  opts: { dryRun?: boolean } = {},
): Promise<SyncResult> {
  const existing = await store.listItems();
  const known = new Set(existing.map((e) => e.externalId));

  // Drop items already stored, and repeats within this batch (the same CSV row exported twice).
  const seen = new Set<string>();
  const fresh = items.filter((i) => {
    if (known.has(i.externalId) || seen.has(i.externalId)) return false;
    seen.add(i.externalId);
    return true;
  });
  // Oldest first, so the earliest report becomes the original and later ones point at it.
  fresh.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const duplicates = findDuplicates(
    existing.map((e) => ({ externalId: e.externalId, text: e.text, ...(e.duplicateOf ? { duplicateOf: e.duplicateOf } : {}) })),
    fresh.map((i) => ({ externalId: i.externalId, text: dedupeText(i.title, i.body) })),
  );
  const classifications = await classifyAll(classifier, fresh);

  const added: TriagedItem[] = fresh.map((item, index) => {
    const duplicateOf = duplicates.get(item.externalId);
    return { item, classification: classifications[index]!, ...(duplicateOf ? { duplicateOf } : {}) };
  });

  if (!opts.dryRun) {
    // Sequential on purpose: Notion allows about three requests per second per integration.
    for (const triaged of added) await store.createItem(triaged);
  }
  return { fetched: items.length, skipped: items.length - fresh.length, added };
}
