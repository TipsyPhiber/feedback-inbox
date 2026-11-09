import { dedupeText } from "./dedupe.js";
import type { StoredItem, TriagedItem } from "./types.js";
import type { WeeklySummary } from "./summary.js";

/**
 * Where the inbox lives. The Notion implementation is the real one; tests use an in-memory one,
 * which keeps the sync logic (idempotency, dedupe, never overwriting triage) testable offline.
 */
export interface InboxStore {
  listItems(): Promise<StoredItem[]>;
  createItem(triaged: TriagedItem): Promise<StoredItem>;
  publishSummary(summary: WeeklySummary): Promise<string>;
}

export class MemoryStore implements InboxStore {
  readonly items: StoredItem[] = [];
  readonly summaries: WeeklySummary[] = [];
  private nextId = 1;

  async listItems() {
    return [...this.items];
  }

  async createItem({ item, classification, duplicateOf }: TriagedItem) {
    const stored: StoredItem = {
      externalId: item.externalId,
      pageId: `page-${this.nextId++}`,
      text: dedupeText(item.title, item.body),
      title: item.title,
      category: classification.category,
      urgency: classification.urgency,
      status: "New",
      receivedAt: item.createdAt,
      ...(item.url ? { url: item.url } : {}),
      ...(duplicateOf ? { duplicateOf } : {}),
    };
    this.items.push(stored);
    return stored;
  }

  async publishSummary(summary: WeeklySummary) {
    this.summaries.push(summary);
    return `summary-${this.summaries.length}`;
  }
}
