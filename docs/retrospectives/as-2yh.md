# as-2yh — retrospective

## decodeClip timed out in the fast gate while other sessions loaded the machine

**What happened:** The second `bun run check` in this bead's worktree took 79 s instead of 15 s, and
`src/services/audio.test.ts` › *decodeClip › decodes a clip to WAV at its own rate…* failed after
59.7 s, with bun reporting "killed 1 dangling process". The same file passed alone in 1.1 s, and
a full re-run passed.

**Why:** Not established. The likeliest cause is ffmpeg running slowly while other fleet sessions
ran their own gates on the same machine, which pushed the test past its timeout.

**Cost:** A re-run of the suite and a check of the failure, about two minutes. A producer that
believed the red result would have spent a fix attempt on code it never touched.

**Prevent by:** In `src/services/audio.test.ts`, find what decodeClip waits on for 60 s (the
ffmpeg child or the test timeout), and make the failure say that it timed out rather than give a
bare failure.

**Seen before:** No.

## A piped gate let a red commit through

**What happened:** `bun run check 2>&1 | tail -4 && git commit … && git push` committed and pushed
a head that failed `tsc`, because the pipeline's status is `tail`'s.

**Why:** No `pipefail` in the agent's shell.

**Cost:** One extra commit and push, and a CI run on a red head.

**Prevent by:** In `produce-bead` *Building*, write the fast gate's output to a file and test its
exit status (`bun run check > log; echo $?`), never through a pipe chained with `&&`.

**Seen before:** No.
