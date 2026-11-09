import type { Category, Classification, FeedbackItem } from "../types.js";
import { firstSentence } from "../sources/csv.js";

/**
 * Keyword classifier used when no Anthropic credentials are configured, or when a Claude call fails.
 * Deliberately simple and predictable: it is the floor, not the product.
 */
const SIGNALS: Record<Exclude<Category, "Other">, RegExp[]> = {
  Bug: [
    /\bbug\b/, /\bcrash(es|ed|ing)?\b/, /\berror\b/, /\bbroken\b/, /\bfails?\b/, /\bfailed\b/,
    /doesn'?t work/, /not working/, /\bstuck\b/, /\bfreez(e|es|ing)\b/, /\bblank (page|screen)\b/,
    /\b500\b/, /\bexception\b/, /can'?t (log ?in|sign ?in|save|load|open)/, /\blost (my|all)\b/,
    /\bstops? (working|listening|loading|responding)\b/, /\bturns? off\b/, /doesn'?t keep\b/, /\blogs? me out\b/,
    /\b(really |very |too )?slow\b/, /\btakes? (like )?\d+ (seconds|minutes)\b/, /\bhave to (tap|press|click|restart|reload)\b.*\bagain\b/,
  ],
  "Feature request": [
    /\bfeature\b/, /\bwould be (nice|great|cool)\b/, /\bplease add\b/, /\bcan you add\b/, /\bwish\b/,
    /\bsupport for\b/, /\bit would help\b/, /\ballow (me|us|users) to\b/, /\boption to\b/, /\bintegrat(e|ion)\b/,
  ],
  Question: [/^(how|what|why|where|when|is|can|does|do)\b.*\?/, /\bhow do i\b/, /\bis there a way\b/, /\?\s*$/],
  Praise: [/\blove\b/, /\bgreat\b/, /\bawesome\b/, /\bthank(s| you)\b/, /\bamazing\b/, /\bfantastic\b/, /\bhelpful\b/],
};

const URGENT = [/\bdata loss\b/, /\blost (my|all)\b/, /\bcan'?t (log ?in|sign ?in)\b/, /\bsecurity\b/, /\beveryone\b/, /\bproduction\b/, /\burgent\b/, /\bblock(ed|ing|er)\b/];

const TAGS: Record<string, RegExp> = {
  login: /\b(log ?in|sign ?in|password|auth)\b/,
  mobile: /\b(mobile|android|iphone|ios|phone)\b/,
  performance: /\b(slow|lag|performance|takes forever|loading)\b/,
  search: /\bsearch\b/,
  export: /\b(export|download|csv|pdf)\b/,
  notifications: /\b(notification|email|alert)s?\b/,
  ui: /\b(button|layout|dark mode|font|color|screen)\b/,
  sync: /\b(sync|offline)\b/,
};

export function classifyWithRules(item: FeedbackItem): Classification {
  const text = `${item.title}\n${item.body}`.toLowerCase();
  const hits = (patterns: RegExp[]) => patterns.filter((p) => p.test(text)).length;

  const scores = (Object.keys(SIGNALS) as Array<keyof typeof SIGNALS>).map((category) => ({
    category,
    score: hits(SIGNALS[category]),
  }));
  // Bugs outrank everything on a tie: a crash report that also says "thanks" is still a crash report.
  const order: Category[] = ["Bug", "Feature request", "Question", "Praise"];
  scores.sort((a, b) => b.score - a.score || order.indexOf(a.category) - order.indexOf(b.category));
  const best = scores[0]!;
  const category: Category = best.score > 0 ? best.category : "Other";

  const base: Record<Category, number> = { Bug: 3, "Feature request": 2, Question: 2, Praise: 1, Other: 1 };
  const urgency = Math.min(5, base[category] + (category === "Bug" ? hits(URGENT) : 0));

  return {
    category,
    urgency,
    summary: firstSentence(item.body),
    tags: Object.entries(TAGS)
      .filter(([, pattern]) => pattern.test(text))
      .map(([tag]) => tag),
    classifier: "rules",
  };
}
