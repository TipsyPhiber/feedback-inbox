import type { Classification, FeedbackItem } from "../types.js";
import { classifyWithRules } from "./rules.js";

export interface Classifier {
  classify(item: FeedbackItem): Promise<Classification>;
}

/** Wrap a primary classifier so one bad call degrades that item to rules instead of failing the whole sync. */
export function withRuleFallback(primary: Classifier, onFallback?: (item: FeedbackItem, err: unknown) => void): Classifier {
  return {
    async classify(item) {
      try {
        return await primary.classify(item);
      } catch (err) {
        onFallback?.(item, err);
        return classifyWithRules(item);
      }
    },
  };
}

export const rulesClassifier: Classifier = { classify: async (item) => classifyWithRules(item) };

/** True when the Anthropic SDK can find credentials on its own (env key or auth token). */
export function hasAnthropicCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
}

/** Run classify over items with a small concurrency cap so a big import doesn't hit rate limits. */
export async function classifyAll(
  classifier: Classifier,
  items: FeedbackItem[],
  concurrency = 4,
): Promise<Classification[]> {
  const results: Classification[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await classifier.classify(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
