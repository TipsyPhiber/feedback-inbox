import { describe, expect, it } from "vitest";
import { findDuplicates, keywords, normalize, similarity } from "../src/dedupe.js";

describe("normalize", () => {
  it("drops punctuation and filler words, and treats n't as not", () => {
    expect(normalize("The mic doesn't work!!")).toBe("mic work");
  });

  it("matches word forms after stemming", () => {
    expect(keywords("listening listens")).toEqual(keywords("listen"));
  });
});

describe("findDuplicates", () => {
  it("links two reports of the same problem written differently", () => {
    const result = findDuplicates(
      [{ externalId: "a", text: "Cook Mode stops listening after the second step, I have to tap the mic again" }],
      [{ externalId: "b", text: "Cook mode doesn't keep listening, after step 2 the mic turns off and I have to press it again" }],
    );
    expect(result.get("b")).toBe("a");
  });

  it("leaves unrelated feedback alone", () => {
    const result = findDuplicates(
      [{ externalId: "a", text: "Search is really slow when filtering by cuisine" }],
      [{ externalId: "b", text: "Please add dark mode for night cooking" }],
    );
    expect(result.size).toBe(0);
  });

  it("points every repeat at the original, never at another repeat", () => {
    const text = "password reset link logs me out and login fails with invalid token";
    const result = findDuplicates(
      [{ externalId: "orig", text }],
      [
        { externalId: "r1", text: `${text} on mobile` },
        { externalId: "r2", text: `${text} on my phone` },
      ],
    );
    expect(result.get("r1")).toBe("orig");
    expect(result.get("r2")).toBe("orig");
  });

  it("scores identical text 1 and empty text 0", () => {
    expect(similarity(keywords("same words"), keywords("same words"))).toBe(1);
    expect(similarity(keywords(""), keywords("anything"))).toBe(0);
  });
});
