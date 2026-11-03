# as-5wc.5 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-11-03
- **PR:** #238

## Image take tests timed out in CI, green locally, green on a bare re-run

**What happened.** After rebasing onto main, CI failed four tests in `imageTakes.test.ts` and
`images.test.ts` with "takes never finished" (the `settled` helper gives a take one second). The same
head passed three full local runs, and passed on a re-run of the failed job. The change touched
`makeImageTake` (it now runs inside `holdGpu`), so it could not be ruled out by reading alone.
**Why.** Not established; the helper's one-second budget against a slower runner is the likeliest cause.
**Cost.** One of the two re-runs, and about ten minutes of waiting and reading logs.
**Prevent by.** Not established; if it comes back, the `settled` helpers in `src/services/imageTakes.test.ts`
and `images.test.ts` are the place to look.
**Seen before.** Nothing like it in `docs/retrospectives/`.
