import { Client, isFullPage, type BlockObjectRequest } from "@notionhq/client";
import { dedupeText } from "../dedupe.js";
import type { InboxStore } from "../store.js";
import { headline, type WeeklySummary } from "../summary.js";
import { CATEGORIES, type Category, type StoredItem, type TriagedItem } from "../types.js";

/** Column names in the Notion database. The agent playbook (AGENTS.md) refers to these by name. */
export const P = {
  title: "Feedback",
  category: "Category",
  urgency: "Urgency",
  status: "Status",
  summary: "Summary",
  original: "Original text",
  tags: "Tags",
  source: "Source",
  author: "Author",
  link: "Link",
  received: "Received",
  externalId: "External ID",
  duplicateOf: "Duplicate of",
  classifier: "Tagged by",
} as const;

export const STATUSES = ["New", "Triaged", "Planned", "Done", "Won't fix"] as const;

const CATEGORY_COLORS: Record<Category, "red" | "blue" | "yellow" | "green" | "gray"> = {
  Bug: "red",
  "Feature request": "blue",
  Question: "yellow",
  Praise: "green",
  Other: "gray",
};

/** Notion caps each rich-text object at 2,000 characters. */
const TEXT_LIMIT = 2000;

function text(content: string) {
  return [{ type: "text" as const, text: { content: content.slice(0, TEXT_LIMIT) } }];
}

function paragraphs(body: string): BlockObjectRequest[] {
  const blocks: BlockObjectRequest[] = [];
  for (const para of body.split(/\n{2,}/)) {
    for (let i = 0; i < para.length; i += TEXT_LIMIT) {
      blocks.push({ type: "paragraph", paragraph: { rich_text: text(para.slice(i, i + TEXT_LIMIT)) } });
    }
  }
  return blocks.slice(0, 100); // one request can append at most 100 blocks
}

export interface InboxIds {
  databaseId: string;
  dataSourceId: string;
  parentPageId: string;
}

/** Create the Feedback Inbox database under a page the integration has been shared with. */
export async function createInbox(notion: Client, parentPageId: string): Promise<InboxIds> {
  const db = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: text("Feedback Inbox"),
    icon: { type: "emoji", emoji: "📥" },
    initial_data_source: {
      properties: {
        [P.title]: { title: {} },
        [P.category]: { select: { options: CATEGORIES.map((name) => ({ name, color: CATEGORY_COLORS[name] })) } },
        [P.urgency]: { number: { format: "number" } },
        [P.status]: { select: { options: STATUSES.map((name) => ({ name })) } },
        [P.summary]: { rich_text: {} },
        [P.original]: { rich_text: {} },
        [P.tags]: { multi_select: { options: [] } },
        [P.source]: { select: { options: [{ name: "GitHub" }, { name: "CSV" }] } },
        [P.author]: { rich_text: {} },
        [P.link]: { url: {} },
        [P.received]: { date: {} },
        [P.externalId]: { rich_text: {} },
        [P.duplicateOf]: { rich_text: {} },
        [P.classifier]: { select: { options: [{ name: "claude" }, { name: "rules" }] } },
      },
    },
  });
  if (!("data_sources" in db) || !db.data_sources[0]) {
    throw new Error("Notion created the database but returned no data source ID");
  }
  return { databaseId: db.id, dataSourceId: db.data_sources[0].id, parentPageId };
}

export class NotionStore implements InboxStore {
  constructor(
    private readonly notion: Client,
    private readonly ids: InboxIds,
  ) {}

