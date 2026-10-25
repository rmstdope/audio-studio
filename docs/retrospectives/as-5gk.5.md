# as-5gk.5: a rebase conflict resolved by "keep both" pushed broken CSS

**What happened.** Main moved twice while the PR was open. Resolving conflicts in append-only files (test fakes, stylesheet) by keeping both sides worked for the tests but, in `src/ui/styles.css`, both sides had appended inside the same `@media` block's tail, so the merged file lost a closing brace. I pushed before running `bun run check` on the result.

**Why.** The resolution was scripted and the push followed the rebase in one command chain.

**Cost.** One force-push of a stylesheet that did not parse (fixed in the next commit), plus a second rebase.

**Prevent by.** After any scripted conflict resolution, run `bun run check` before `git push`; for stylesheets take main's file and append your own block.

**Seen before.** Nothing like it yet.
