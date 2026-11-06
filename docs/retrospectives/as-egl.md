# as-egl — retrospective

- **Implementer:** Bishop
- **Date:** 2026-11-06
- **PR:** #339

## Six Loudness panel tests failed on every branch from one day to the next

**What happened.** `bun run check` on this branch failed six tests in
`src/ui/features/scenes/ScenesView.test.tsx` (the Loudness panel and the loudness suggestion). They
expected "Measured today 14:02" and got "Measured yesterday 14:02". The branch did not touch
scenes. Main's last CI run, the evening before, was green.

**Why.** The fixture `measureOf` set `measuredAt` to a fixed `new Date(2026, 10, 5, 14, 2)`, and
`measuredWhen` in `src/ui/scenesText.ts` words a time relative to the real clock. The tests passed
only on the day they were written, so they failed for every branch from midnight on.

**Cost.** One full gate run plus tracing to show the failure was not this change's, and an
unrelated test commit carried in a bug-fix PR so it could go green.

**Prevent by.** A fixture time that is worded relative to now is built from today
(`todayAt1402()` in that file now). Better still, give `measuredWhen` and its callers an injected
`now`, so the tests pin the clock instead of reading it.

**Seen before.** None found.
