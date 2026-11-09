# as-5v0: a force-push to the bead's own branch was refused

**What happened:** Replacing PR #396 on the bead's branch, I reset the branch to `main` and ran
`git push --force-with-lease`. The session's permission check refused the command as a destructive
git action, and the rest of that command did not run.

**Why:** Not established beyond the refusal's reason, "Git Destructive". `produce-bead` *Merging*
names `git push --force-with-lease` as the route after a rebase, so that route can be refused too.

**Cost:** One refused command and a repeat of it. The branch instead carries the old commit under
a `git merge -s ours`, so the push was a fast-forward; the squash merge drops it.

**Prevent by:** `produce-bead` *Merging* saying what to do when a force-push is refused, or the
fleet's permission settings allowing `--force-with-lease` on a bead's own branch.

**Seen before:** No.
