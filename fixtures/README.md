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
