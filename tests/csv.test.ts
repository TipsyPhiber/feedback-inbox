import { describe, expect, it } from "vitest";
import { feedbackFromCsv, firstSentence, parseCsv } from "../src/sources/csv.js";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas and newlines inside fields", () => {
    const rows = parseCsv('a,b\n"x, y","say ""hi""\nthere"\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
  });

  it("handles CRLF line endings, a UTF-8 BOM, and skips blank lines", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n\r\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("rejects a file that ends inside a quoted field", () => {
    expect(() => parseCsv('a\n"unterminated')).toThrow(/quoted field/);
  });
});

describe("feedbackFromCsv", () => {
  it("maps common survey column names and derives a title", () => {
    const [item] = feedbackFromCsv(
      'Response ID,Submitted,Email,Message\nr1,2026-11-02,a@b.co,"Search is slow. It takes 5 seconds."\n',
      "survey.csv",
    );
    expect(item).toMatchObject({
      externalId: "csv:r1",
      title: "Search is slow.",
      author: "a@b.co",
      source: "CSV",
      createdAt: "2026-11-02T00:00:00.000Z",
    });
  });

  it("gives rows without an ID a stable content hash, so re-importing never duplicates", () => {
    const csv = "feedback,name\nDark mode please,Sam\n";
    const first = feedbackFromCsv(csv, "a.csv")[0]!.externalId;
    const second = feedbackFromCsv(csv, "b.csv")[0]!.externalId;
    expect(first).toMatch(/^csv:[0-9a-f]{16}$/);
    expect(second).toBe(first);
  });

  it("skips empty feedback rows and explains a missing feedback column", () => {
    expect(feedbackFromCsv("feedback,name\n,Sam\n", "x.csv")).toEqual([]);
    expect(() => feedbackFromCsv("name,date\nSam,2026-01-01\n", "x.csv")).toThrow(/no feedback column/);
  });
});

describe("firstSentence", () => {
  it("stops at the first sentence and caps the length", () => {
    expect(firstSentence("Broken. Please fix")).toBe("Broken.");
    expect(firstSentence("x".repeat(200))).toHaveLength(80);
  });
});
