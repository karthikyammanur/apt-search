Tests for the intake pipeline and listing channels. Owned by step 5.

All tests use an in-memory migrated database, a stub model that returns canned replies, stub map services that count their calls, and the fixtures in `tests/fixtures/intake/`. Nothing touches the network. See `helpers.ts`.

| File | Covers |
| --- | --- |
| `pipeline.test.ts` | The six fixtures end to end; provenance on every fact; a clear Fail skips enrichment; duplicates merge; roommate leads; paste; model and provider failures |
| `extract.test.ts` | Prompt delimiters, grounding of numbers, evidence for dealbreaker claims, sanity ranges, injected instructions |
| `llm.test.ts` | Provider chain from keys, 429 and 5xx fallback, repair retry, remote images refused |
| `trust.test.ts` | Red-flag rules and the price check, each Pass, Fail or Unknown |
| `dedupe.test.ts` | Address normalization, the 5 percent rent line, photo hashes |
| `email.test.ts` | Sender recognition and splitting of the three alert emails |
| `capture.test.ts` | Token and shape checks on the capture endpoint |
| `channels.test.ts` | Adapters and the runner; no email link is ever requested |
| `enrich.test.ts` | Arrival time, walking estimates, stop and place enrichment |
