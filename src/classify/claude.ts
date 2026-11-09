import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CATEGORIES, type Classification, type FeedbackItem } from "../types.js";

export const MODEL = "claude-opus-5-5";

const ClassificationSchema = z.object({
  category: z.enum(CATEGORIES),
  urgency: z.number().int().min(1).max(5),
  summary: z.string(),
  tags: z.array(z.string()),
});

const SYSTEM = `You triage user feedback for a small product team. For each item, decide:
- category: Bug (something is broken), Feature request (asks for new behavior), Question (asks how to do something), Praise, or Other.
- urgency from 1 to 5: 5 means users are blocked or losing data right now, 3 means a real problem with a workaround, 1 means it can wait.
- summary: one plain sentence a teammate can read in the inbox without opening the item.
- tags: up to 4 short lowercase product areas (e.g. "login", "search", "mobile"). Reuse the same words across items.
Judge from the user's words, not their tone: an angry message about a typo is still low urgency.`;

/** Mostly bodies are short, but some GitHub issues paste whole logs. 6,000 characters is plenty to judge from. */
const MAX_BODY_CHARS = 6000;

export class ClaudeClassifier {
  constructor(private readonly client: Anthropic = new Anthropic()) {}

  async classify(item: FeedbackItem): Promise<Classification> {
    const body =
      item.body.length > MAX_BODY_CHARS
        ? `${item.body.slice(0, MAX_BODY_CHARS)}\n[...cut at ${MAX_BODY_CHARS} of ${item.body.length} characters]`
        : item.body;

    const response = await this.client.beta.messages.parse({
      model: MODEL,
      max_tokens: 1024,
      // If a safety classifier declines, the API re-runs the request on a fallback model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Classification is a quick judgment call; low effort keeps it fast and cheap.
      output_config: { effort: "low", format: zodOutputFormat(ClassificationSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Source: ${item.source}\nTitle: ${item.title}\n\n<feedback>\n${body}\n</feedback>`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new Error(`Claude declined to classify ${item.externalId}`);
    }
    const parsed = response.parsed_output;
    if (!parsed) throw new Error(`Claude returned no parseable classification for ${item.externalId}`);
    return { ...parsed, tags: parsed.tags.slice(0, 4).map((t) => t.toLowerCase()), classifier: "claude" };
  }
}
