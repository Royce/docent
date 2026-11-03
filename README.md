# Docent

A local tool for reviewing large pull requests. Docent breaks a PR into small "slices" — each a handful of related hunks with a short explanation — and walks you through them one at a time, starting from an overview of what the PR does and why. A panel of reviewers reads the PR alongside you, and their findings are pinned on the code as you go.

Everything runs on your machine: GitHub is read through the `gh` CLI, and the summaries and reviews come from the model you choose.

## Requirements

- Node.js 22.13 or later, 24, or 26 and up. Odd-numbered releases such as 25 aren't supported. `web/.nvmrc` picks 24 for nvm and fnm.
- [GitHub CLI](https://cli.github.com/), signed in (`gh auth login`) with access to the repos you want to review. Docent reads PRs and posts your reviews through it, as you.
- A model, from any of:
  - [Claude Code](https://code.claude.com), installed and signed in. Its models run through `claude -p` on your own login, without your settings or MCP servers.
  - [Codex](https://developers.openai.com/codex/cli), installed and signed in (`codex login`). Its models run through `codex exec` on your own login, in a read-only sandbox without your Codex config. Codex lists some models your plan may not include; a call to one of those says so.
  - OpenAI-compatible providers: a local server such as oMLX or LM Studio, or a hosted proxy such as LiteLLM. Add them on the **Settings** page, with a key if they need one and how many concurrent requests each takes.

  Where a call needs to look beyond the diff — answering your question about a line, or checking a finding against the code — Claude Code and Codex are given Docent's own read-only tools for the PR's code, and nothing else.

The app's **Getting started** page checks each of these for you, and the start page points to it until they're in place.

## Running

```sh
cd web && npm install && npm run dev    # http://localhost:17321
```

Open http://localhost:17321 and paste a GitHub PR URL. To run a built copy instead: `npm run build && npm start`, on the same port. Set `DOCENT_PORT` to use another one.

## Reviewing a PR

A review moves through four steps, shown along the top:

- **Overview** — what the PR does and why, the slices to read, and the review panel to start. What's already been said on the PR shapes the summary, and the reviewers leave out points raised there.
- **Read** — each slice's changes, with notes on the files that need them. Select lines by dragging down their line numbers to **Ask** Docent about them, or to leave a **Comment** to post as written.
- **Wrap up** — confirm or skip the panel's findings, and draft your comments from your threads.
- **Post** — Docent prepares the review: comments making the same point merged, anything already said on the PR set aside, and a suggested outcome. Post it, or leave it pending on GitHub to add to and submit there.

## The review panel

Each PR has a panel of reviewers, which you can make the default for every PR:

- **Docent's reviewer**, on any model, with a **persona** if you like — a point of view such as security or tests, written on the Settings page. **Auto** picks the personas a PR warrants, alongside the general reviewer.
- **External reviewers** — your own review tooling, a prompt or a skill, run as an unattended Claude Code or Codex session that reads the PR through Docent. Set them up on the Settings page.
- **Your own agent**, connected over MCP (below).

An editor goes over what they find before it's shown: findings making the same point are grouped, and kept ones are checked against the code.

## Bringing your own agent

Docent serves an MCP server at `http://localhost:17321/mcp` (Streamable HTTP, local connections only). Add it once, for all your projects:

```sh
claude mcp add --scope user --transport http docent http://localhost:17321/mcp
codex mcp add docent --url http://localhost:17321/mcp
```

Then set a reviewer on the panel to **Connect via MCP** and start it. After your usual review, tell your agent the sentence the panel shows (it names the PR and the reviewer), and its findings are pinned on the code as you read. In Claude Code, `/mcp__docent__review owner/repo#123` asks it to review a PR, and `/mcp__docent__submit owner/repo#123` sends the findings of a review it has already done.

The agent reads the PR with `get_review_context`, `get_diff`, `read_file`, `list_files`, `search_code` and `get_existing_comments`, and sends findings with `submit_review`, or one at a time with `submit_finding` and then `finish_review`. Any MCP-capable agent can connect to the same address.

## Where data lives

Everything is kept in `web/data`, or wherever `DOCENT_DATA_DIR` points:

- `docent.db` — your reviews: slices, threads, findings and prepared reviews.
- `settings.json` — providers, personas, external reviewers and the default panel. It holds provider keys, so it's written owner-only, and keys never go back to the browser.
- `repos/` — shallow clones of the PRs' code, fetched with your `gh` login for the read-only tools, holding their file listings and whatever's been read.
