import { describe, expect, it, vi } from "vitest";
import { classifyAll, withRuleFallback, type Classifier } from "../src/classify/index.js";
import { classifyWithRules } from "../src/classify/rules.js";
import type { FeedbackItem } from "../src/types.js";

const item = (body: string, title = ""): FeedbackItem => ({
  externalId: `t:${body.slice(0, 10)}`,
  title,
  body,
  author: "test",
  source: "CSV",
  createdAt: "2026-11-01T00:00:00.000Z",
});

describe("classifyWithRules", () => {
  it("files a crash report as a bug even when the user is polite about it", () => {
    expect(classifyWithRules(item("Thanks for the app! It crashes every time I open a recipe.")).category).toBe("Bug");
  });

  it("raises urgency when users are locked out or losing data", () => {
    const minor = classifyWithRules(item("The button color is broken on the settings page"));
    const blocked = classifyWithRules(item("I can't log in and I've lost all my saved recipes. Error 500."));
    expect(blocked.category).toBe("Bug");
    expect(blocked.urgency).toBeGreaterThan(minor.urgency);
    expect(blocked.tags).toContain("login");
  });

  it("treats things that stop working or crawl as bugs, not 'Other'", () => {
    expect(classifyWithRules(item("Cook Mode stops listening after the second step, I have to tap the mic again")).category).toBe("Bug");
    expect(classifyWithRules(item("Search is really slow, takes like 5 seconds every time")).category).toBe("Bug");
    expect(classifyWithRules(item("Search is really slow, takes like 5 seconds every time")).tags).toContain("performance");
  });

  it("recognizes feature requests, questions, praise, and everything else", () => {
    expect(classifyWithRules(item("Would be great to have dark mode")).category).toBe("Feature request");
    expect(classifyWithRules(item("How do I change the voice?")).category).toBe("Question");
    expect(classifyWithRules(item("Love this, the shopping list is amazing")).category).toBe("Praise");
    expect(classifyWithRules(item("Saw your booth at the fair")).category).toBe("Other");
  });

  it("marks its own output so people know a rule, not a model, made the call", () => {
    expect(classifyWithRules(item("anything")).classifier).toBe("rules");
  });
});

describe("withRuleFallback", () => {
  it("degrades one failed item to rules instead of failing the whole batch", async () => {
    const flaky: Classifier = {
      classify: vi.fn(async (i: FeedbackItem) => {
        if (i.body.includes("boom")) throw new Error("rate limited");
        return { category: "Praise" as const, urgency: 1, summary: "s", tags: [], classifier: "claude" as const };
      }),
    };
    const onFallback = vi.fn();
    const results = await classifyAll(withRuleFallback(flaky, onFallback), [item("nice"), item("boom, it crashed")]);
    expect(results.map((r) => r.classifier)).toEqual(["claude", "rules"]);
    expect(results[1]!.category).toBe("Bug");
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it("keeps results in input order with concurrency", async () => {
    const slowFirst: Classifier = {
      classify: async (i) => {
        await new Promise((r) => setTimeout(r, i.body === "a" ? 20 : 1));
        return { category: "Other", urgency: 1, summary: i.body, tags: [], classifier: "claude" };
      },
    };
    const results = await classifyAll(slowFirst, ["a", "b", "c"].map((b) => item(b)), 3);
    expect(results.map((r) => r.summary)).toEqual(["a", "b", "c"]);
  });
});
