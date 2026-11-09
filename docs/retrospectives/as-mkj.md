# as-mkj

## A bugfixer started with no bead in its prompt, over an earlier session's unfinished work

**What happened:** Bishop's starting prompt named no bead, for which `produce-bead` step 1 says to
run `end-pass` and stop. The board showed as-mkj `in_progress` and assigned to Bishop, with its
worktree prepared and holding an uncommitted fix, tests and docs from about half an hour earlier.
No notes and no state file said what had happened. Bishop took the claim as the bead rather than
stopping, and proved the leftover work red and green before building on it.

**Why:** Not established. The earlier session ended before committing, and the restart did not pass
the claimed bead into the prompt.

**Cost:** A few minutes. Following the rule as written would have left the claim held and the work
stranded in the tree.

**Prevent by:** `produce-bead` step 1: with no bead in the prompt, look for a bead `in_progress` and
assigned to the session's name before ending the pass; or have the launcher name the claimed bead.

**Seen before:** No.
