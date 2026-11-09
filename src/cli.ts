#!/usr/bin/env node
import { Client } from "@notionhq/client";
import { parseArgs } from "node:util";
import { ClaudeClassifier } from "./classify/claude.js";
import { hasAnthropicCredentials, rulesClassifier, withRuleFallback, type Classifier } from "./classify/index.js";
import { loadInbox, parseNotionId, requireNotionToken, saveInbox } from "./config.js";
import { createInbox, NotionStore } from "./notion/store.js";
import { feedbackFromCsvFile } from "./sources/csv.js";
import { feedbackFromGitHub, resolveGitHubToken } from "./sources/github.js";
import { buildWeeklySummary, headline } from "./summary.js";
import { syncFeedback } from "./sync.js";
import type { FeedbackItem } from "./types.js";

const HELP = `feedback-inbox: pull user feedback into a Notion database, tag it, and summarize it

Commands
  setup   --parent <page URL or ID>       Create the Feedback Inbox database under a Notion page
  sync    [--github owner/repo]... [--csv file]... [--since YYYY-MM-DD] [--rules] [--dry-run]
          Import new feedback, tag it, mark duplicates. Safe to re-run.
  summary [--days 7] [--dry-run]          Publish a weekly summary page next to the inbox

Environment
  NOTION_TOKEN        Notion integration secret (required except for sync --dry-run)
  ANTHROPIC_API_KEY   Optional. Tags with Claude; without it, a rule-based tagger is used
  GITHUB_TOKEN        Optional. Falls back to the GitHub CLI login, or anonymous for public repos`;

async function main(argv: string[]) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      parent: { type: "string" },
      github: { type: "string", multiple: true },
      csv: { type: "string", multiple: true },
      since: { type: "string" },
      days: { type: "string" },
      rules: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (!command || values.help || command === "help") {
    console.log(HELP);
    return;
  }

  if (command === "setup") {
    if (!values.parent) throw new Error("setup needs --parent <Notion page URL or ID>");
    const notion = new Client({ auth: requireNotionToken() });
    const ids = await createInbox(notion, parseNotionId(values.parent));
    await saveInbox(ids);
    console.log(`Created Feedback Inbox (data source ${ids.dataSourceId}). Saved to .feedback-inbox.json`);
    return;
  }

  if (command === "sync") {
    const dryRun = values["dry-run"];
    const since = values.since ? new Date(values.since) : undefined;
    if (since && Number.isNaN(since.getTime())) throw new Error(`--since must be a date, got "${values.since}"`);

    const items: FeedbackItem[] = [];
    if (values.github?.length) {
      const token = await resolveGitHubToken();
      for (const repo of values.github) {
        const found = await feedbackFromGitHub(repo, { ...(token ? { token } : {}), ...(since ? { since } : {}) });
        console.log(`GitHub ${repo}: ${found.length} issues`);
        items.push(...found);
      }
    }
    for (const file of values.csv ?? []) {
      const found = (await feedbackFromCsvFile(file)).filter((i) => !since || new Date(i.createdAt) >= since);
      console.log(`CSV ${file}: ${found.length} rows`);
      items.push(...found);
    }
    if (!values.github?.length && !values.csv?.length) {
      throw new Error("Nothing to import. Pass --github owner/repo and/or --csv file.");
    }
    if (items.length === 0) {
      console.log("No feedback found in those sources. Nothing to do.");
      return;
    }

    const classifier = pickClassifier(values.rules);
    // A dry run with no Notion access compares against an empty inbox.
    const store = dryRun && !process.env.NOTION_TOKEN
      ? { listItems: async () => [], createItem: async () => { throw new Error("dry run"); }, publishSummary: async () => "" }
      : new NotionStore(new Client({ auth: requireNotionToken() }), await loadInbox());

    const result = await syncFeedback(items, store, classifier, { dryRun });
    for (const { item, classification: c, duplicateOf } of result.added) {
      const dup = duplicateOf ? `  (repeats ${duplicateOf})` : "";
      console.log(`  [${c.urgency}/5 ${c.category.padEnd(15)}] ${item.title}${dup}`);
    }
    console.log(
      `${dryRun ? "Would add" : "Added"} ${result.added.length}, skipped ${result.skipped} already in the inbox` +
        `, ${result.added.filter((a) => a.duplicateOf).length} marked as repeats.`,
    );
    return;
  }

  if (command === "summary") {
    const days = values.days ? Number(values.days) : 7;
    if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a positive whole number");
    const store = new NotionStore(new Client({ auth: requireNotionToken() }), await loadInbox());
    const summary = buildWeeklySummary(await store.listItems(), new Date(), days);
    console.log(summary.title);
    console.log(headline(summary));
    if (values["dry-run"]) return;
    console.log(`Published: ${await store.publishSummary(summary)}`);
    return;
  }

  throw new Error(`Unknown command "${command}". Run with --help.`);
}

function pickClassifier(forceRules: boolean): Classifier {
  if (forceRules || !hasAnthropicCredentials()) {
    if (!forceRules) console.log("No ANTHROPIC_API_KEY set; tagging with the rule-based classifier.");
    return rulesClassifier;
  }
  return withRuleFallback(new ClaudeClassifier(), (item, err) =>
    console.warn(`  Claude couldn't tag ${item.externalId} (${err instanceof Error ? err.message : err}); used rules`),
  );
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
