# as-qqi.6

## What happened

CI failed once on `createMusicTakes > shows a take being made and the next waiting, in turn` (`src/services/musicTakes.test.ts:100`): take 1 was already `making` where the test expected the state of the first take to be seen as `making` and take 2 `waiting`, but the received states differed on the runner. It passed in 6 of 6 local runs and on one bare re-run, then failed again on the next push (a docs-only commit).

## Why

Not established. The test calls `make` and then `view` while the fake generator is already running on the queue, so what `view` sees depends on how far the queue got between the two calls.

## Cost

One bare re-run and one fix attempt, about 6 minutes in all.

## Prevent by

Done in this bead's last commit: the fake generator in that test waits on a promise the test releases after `view`, so the states are not a race with the queue. Tests that look at in-between states should gate the fake the same way.

## Seen before

Not seen before in `docs/retrospectives/`.
