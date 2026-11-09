import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { FeedbackItem } from "../types.js";

/**
 * Parse RFC 4180 CSV: quoted fields, escaped quotes (""), commas and newlines inside quotes, CRLF.
 * Returns rows of raw string cells.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const src = text.replace(/^﻿/, ""); // strip a UTF-8 BOM from spreadsheet exports

  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (inQuotes) throw new Error("CSV ends inside a quoted field");
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

/** Header names we accept for each field, compared case-insensitively. */
const COLUMN_ALIASES: Record<"text" | "title" | "author" | "date" | "url" | "id", string[]> = {
  text: ["text", "feedback", "message", "body", "comment", "response"],
  title: ["title", "subject"],
  author: ["author", "name", "user", "email", "from"],
  date: ["date", "created", "created_at", "timestamp", "submitted"],
  url: ["url", "link"],
  id: ["id", "response id", "ticket"],
};

function findColumn(header: string[], field: keyof typeof COLUMN_ALIASES): number {
  const names = COLUMN_ALIASES[field];
  return header.findIndex((h) => names.includes(h.trim().toLowerCase()));
}

/** Turn a form or survey export into feedback items. The only required column is the feedback text. */
export function feedbackFromCsv(text: string, fileLabel: string): FeedbackItem[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const col = {
    text: findColumn(header, "text"),
    title: findColumn(header, "title"),
    author: findColumn(header, "author"),
    date: findColumn(header, "date"),
    url: findColumn(header, "url"),
    id: findColumn(header, "id"),
  };
  if (col.text === -1) {
    throw new Error(
      `${fileLabel}: no feedback column found. Expected one of: ${COLUMN_ALIASES.text.join(", ")}`,
    );
  }

  const cell = (row: string[], index: number) => (index === -1 ? "" : (row[index] ?? "").trim());
  const items: FeedbackItem[] = [];
  for (const row of rows) {
    const body = cell(row, col.text);
    if (!body) continue;
    const rawDate = cell(row, col.date);
    const parsed = rawDate ? new Date(rawDate) : undefined;
    // A source ID wins; otherwise hash the content so re-importing the same export never duplicates rows.
    const sourceId = cell(row, col.id);
    const key = sourceId || createHash("sha256").update(`${cell(row, col.author)}\n${body}`).digest("hex").slice(0, 16);
    const url = cell(row, col.url);
    items.push({
      externalId: `csv:${key}`,
      title: cell(row, col.title) || firstSentence(body),
      body,
      author: cell(row, col.author) || "Anonymous",
      source: "CSV",
      ...(url ? { url } : {}),
      createdAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString(),
    });
  }
  return items;
}

export async function feedbackFromCsvFile(path: string): Promise<FeedbackItem[]> {
  return feedbackFromCsv(await readFile(path, "utf8"), path);
}

/** First sentence, capped at 80 characters, for items that arrive without a title. */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = flat.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? flat : flat.slice(0, end + 1);
  return sentence.length <= 80 ? sentence : `${sentence.slice(0, 77).trimEnd()}...`;
}
