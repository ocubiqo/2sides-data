---
name: research-topics
description: Hand-research and publish new 2 Sides voting topics using Claude Code's own WebSearch/WebFetch (zero Anthropic-API cost) instead of the paid discover-topics.js/generate-topics.js pipeline. Use when asked to add topics, find trending India news to vote on, or "research topics" for the app — especially while daily-batch.yml stays dormant pre-traction. Sourcing spans domestic Indian coverage AND global coverage where India is a major point of discussion (trade/tariffs, foreign policy, UN/G20/BRICS, global tech/AI regulation citing India, etc.).
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
   contested news relevant to an Indian audience — no forced category balance. Go
   by what's hot/trending; the goal is maximum engagement, not even coverage
   across politics/cricket/tech/jobs/bollywood/education.
   - **Two sourcing lanes, both in scope every run:**
     - **Domestic** — Indian outlets, Indian politics/sport/entertainment/jobs
       news, what's trending on Indian Twitter/Instagram/Facebook.
     - **Global-with-India-angle** — international stories where India (the
       country, its government, its companies, or its citizens) is a major
       subject: US/EU trade or tariff disputes, India's UN Security Council
       bid, foreign-policy rows, G20/BRICS/Quad positioning, global AI/tech
       regulation that names India, India-Pakistan or India-China friction as
       covered by international press, global rankings/reports where India's
       standing is the story. Search international outlets (Reuters, AP,
       Al Jazeera, BBC, etc.), not only `.in` domains, for this lane — a
       purely domestic search misses these by construction.
     Run at least one search pass for each lane per batch; don't let the
     global lane silently drop back to domestic-only just because it's listed
     second.
   - `country` stays `"IN"` for every topic regardless of which lane it came
     from — this widens *sourcing*, not the app's country scope. The question
     must still be framed around what it means for India/Indians, not as a
     neutral global explainer.
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

3. **`review.tier` — escalation keywords, then override by judgment.**
   As of 2026-09-28, every category auto-publishes by default
   (`config/review-tiers.json`'s `auto_publish` list covers all six —
   politics included). Review is governed purely by `escalation_keywords`
   (religion, caste, communal, court, verdict, arrest, allegation, death,
   riot, election, boycott, ban — matched case-insensitively against the
   question too, see `vet-topic.js`) — a match promotes a topic to
   `review_required` regardless of category. Override to `review_required`
   by hand on top of that, regardless of what the keyword scan found,
   whenever a topic is really about India-Pakistan tension, government
   censorship power, press freedom, or similarly sensitive framing even if
   dressed as sport/tech/entertainment. Add a one-line comment in the
   compose script explaining the override.
   - Global-lane topics get the same scrutiny, not less: a trade/tariff
     dispute or foreign-policy row can read as routine `politics` but still
     deserves a by-hand look, and a global story dressed as
     `tech`/`jobs`/`bollywood` (e.g. a foreign company's India layoffs, a
     global platform's India-specific
     regulation) still needs the same override judgment as a domestic one.

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
   - Batch size follows the material, not a fixed cap. 2–3 is fine when that's
     all that's genuinely trending and two-sided; when research turns up more
     — 5, 10, whatever the day's news actually supports — compose and present
     all of it in one pass rather than artificially splitting into several
     small batches or holding candidates back. The limiting factor is quality
     (genuinely two-sided, currently trending, real sources) and validation
     passing, never a target count.
   - Don't pad a batch to hit a round number, and don't trim a strong batch
     down to look conservative — report what the research actually found.

7. **Publish the approved batch:**
   ```
   git pull --ff-only origin main
   node scripts/pipeline/promote-topics.js --print-hashes
   # build a decisions file approving the agreed ids (.pipeline/ is
   # gitignored — fine to leave the decisions file there), then:
   node scripts/pipeline/promote-topics.js --decisions <file> --approver <github-login>
   DATA_MODE=live node scripts/pipeline/build-feed.js
   npm run check      # tests + fixtures + validate — must be all green
   git add -A && git commit -m "content: publish batch N — hand-researched via Claude Code"
   git push origin main
   ```
   **Do NOT run `seed-sample-tallies.js`** — `dataMode` is `"live"` (see the
   constraints section below); a freshly-promoted topic having no tally file
   yet is correct, not something to seed fake numbers into.

   If push is rejected (non-fast-forward — the 6-hourly `snapshot-tallies.yml`
   cron is the most likely cause, not just `review-decision.yml` or manual
   GitHub edits): `git fetch origin main`, then `git merge origin/main`. This
   is very likely a REAL conflict, not a clean rename — both sides typically
   touched the same derived `feeds/IN/feed.json` / `manifest.json` (the cron
   ran a routine tally snapshot while you were publishing). Resolve by
   keeping your own `topics/` changes as-is, letting `git rm` win any
   tally-file delete/modify conflict if one comes up, then **regenerating
   the feed files from scratch** rather than hand-editing the conflict
   markers: `DATA_MODE=live node scripts/pipeline/build-feed.js`, then
   `git add feeds/IN/feed.json feeds/IN/manifest.json`, `npm run check`,
   `git commit`, `git push` again.

## Constraints this skill must always respect

- Never dispatch `daily-batch.yml`. Never call the paid `discover-topics.js` /
  `generate-topics.js` scripts against the real API for topic generation — only
  `--mock` for testing.
- `context` ≤ 320 chars, `sides.yes`/`sides.no` ≤ 18 chars each — check before
  writing, not after.
- No forced category balance — chase what's trending.
- Chat-based review and approval, not GitHub issue checkboxes.
- Hand-override `review.tier` to `review_required` — on top of whatever the
  escalation-keyword scan found — for religious/communal, India-Pakistan
  tension, government censorship power, press freedom, or similarly
  sensitive content, regardless of category.
- `dataMode` is `"live"` as of 2026-09-28 (flipped from sample — see
  git history around that date for the full pipeline this required: the
  synthetic-flag-carry bug fix in snapshot-tallies.js, the DATA_MODE
  fallback fix in the cron workflow, and deleting every synthetic tally).
  **Never run `seed-sample-tallies.js` against real published topics again**
  — it refuses outright when `DATA_MODE=live` is set in its own process
  env, but nothing stops someone from running it locally without that env
  var set and quietly reintroducing fake numbers. A freshly-promoted topic
  with no tally file is correct and expected: build-feed.js's empty-tally
  fallback renders it as an honest 0-vote cold start, not a bug to seed
  away.
