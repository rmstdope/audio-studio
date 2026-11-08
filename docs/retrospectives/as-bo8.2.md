# as-bo8.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-11-08
- **PR:** #370

## CI failed on a narration test the PR does not touch

**What happened.** `createLineWorker > says what it was told to, not its log, when the system kills it` (`src/services/lineWorker.test.ts:46`) failed in CI with `Received message: "EPIPE: broken pipe, write"` instead of `The system stopped it.`. The file passed three times in a row locally; a re-run of the failed job on the same head went green.
**Why.** Not established; the worker's child process seems to close its pipe before the test's write on a slow runner.
**Cost.** One bare re-run (of the budget of two) and about four minutes of waiting.
**Prevent by.** Making the test wait for the child to be listening before it writes, or catching `EPIPE` in the worker's `request` and reporting the kill message; neither is this bead's.
**Seen before.** none found.
