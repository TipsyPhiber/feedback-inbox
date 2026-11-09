/** One piece of user feedback, normalized from whatever source it came from. */
export interface FeedbackItem {
  /** Stable ID from the source, e.g. "github:owner/repo#12" or "csv:<hash>". Used to make syncs idempotent. */
  externalId: string;
  title: string;
  body: string;
  author: string;
  source: "GitHub" | "CSV";
  url?: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export const CATEGORIES = ["Bug", "Feature request", "Question", "Praise", "Other"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Classification {
  category: Category;
  /** 1 (can wait) to 5 (users are blocked right now). */
  urgency: number;
  /** One sentence a teammate can read in the inbox without opening the item. */
  summary: string;
  tags: string[];
  /** Which classifier produced this, so people know how much to trust it. */
  classifier: "claude" | "rules";
}

export interface TriagedItem {
  item: FeedbackItem;
  classification: Classification;
  /** externalId of an earlier item this one repeats, if any. */
  duplicateOf?: string;
}

/** A row already stored in the inbox, as much as dedupe and summaries need. */
export interface StoredItem {
  externalId: string;
  pageId: string;
  text: string;
  category?: Category;
  urgency?: number;
  status?: string;
  title: string;
  url?: string;
  receivedAt?: string;
  duplicateOf?: string;
}
