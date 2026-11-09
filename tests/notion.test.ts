import type { Client } from "@notionhq/client";
import { describe, expect, it, vi } from "vitest";
import { parseNotionId } from "../src/config.js";
import { NotionStore, P, toStoredItem } from "../src/notion/store.js";
import type { TriagedItem } from "../src/types.js";

const ids = { databaseId: "db", dataSourceId: "ds-1", parentPageId: "parent" };

const triaged: TriagedItem = {
  item: {
    externalId: "csv:r-1",
    title: "Mic turns off",
    body: "x".repeat(2500),
    author: "Maya",
    source: "CSV",
    createdAt: "2026-11-02T00:00:00.000Z",
  },
  classification: { category: "Bug", urgency: 4, summary: "Mic stops", tags: ["voice", "a,b"], classifier: "rules" },
  duplicateOf: "csv:r-0",
};

describe("NotionStore.createItem", () => {
  it("creates the row under the data source with every column filled", async () => {
    const create = vi.fn(async () => ({ id: "page-9", object: "page" }));
    const store = new NotionStore({ pages: { create } } as unknown as Client, ids);
    const stored = await store.createItem(triaged);

    const args = (create.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(args.parent).toEqual({ type: "data_source_id", data_source_id: "ds-1" });
    expect(args.properties[P.category]).toEqual({ select: { name: "Bug" } });
    expect(args.properties[P.status]).toEqual({ select: { name: "New" } });
    expect(args.properties[P.duplicateOf].rich_text[0].text.content).toBe("csv:r-0");
    // Notion rejects commas in select option names and text over 2,000 characters.
    expect(args.properties[P.tags].multi_select).toEqual([{ name: "voice" }, { name: "a b" }]);
    expect(args.properties[P.original].rich_text[0].text.content).toHaveLength(2000);
    expect(args.children).toHaveLength(2);
    expect(stored).toMatchObject({ pageId: "page-9", externalId: "csv:r-1", duplicateOf: "csv:r-0" });
  });
});

describe("NotionStore.listItems", () => {
  it("follows pagination and reads rows back", async () => {
    const row = (id: string, ext: string) => ({
      object: "page",
      id,
      url: `https://www.notion.so/${id}`,
      properties: {
        [P.title]: { type: "title", title: [{ plain_text: `Title ${id}` }] },
        [P.externalId]: { type: "rich_text", rich_text: [{ plain_text: ext }] },
        [P.status]: { type: "select", select: { name: "Triaged" } },
      },
    });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ results: [row("p1", "csv:1")], has_more: true, next_cursor: "c2" })
      .mockResolvedValueOnce({ results: [row("p2", "csv:2")], has_more: false, next_cursor: null });
    const store = new NotionStore({ dataSources: { query } } as unknown as Client, ids);

    const items = await store.listItems();
    expect(items.map((i) => [i.externalId, i.status])).toEqual([["csv:1", "Triaged"], ["csv:2", "Triaged"]]);
    expect(query.mock.calls[1]![0]).toMatchObject({ data_source_id: "ds-1", start_cursor: "c2" });
  });
});

describe("toStoredItem", () => {
  it("includes rows someone added by hand, keyed by page ID", () => {
    const item = toStoredItem("abc", { [P.title]: { type: "title", title: [{ plain_text: "Typed in Notion" }] } });
    expect(item).toMatchObject({ externalId: "notion:abc", title: "Typed in Notion" });
  });

  it("ignores a category that isn't one of ours", () => {
    const item = toStoredItem("abc", { [P.category]: { select: { name: "Rant" } } });
    expect(item?.category).toBeUndefined();
  });
});

describe("parseNotionId", () => {
  it("accepts page URLs and dashed or bare IDs", () => {
    const id = "1f2e3d4c5b6a79881f2e3d4c5b6a7988";
    const dashed = "1f2e3d4c-5b6a-7988-1f2e-3d4c5b6a7988";
    expect(parseNotionId(`https://www.notion.so/team/Feedback-${id}?pvs=4`)).toBe(dashed);
    expect(parseNotionId(dashed)).toBe(dashed);
    expect(() => parseNotionId("not a page")).toThrow(/page ID/);
  });
});
