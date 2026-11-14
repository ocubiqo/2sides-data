# 2sides-data

Topics, tallies and feeds for 2 Sides (voting on two-sided questions). The
website and app read the generated `feeds/IN/*.json`; the pipeline in
`scripts/pipeline/` builds them.

## Creating polls

Polls never expire on their own — people open shared links months later — so
every poll stays open until it is retired. There are three ways to add one:

| Channel | Who | Cost | Review |
|---|---|---|---|
| **Admin backoffice** (`/admin` on the website) | admins | free | none — the admin is the reviewer |
| **Manage polls** workflow (GitHub → Actions → Run workflow) | repo admins/maintainers | free | none |
| **`research-topics` skill** in Claude Code | whoever runs it | free (subscription) | chat approval |
| `daily-batch.yml` (Anthropic API) | manual dispatch only | paid | review issue |

### From the backoffice
Open `/admin`, sign in with your token, fill in the form (limits are shown as
you type), preview the card, and press **Publish to all users**. The poll is
live in about 4 minutes; share links appear once the page is up. Use **Test
without publishing** to run every check, including the source-link check,
without publishing. **Retire** removes a poll (votes are kept).

### From GitHub
Actions → **Manage polls** → Run workflow. Actions: `create`, `reopen`
(`topic_ids` or `expired`), `retire` (`topic_ids` + `reason`). `dry_run` checks
without changing anything. `topics_json` creates up to 20 polls at once.

Or via the API (needs a token with Actions: write on this repo):

```
curl -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/ocubiqo/2sides-data/actions/workflows/manage-polls.yml/dispatches \
  -d '{"ref":"main","inputs":{"action":"create","requested_by":"you","question":"…?","yes_label":"…","no_label":"…","context":"…","category":"tech","source_name":"…","source_url":"https://…"}}'
```

### Rules
Limits live in `config/poll-rules.json` (question 15–120 characters ending in
`?`, context 60–320, side labels 2–18, 1–4 https sources). Dead source links
are rejected; loaded wording or sensitive keywords only produce warnings.
All-or-nothing: if anything in a request is invalid, nothing is written.

### Admin setup (website repo: `ocubiqo/2sides`, `web/`)
Pages secrets: `ADMIN_USERS` (JSON `{"name":"token"}`, tokens ≥ 16 chars) and
`GITHUB_DISPATCH_TOKEN` (fine-grained PAT, this repo, **Actions: write only**).
This repo's Actions secrets `REPO_2SIDES_READ_TOKEN` and
`CLOUDFLARE_API_TOKEN` let the workflow redeploy the site — if either expires,
polls save but never go live until someone deploys by hand.

## Develop
`npm test` · `npm run check` (tests + fixtures + validation)
