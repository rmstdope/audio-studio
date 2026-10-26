# as-77u: the review sub-agent left the producer's worktree on a detached HEAD

**What happened:** I gave the `reviewer` sub-agent the reviewed sha (75bccff) and the producer's worktree path. When it finished, the worktree's HEAD was detached at 75bccff: the reflog shows `checkout: moving from as-77u-… to 75bccff` between my two commits. My fix commit for the review went onto the detached HEAD. `git push` then pushed nothing, and the PR stayed on the old head while I polled it for mergeability.

**Why:** not established for certain. It is most likely that the reviewer checked out the reviewed sha to read and test the code, in the only tree it was pointed at.

**Cost:** one CI poll that watched the old head, and a manual `git branch -f` plus checkout to put the commit back on the PR branch. A producer that didn't notice `HEAD (no branch)` could merge the reviewed head without its review fixes.

**Prevent by:** `.cerebro/cerebro/agents/reviewer.md` (narrow mode) says the reviewer never runs `git checkout`/`switch` in the producer's tree, and reads the reviewed sha through `git show <sha>:<path>` or `gh pr diff`. Alternatively, the review loop in `produce-bead` adds a step that checks `git branch --show-current` after the sub-agent returns and before the first fix commit.

**Seen before:** no.
