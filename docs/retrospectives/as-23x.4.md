# as-23x.4: a music server test failed once in CI

## What happened

CI failed on `server, a track’s takes > makes and stops takes for a whole list from the studio’s own page only` (`src/server/index.test.ts`, expected `{ takes: 4, tracks: 1 }`, got `{ takes: 0, tracks: 0 }`). The bead touched only sound effects. The same test and the whole file passed locally, three runs in a row. A bare re-run of the same head passed.

## Why

Not established. The answer was empty, as if the track had no takes to count yet or already had them made.

## Cost

One CI cycle (about 3 minutes) and one of the two bare re-runs.

## Prevent by

Not established; the test's make/count race on the music server needs reading by whoever owns it.

## Seen before

Nothing like it yet.
