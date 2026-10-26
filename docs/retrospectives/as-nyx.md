# as-nyx

## CI hung on "Install ffmpeg"

**What happened:** the check on PR #112 sat `pending` for 28 minutes at the "Install ffmpeg" step; other runs finish in under two minutes. Cancelling it and re-running the same run passed in 49 s.

**Why:** not established (a hung package download on the runner).

**Cost:** about 28 minutes of waiting, and one of the two bare re-runs.

**Prevent by:** a `timeout-minutes` on the workflow job, so a hung step fails in minutes, not at GitHub's six-hour default; compare a pending check's age with the usual run time before waiting on it.

**Seen before:** nothing like it yet.
