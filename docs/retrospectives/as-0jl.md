# as-0jl: CI hung on "Install ffmpeg"

## What happened

The CI run on the PR head sat in "Install ffmpeg" for about 20 minutes (other runs finish in about a minute) and ended as a failure after `gh run cancel`. A re-run of the same head passed in 47s.

## Why

Not established; the step has no timeout, so a stalled package download blocks the run indefinitely.

## Cost

About 20 minutes of waiting, and one of the two bare re-runs. `gh run rerun` also refused until the cancelled run had finished.

## Prevent by

A `timeout-minutes` on the CI job or the ffmpeg step in `.github/workflows/ci.yml`.

## Seen before

Nothing like it yet.
