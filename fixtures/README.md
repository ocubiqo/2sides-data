# Validation fixtures

Test inputs for `scripts/pipeline/validate-data.js --fixtures`. These are **never
published** — `build-feed.js` only reads `topics/<country>/active/`, and nothing
here is under that path.

`valid-topic.json` / `valid-tally.json` must pass. Every `invalid-*.json` must
fail, each for exactly one reason named in its filename. CI asserts both
directions, so an empty `topics/IN/active/` can never make validation
vacuously green.

Source URLs here point at `example.com` with `verified: false` on purpose.
A fixture that carried a plausible-looking publisher URL would be a standing
invitation to copy it into real data — which is how the original seed topics
ended up shipping `verified: true` on links that 404.

## `websearch-response.json`

A recorded shape of a real Claude + web_search response, replayable via
`discover-topics.js --mock fixtures/websearch-response.json`. This is what all
testing of the discovery stage should use — it costs nothing, versus a live
`daily-batch` dispatch which calls the paid API 6+ times per run regardless of
`dry_run` (see the COST NOTE at the top of `daily-batch.yml`).

## Turning a real run into a free fixture

`daily-batch.yml` has a `record` input, on by default and free — it's the same
API calls the run makes anyway, just also saved to a downloadable artifact
(`recorded-api-responses-<run-id>`, kept 30 days).

To add a new fixture from a real run:
1. Dispatch `daily-batch`, download the `recorded-api-responses-*` artifact
   from the run's summary page.
2. Look through `discover-<category>.json` / `generate-<n>-<category>.json` —
   pick one worth keeping (e.g. one that reproduces a bug, or a good example
   of a category that returned nothing).
3. Copy it into `fixtures/` under a descriptive name. If it stores a date,
   replace it with the literal string `__FRESH_DATE__` (see
   `websearch-response.json`) so the freshness gate doesn't start rejecting
   the fixture 30 days after it's committed.
4. Replay locally with `--mock` — zero further API cost, ever, for that case.

Recorded responses live in the workflow's artifact storage, never in git —
`.pipeline/` is gitignored specifically so a raw capture never lands in a
commit before someone has looked at it and decided it's worth keeping.
