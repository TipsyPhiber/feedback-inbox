import { describe, expect, it, vi } from "vitest";
import { feedbackFromGitHub } from "../src/sources/github.js";

describe("feedbackFromGitHub", () => {
  it("skips pull requests and pages through results", async () => {
    const issue = (n: number, pr = false) => ({
      number: n,
      title: `Issue ${n}`,
      body: n === 2 ? null : `Body ${n}`,
      html_url: `https://github.com/o/r/issues/${n}`,
      created_at: "2026-11-01T00:00:00Z",
      user: { login: "u" },
      ...(pr ? { pull_request: {} } : {}),
    });
    const pages = [Array.from({ length: 100 }, (_, i) => issue(i + 1, i % 2 === 0)), [issue(101)]];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(pages.shift() ?? [])));

    const items = await feedbackFromGitHub("o/r", { fetchImpl: fetchImpl as unknown as typeof fetch, token: "t" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(51);
    expect(items[0]).toMatchObject({ externalId: "github:o/r#2", body: "Issue 2", source: "GitHub" });
  });

  it("rejects malformed repo names before calling GitHub", async () => {
    await expect(feedbackFromGitHub("not-a-repo")).rejects.toThrow(/owner\/name/);
  });
});
