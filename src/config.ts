import { readFile, writeFile } from "node:fs/promises";
import type { InboxIds } from "./notion/store.js";

export const CONFIG_FILE = ".feedback-inbox.json";

/** Accept a bare page ID (with or without dashes) or any Notion page URL, which ends in the 32-hex ID. */
export function parseNotionId(input: string): string {
  const match = input.replace(/-/g, "").match(/([0-9a-f]{32})(?:\?.*)?$/i);
  if (!match) throw new Error(`Couldn't find a Notion page ID in "${input}"`);
  const id = match[1]!.toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

export async function loadInbox(path = CONFIG_FILE): Promise<InboxIds> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as InboxIds;
  } catch {
    throw new Error(`No inbox configured yet. Run: feedback-inbox setup --parent <notion page URL>`);
  }
}

export async function saveInbox(ids: InboxIds, path = CONFIG_FILE): Promise<void> {
  await writeFile(path, `${JSON.stringify(ids, null, 2)}\n`);
}

export function requireNotionToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env.NOTION_TOKEN;
  if (!token) {
    throw new Error("Set NOTION_TOKEN to your integration's secret (notion.so/profile/integrations).");
  }
  return token;
}
