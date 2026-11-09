/**
 * Near-duplicate detection: overlap of meaningful words (Dice coefficient) after light stemming.
 * Cheap, deterministic, and good at the common case: several people reporting the same thing in
 * different words ("stops listening after the second step" vs "doesn't keep listening after step 2").
 *
 * The threshold was picked from measurements on examples/sample-feedback.csv: true repeats scored
 * 0.48 and 0.55, while the closest unrelated pair scored 0.21.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "it", "i", "my", "me", "this", "that",
  "with", "when", "be", "are", "was", "can", "do", "does", "just", "please", "hi", "hello", "thanks", "have",
  "has", "had", "after", "again", "every", "time", "like", "really", "so", "but", "not", "you", "your", "get",
]);

export const DUPLICATE_THRESHOLD = 0.4;

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/n't\b/g, " not")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .join(" ");
}

/** Strip common English suffixes so "listening", "listens", and "listen" compare equal. */
export function stem(word: string): string {
  if (word.length <= 4) return word;
  return word.replace(/(ing|ed|es|s)$/, "");
}

export function keywords(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(" ")
      .filter((w) => w.length > 2)
      .map(stem),
  );
}

/** Dice coefficient: 2 * shared / (|a| + |b|). 1 for identical word sets, 0 for nothing in common. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return (2 * shared) / (a.size + b.size);
}

export interface DedupeCandidate {
  externalId: string;
  text: string;
  /** Items that are themselves duplicates point at the original, so chains collapse to one root. */
  duplicateOf?: string;
}

/**
 * For each new item, find the most similar earlier item (existing inbox rows first, then earlier new items).
 * Returns a map of new externalId -> original externalId for every pair at or above the threshold.
 */
export function findDuplicates(
  existing: DedupeCandidate[],
  incoming: DedupeCandidate[],
  threshold = DUPLICATE_THRESHOLD,
): Map<string, string> {
  const pool = existing.map((c) => ({ ...c, words: keywords(c.text) }));
  const result = new Map<string, string>();

  for (const item of incoming) {
    const words = keywords(item.text);
    let best: { id: string; score: number } | undefined;
    for (const other of pool) {
      if (other.externalId === item.externalId) continue;
      const score = similarity(words, other.words);
      if (score >= threshold && (!best || score > best.score)) {
        best = { id: other.duplicateOf ?? other.externalId, score };
      }
    }
    if (best) result.set(item.externalId, best.id);
    pool.push({ ...item, ...(best ? { duplicateOf: best.id } : {}), words });
  }
  return result;
}

/** The text both sides of duplicate detection compare: title plus the first 2,000 characters (Notion's Original text column). */
export function dedupeText(title: string, body: string): string {
  return `${title}\n${body.slice(0, 2000)}`;
}
