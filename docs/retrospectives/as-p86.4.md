# as-p86.4

## A takes test in `src/server/index.test.ts` failed once in a local full run

**What happened:** `server, a track's takes > makes and stops takes for a whole list from the studio's own page only` failed once in a local `bun run check` on a bead that touches only the Scenes UI. The file passed three runs alone and the next full run passed (3362 tests).

**Why:** not established. It looks timing-dependent under load, the same test as in as-23x.4.

**Cost:** two extra full-suite runs (about 1.5 minutes).

**Prevent by:** making that test wait on the job's own stop signal instead of elapsed time (`src/server/index.test.ts`).

**Seen before:** `docs/retrospectives/as-23x.4.md` (same test, in CI).
