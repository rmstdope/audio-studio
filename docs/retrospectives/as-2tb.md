# as-2tb: the spending-record server tests failed once in CI

**What happened.** CI failed on four tests in `server, the spending record` (`src/server/index.test.ts`; one timed out at 5000 ms, the others expected a job `state: 'error'`) on a UI-only diff. The suite passed locally twice and failed once in three runs of the file alone; a bare re-run of the failed job passed.

**Why.** Not established. The failure reproduces without my change, so it is a timing race in the tests or the job runner they start.

**Cost.** About three minutes of CI wait, one of the bead's two bare re-runs, and a local reproduction.

**Prevent by.** Find the race in the spending-record tests (they poll a running job's state) and wait on the job's end instead of a fixed time.

**Seen before.** Nothing like it yet.
