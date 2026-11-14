# as-uucl.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-11-14
- **PR:** #521

## CI failed in `src/server/spending.test.ts` on a UI-only change, green locally

**What happened.** The first CI run on the review-fix head failed four tests of "server, the spending record" (one a 5000 ms timeout). The diff touches no server file; `bun run check` had passed locally (5125 pass) and `bun test src/server/spending.test.ts` passed alone (10 pass). One re-run of the failed job went green.
**Why.** Not established; the timeouts suggest load on the CI runner.
**Cost.** One bare re-run (about 5 minutes of wall-clock).
**Prevent by.** Not established; if it recurs, give those tests a look for timing sensitivity (`src/server/spending.test.ts`).
**Seen before.** `docs/retrospectives/as-77u.md` and `as-2tb.md` mention the same suite name; not checked whether it is the same failure.
