# Feedback Inbox

Pull user feedback from GitHub issues and form or survey exports into a Notion database, tag every item with AI,
link repeated reports, and publish a weekly summary. Then let an AI agent triage the inbox through
[Notion's MCP server](https://developers.notion.com/docs/get-started-with-mcp).

```
GitHub issues ─┐                                      ┌─> Feedback Inbox (Notion database)
               ├─> tag (Claude or rules) ─> dedupe ───┤
CSV exports  ──┘                                      └─> Weekly summary page
                                                                   │
                         AI agent (Claude Code, Codex) <── Notion MCP ┘  triages, comments, reports
```

## Why

Feedback arrives in five places and gets read in none of them. This puts it in one database the whole
team already uses, sorted by what's broken and how badly, with repeats grouped so "three people hit this"
is visible at a glance.

## What it does

- **Imports** GitHub issues (pull requests skipped) and CSV exports from forms or surveys. Common column
  names (`feedback`, `message`, `email`, `submitted`...) are recognized automatically.
- **Tags** each item with a category, an urgency from 1 to 5, a one-line summary, and product-area tags.
  Uses Claude when an `ANTHROPIC_API_KEY` is set (structured output, low effort, server-side refusal
  fallback); otherwise a rule-based tagger. If a Claude call fails, that one item falls back to rules
  instead of failing the import, and the **Tagged by** column records which one made the call.
- **Links repeats** by word overlap, pointing every repeat at the original report.
- **Is safe to re-run.** Items already in the inbox are skipped, and existing rows are never edited, so
  triage decisions made by people or agents are never overwritten.
- **Summarizes** the week: counts by category, open urgent items, and the most-repeated reports, as a
  Notion page with links to each row.
- **Hands triage to an agent.** [`AGENTS.md`](AGENTS.md) is the playbook an agent follows over Notion
  MCP: re-check tags, link missed duplicates, comment on urgent bugs, mark rows Triaged, and report back.
  It treats feedback text as untrusted input and never closes items on its own.

## Setup

1. Create a Notion integration at [notion.so/profile/integrations](https://www.notion.so/profile/integrations)
   and copy its secret.
2. Share a Notion page with the integration (page menu → Connections).
3. Install and create the inbox under that page:

```bash
npm install
echo "NOTION_TOKEN=ntn_..." > .env      # git-ignored; or export it in your shell
npm run cli -- setup --parent https://www.notion.so/Your-Page-<id>
```

## Use

```bash
# Preview without writing anything (works without Notion access)
npm run cli -- sync --csv examples/sample-feedback.csv --dry-run

# Import from GitHub and a survey export
npm run cli -- sync --github owner/repo --csv responses.csv

# Publish this week's summary page
npm run cli -- summary
```

Optional: `ANTHROPIC_API_KEY` to tag with Claude, `GITHUB_TOKEN` for private repos (the GitHub CLI's login is
used automatically if present).

To let an agent triage: `claude mcp add --transport http notion https://mcp.notion.com/mcp`, sign in with `/mcp`,
then ask it to "triage the feedback inbox." The project's `.mcp.json` does the same for anyone who opens the repo.

## Development

```bash
npm test          # 35 tests: parsing, tagging, dedupe, idempotent sync, summaries, Notion and GitHub clients
npm run typecheck
```

The sync logic talks to an `InboxStore` interface, so tests run against an in-memory store with no network.
`examples/sample-feedback.csv` is invented demo data.

## Stack

TypeScript, Node.js, the Notion API (`@notionhq/client`, data sources), the Claude API (`@anthropic-ai/sdk`),
Zod, Vitest, GitHub Actions.