  async listItems(): Promise<StoredItem[]> {
    const items: StoredItem[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.notion.dataSources.query({
        data_source_id: this.ids.dataSourceId,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const result of page.results) {
        if (!isFullPage(result)) continue;
        const stored = toStoredItem(result.id, result.properties);
        if (stored) items.push(stored);
      }
      cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
    } while (cursor);
    return items;
  }

  async createItem({ item, classification, duplicateOf }: TriagedItem): Promise<StoredItem> {
    const page = await this.notion.pages.create({
      parent: { type: "data_source_id", data_source_id: this.ids.dataSourceId },
      properties: {
        [P.title]: { title: text(item.title) },
        [P.category]: { select: { name: classification.category } },
        [P.urgency]: { number: classification.urgency },
        [P.status]: { select: { name: "New" } },
        [P.summary]: { rich_text: text(classification.summary) },
        [P.original]: { rich_text: text(item.body) },
        [P.tags]: { multi_select: classification.tags.map((name) => ({ name: name.replace(/,/g, " ") })) },
        [P.source]: { select: { name: item.source } },
        [P.author]: { rich_text: text(item.author) },
        [P.link]: { url: item.url ?? null },
        [P.received]: { date: { start: item.createdAt } },
        [P.externalId]: { rich_text: text(item.externalId) },
        [P.duplicateOf]: { rich_text: duplicateOf ? text(duplicateOf) : [] },
        [P.classifier]: { select: { name: classification.classifier } },
      },
      children: paragraphs(item.body),
    });
    return {
      externalId: item.externalId,
      pageId: page.id,
      text: dedupeText(item.title, item.body),
      title: item.title,
      category: classification.category,
      urgency: classification.urgency,
      status: "New",
      receivedAt: item.createdAt,
      ...(item.url ? { url: item.url } : {}),
      ...(duplicateOf ? { duplicateOf } : {}),
    };
  }

  async publishSummary(summary: WeeklySummary): Promise<string> {
    const children: BlockObjectRequest[] = [
      { type: "paragraph", paragraph: { rich_text: text(headline(summary)) } },
      { type: "heading_2", heading_2: { rich_text: text("Needs attention") } },
    ];
    if (summary.needsAttention.length === 0) {
      children.push({ type: "paragraph", paragraph: { rich_text: text("Nothing open at urgency 4 or 5.") } });
    }
    for (const item of summary.needsAttention) {
      children.push({
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            { type: "text", text: { content: `[${item.urgency}/5 ${item.category}] ` } },
            { type: "mention", mention: { page: { id: item.pageId } } },
          ],
        },
      });
    }
    children.push({ type: "heading_2", heading_2: { rich_text: text("Reported more than once") } });
    if (summary.repeated.length === 0) {
      children.push({ type: "paragraph", paragraph: { rich_text: text("No repeated reports.") } });
    }
    for (const { original, reports } of summary.repeated) {
      children.push({
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            { type: "text", text: { content: `${reports} reports: ` } },
            { type: "mention", mention: { page: { id: original.pageId } } },
          ],
        },
      });
    }

    const page = await this.notion.pages.create({
      parent: { type: "page_id", page_id: this.ids.parentPageId },
      icon: { type: "emoji", emoji: "📊" },
      properties: { title: { title: text(summary.title) } },
      children,
    });
    return "url" in page ? page.url : page.id;
  }
}

type Properties = Record<string, any>;


function plain(prop: any): string {
  const parts = prop?.type === "title" ? prop.title : prop?.type === "rich_text" ? prop.rich_text : [];
  return (parts as Array<{ plain_text: string }>).map((p) => p.plain_text).join("");
}

/** Read a Notion row back into a StoredItem. Rows without an External ID (added by hand) are still included. */
export function toStoredItem(pageId: string, props: Properties): StoredItem | undefined {
  const title = plain(props[P.title]);
  const externalId = plain(props[P.externalId]) || `notion:${pageId}`;
  const category = props[P.category]?.select?.name as Category | undefined;
  const urgency = props[P.urgency]?.number ?? undefined;
  const status = props[P.status]?.select?.name ?? undefined;
  const url = props[P.link]?.url ?? undefined;
  const receivedAt = props[P.received]?.date?.start ?? undefined;
  const duplicateOf = plain(props[P.duplicateOf]) || undefined;
  return {
    externalId,
    pageId,
    title,
    text: dedupeText(title, plain(props[P.original])),
    ...(category && (CATEGORIES as readonly string[]).includes(category) ? { category } : {}),
    ...(typeof urgency === "number" ? { urgency } : {}),
    ...(status ? { status } : {}),
    ...(url ? { url } : {}),
    ...(receivedAt ? { receivedAt } : {}),
    ...(duplicateOf ? { duplicateOf } : {}),
  };
}
