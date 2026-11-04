# as-wbq: CI hung on "Install ffmpeg" again

**What happened.** The CI run on PR #265's head (run 41845331946) sat in "Install ffmpeg" for about
20 minutes while other runs that hour finished in about 90 seconds. `gh run cancel` did not stop it,
and with `cancel-in-progress` concurrency the run for the next head stayed `pending` behind it until
`POST …/actions/runs/<id>/force-cancel`. The run for the caught-up head then passed at once.

**Why.** Not established: an `apt-get update`/`install` hung on the runner.

**Cost.** About 25 minutes of waiting on one bug fix, and a cancelled run.

**Prevent by.** A `timeout-minutes` on the "Install ffmpeg" step or the job in
`.github/workflows/ci.yml`, as the earlier entries propose. Until then, a builder's CI wait should
compare the pending check's age with the usual run time, and use `force-cancel` when a plain cancel
does not take.

**Seen before.** as-zcw, as-nyx, as-0jl: the same step, hung the same way. This is the fourth time.
