# as-5gk.6: two rebases over busy main, a regex "keep both" dropped a closing brace again

**What happened.** Main moved three times while the PR was open (per-language casting, rate tier, spend log). Each time the append-only files conflicted (`src/server/index.test.ts`, `src/ui/styles.css`, `docs/architecture.md`). My "keep both sides" regex lost the closing `})` of the other side's last `describe`; `bun run check` caught it before the push, so only the check, not CI, went red. The stylesheet was resolved by taking main's file and re-appending my block, as the as-5gk.5 retrospective says, and that went right.

**Why.** Both sides ended the file with the same closing lines, so git paired them differently from what a regex on the conflict markers assumes.

**Cost.** One extra fix commit and a second force-push.

**Prevent by.** After a scripted conflict resolution in a test file, run `bun run check` (format first: prettier's syntax error names the line) before `git push`; for files both sides append to, take main's file and append your own block.

**Seen before.** as-5gk.5 (same cause, stylesheet).
