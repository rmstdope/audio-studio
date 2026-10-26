# as-qqi.4

## What happened

The CI run on the pull request stayed `in_progress` (check "pending") for 11 minutes; runs on this repository normally take about a minute. `gh run rerun` refused while it was running; `gh run cancel` then `gh run rerun` made a run that passed in 1m27s.

## Why

Not established.

## Cost

About 12 minutes of waiting and one of the two allowed bare re-runs.

## Prevent by

A step in the producer's CI wait: when a run is `in_progress` for more than ~5 minutes while recent runs take about 1 (`gh run list`), cancel and re-run it instead of polling on.

## Seen before

Nothing like it yet.
