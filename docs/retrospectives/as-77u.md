# as-77u: the review sub-agent left the producer's worktree on a detached HEAD

**What happened:** I gave the `reviewer` sub-agent the reviewed sha (75bccff) and the producer's worktree path. When it finished, the worktree's HEAD was detached at 75bccff: the reflog shows `checkout: moving from as-77u-… to 75bccff` between my two commits. My fix commit for the review went onto the detached HEAD. `git push` then pushed nothing, and the PR stayed on the old head while I polled it for mergeability.

**Why:** not established for certain. It is most likely that the reviewer checked out the reviewed sha to read and test the code, in the only tree it was pointed at.

**Cost:** one CI poll that watched the old head, and a manual `git branch -f` plus checkout to put the commit back on the PR branch. A producer that didn't notice `HEAD (no branch)` could merge the reviewed head without its review fixes.

**Prevent by:** `.cerebro/cerebro/agents/reviewer.md` (narrow mode) says the reviewer never runs `git checkout`/`switch` in the producer's tree, and reads the reviewed sha through `git show <sha>:<path>` or `gh pr diff`. Alternatively, the review loop in `produce-bead` adds a step that checks `git branch --show-current` after the sub-agent returns and before the first fix commit.

**Seen before:** no.

## The spending-record server tests failed in CI again (second pass, PR #146)

**What happened:** CI failed on four tests in `server, the spending record` (`src/server/index.test.ts`: two expected `state: 'error'`, one threw `waited in vain` at its 2 s poll, one timed out at 5000 ms) on a UI-only diff. Five local runs of that describe alone and the full `bun run check` passed; main was green on the same base. A bare re-run of the failed job passed.

**Why:** not established; the same timing race as as-2tb, still unfixed.

**Cost:** about three minutes of CI wait, one of the bead's two bare re-runs, and five local runs.

**Prevent by:** the same as as-2tb: make the spending-record tests wait on the job's end rather than a 2 s deadline. A second sighting says it is worth a Testing bead.

**Seen before:** as-2tb.
