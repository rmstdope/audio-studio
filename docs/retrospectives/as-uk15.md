# as-uk15

## CI hung at "Install ffmpeg"

**What happened**: Run 43053188359 sat `in_progress` for 39 minutes on the "Install ffmpeg" step (normal CI: about 4 minutes). A cancel and re-run hung on the same step for 18 more minutes. A force-cancel and a second re-run passed in 3m56s.

**Why**: Not established; the step is an apt install on the runner.

**Cost**: About an hour of waiting and both of the bead's re-runs.

**Prevent by**: A `timeout-minutes` on the CI job or the ffmpeg step, so a hang fails fast. Plain `gh run cancel` did not stop it; `gh api -X POST .../actions/runs/<id>/force-cancel` did.

**Seen before**: nothing like it yet.

## A UI test failed in the full run and passed alone

**What happened**: `PatchWorkbench.test.tsx` "the model of new takes > makes the takes with the model it is on" failed in two full `bun run check` runs and passed in a third full run and when run alone. The diff touched only two strings in `src/core`.

**Why**: Not established; probably timing under the full suite's load.

**Cost**: Two extra 90-second full runs.

**Prevent by**: Find what that test waits on and make it deterministic.

**Seen before**: nothing like it yet.
