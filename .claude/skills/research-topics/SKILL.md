---
name: research-topics
description: Hand-research and publish new 2 Sides voting topics using Claude Code's own WebSearch/WebFetch (zero Anthropic-API cost) instead of the paid discover-topics.js/generate-topics.js pipeline. Use when asked to add topics, find trending India news to vote on, or "research topics" for the app — especially while daily-batch.yml stays dormant pre-traction.
---

# Research topics (cost-free, hand-curated)

## Why this exists, not the automated pipeline

`daily-batch.yml` (`discover-topics.js` + `generate-topics.js`) costs real Anthropic
API money every time it runs — `dry_run: true` does NOT skip the API calls, only the
final commit/issue step. The user is cost-sensitive until the app has 5k–10k+
downloads. Until then:

- **Do not dispatch `daily-batch.yml`** for testing or for generating real topics.
- Use this skill's workflow instead: Claude Code's own `WebSearch`/`WebFetch` tools,
  covered by the existing subscription, no marginal API cost.
- All pipeline-script testing goes through `npm test` / `--mock` fixtures only —
  never a live dispatch.

## Workflow

1. **Research via WebSearch/WebFetch.** Look for genuinely two-sided, currently
   contested Indian news — no forced category balance. Go by what's hot/trending;
   the goal is maximum engagement, not even coverage across
   politics/cricket/tech/jobs/bollywood/education.
   - Prefer real article URLs. Reject/avoid hub pages: `WebSearch`/`WebFetch` results
     that end in a category/tag/section/topic/author/archive listing page rather
     than a specific story. See `scripts/pipeline/lib/websearch.js` →
     `looksLikeArticleUrl()` for the exact heuristic (also strips `amp` path
     segments before judging specificity — an AMP URL is not a hub page).
   - Only cite a URL you actually saw resolve via WebSearch/WebFetch — never invent
     or guess one.

2. **Compose topic JSON directly** (no need for the paid generate step). One object
   per topic:
   ```js
   {
     id, schemaVersion: 1, contentVersion: 1, country: "IN",
     category,               // politics | cricket | tech | jobs | bollywood | education
     status: "in_review",
     question,                // 15–120 chars, ends in "?", neutral wording
     context,                 // ⚠️ MAX 320 CHARS — check length before writing the file
     sides: { yes, no },      // ⚠️ MAX 18 CHARS EACH — plain nouns/short phrases, not sentences
     sources: [{ name, url, verified: false, publishedAt }],
     tags: [],
     trendScore,               // 0–100, your judgment of how hot it is
     publishedAt, activeFrom,  // now
     activeUntil,               // now + 7 days for hand-curated batches
     review: { tier, state: "pending", reviewedBy: null, reviewedAt: null, reason: null },
     generation: {
       model: "claude-code-manual-research",
       pipelineRun: "manual-batch-N",
       generatedAt: now, sourceCount: sources.length,
     },
     bookmarks: 0,
   }
   ```
   Write files to `topics/IN/pending/<id>.json`. `id` format: `in-YYYY-MM-<slug>`.

   **Pre-check lengths in the compose script itself** (`len(context) <= 320`,
   `len(yes) <= 18`, `len(no) <= 18`) before writing — this is the single most
   common validation failure across every past batch. Don't wait for
   `validate-data.js` to catch it.

3. **`review.tier` — category default, then override by judgment.**
   Category defaults live in `config/review-tiers.json`
   (cricket/tech/bollywood → `auto_publish`; politics/jobs/education →
   `review_required`). Override to `review_required` by hand, regardless of
   category default, whenever a topic is really about India-Pakistan tension,
   government censorship power, press freedom, or similarly sensitive framing
   even if dressed as sport/tech/entertainment. Add a one-line comment in the
   compose script explaining the override.

4. **Allowlist judgment.** Sources merely need a plausible, real, live URL — they
   don't need to be on `config/source-allowlist.json` to publish (unverified
   sources just don't get the green "verified" badge). Only add a domain to the
   allowlist when you'd genuinely vouch for its editorial standards. Under-including
   is the safe default — do not add a domain "just in case." Past exclusions for
   reference: `thestar.com.my` (non-Indian wire pickup), `indiapolicyhub.in`
   (couldn't vouch for editorial backing).

5. **Validate locally before review:**
   ```
   node scripts/pipeline/validate-data.js --dir topics/IN/pending
   ```
   Fix any length/schema violations, re-run until clean.

6. **Review here in chat** — not a GitHub issue. Present each topic (question,
   context, both sides, source, category, tier, and tier-override reasoning if
   any) directly in the conversation and wait for explicit approval per batch.
   Small batches (2–3 at a time) work better than one large batch.

7. **Publish the approved batch:**
   ```
   git pull --ff-only origin main
   node scripts/pipeline/promote-topics.js --print-hashes
   # build a decisions file approving the agreed ids, then:
   node scripts/pipeline/promote-topics.js --decisions <file> --approver <github-login>
   node scripts/pipeline/seed-sample-tallies.js --only-missing
   node scripts/pipeline/build-feed.js
   npm run check      # tests + fixtures + validate — must be all green
   git add -A && git commit -m "content: publish batch N — hand-researched via Claude Code"
   git push origin main
   ```
   If push is rejected (non-fast-forward — `review-decision.yml` or manual GitHub
   edits can land commits concurrently): `git pull --ff-only origin main` and retry;
   git's rename detection cleanly resolves content-vs-move conflicts.

## Constraints this skill must always respect

- Never dispatch `daily-batch.yml`. Never call the paid `discover-topics.js` /
  `generate-topics.js` scripts against the real API for topic generation — only
  `--mock` for testing.
- `context` ≤ 320 chars, `sides.yes`/`sides.no` ≤ 18 chars each — check before
  writing, not after.
- No forced category balance — chase what's trending.
- Chat-based review and approval, not GitHub issue checkboxes.
- Hand-override `review.tier` to `review_required` for politically-sensitive
  content regardless of category default.
- `dataMode` stays `"sample"` until Phase C (Firebase) ships — every hand-published
  topic still needs a seeded synthetic tally (`seed-sample-tallies.js`), never skip
  that step.
