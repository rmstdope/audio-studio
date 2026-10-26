# as-qqi.6

## What happened

CI failed once on `createMusicTakes > shows a take being made and the next waiting, in turn` (`src/services/musicTakes.test.ts:100`): take 1 was already `making` where the test expected the state of the first take to be seen as `making` and take 2 `waiting`, but the received states differed on the runner. It passed in 6 of 6 local runs and on a bare re-run of the same head.

## Why

Not established. The test calls `make` and then `view` while the fake generator is already running on the queue, so what `view` sees depends on how far the queue got between the two calls.

## Cost

One bare CI re-run (about 2 minutes) of the bead's budget.

## Prevent by

Making the fake generator in that test wait on a promise the test releases after `view`, so the states are not a race with the queue.

## Seen before

Not seen before in `docs/retrospectives/`.
