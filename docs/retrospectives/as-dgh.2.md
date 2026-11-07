# as-dgh.2

## A music test failed once in CI, on a diff that does not touch music

**What happened:** CI on head `942b82b` failed one test, `the summary of a press on a list is kept by the studio > goes on while takes are started by hand during the press, and a new press replaces it` (`src/services/musicTakes.test.ts`). The same suite passed three times in a row locally, and the failed job passed on a bare re-run.

**Why:** not established. The test waits on timing of takes being made; it ran in the last seconds of a 74 s run.

**Cost:** one bare re-run (of the two allowed) and about two minutes.

**Prevent by:** not established; a look at that test's waits (`src/services/musicTakes.test.ts`) for a fixed sleep rather than a condition.

**Seen before:** nothing like it yet.

## Merge conflict with the sibling bead

**What happened:** while the PR was open, as-dgh.1 (trim, same files) merged; the PR went `DIRTY` and a rebase conflicted on every commit, so I merged `origin/main` once instead.

**Why:** both beads were planned in parallel against the same effect take code, and the plan named the sibling as out of scope rather than as a file overlap.

**Cost:** about a third of the pass.

**Prevent by:** a plan for a bead with a sibling in the same files saying which one lands first.

**Seen before:** nothing like it yet.
