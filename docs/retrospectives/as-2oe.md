# as-2oe: a CI job kept reading pending after its run had finished

**What happened:** After I pushed the review fix (a82c461), `gh pr checks 275` showed "Format, typecheck and test" as `pending`, 0 s, for ten minutes, and my wait loop on it ran out its 590 s timeout. `gh run view` gave the same run as `completed` / `success`, while its one job said `in_progress` with no completion time. The PR's `mergeable` and `mergeStateStatus` were both `UNKNOWN`. Updating the branch (`update-branch`, needed anyway since main had moved) started a new run, which passed in about two minutes.

**Why:** not established. GitHub reported the run and its job in two states that cannot both be true.

**Cost:** about eleven minutes, one wasted wait call, and an investigation.

**Prevent by:** in `produce-bead` _Waiting, without ending your run_, wait on the run for the PR's head sha (`gh run list --branch <b> --json headSha,status,conclusion`), not on `gh pr checks`. When `gh pr checks` still says pending but that run has finished, take the run's verdict, or push an `update-branch` to get a fresh run.

**Seen before:** no.

## A local gate run failed once and could not be traced

**What happened:** One `bun run check` after the review fix exited 1. Its summary was 3383 pass, 0 fail and 11561 expect() calls, against 11567 in the green runs. I had piped it through `tail -3`, so the failing test's name was lost. Three later runs passed.

**Why:** not established. It may be the timing race already recorded in as-2tb and as-77u.

**Cost:** two extra gate runs. The `tail` also hid the exit code from the `&&` chain, so the commit and push went ahead.

**Prevent by:** run the gate to a log file and test its exit code before chaining a commit on it (`bun run check > log 2>&1 || { grep '(fail)' log; false; }`), never `| tail`.

**Seen before:** perhaps as-2tb and as-77u (the server tests' timing race), unconfirmed.
