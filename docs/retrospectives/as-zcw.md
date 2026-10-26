# as-zcw — retrospective

- **Implementer:** Bishop
- **Date:** 2026-10-26
- **PR:** #100

## The real server answers 204 with no body inside a test file that registers happy-dom

**What happened.** To reproduce the character page's focus bug I started the studio with
`startServer` on a `tempRepo` and routed the page's `fetch` to it, in a `*.test.tsx` that calls
`GlobalRegistrator.register()`. Every request came back empty (`Unexpected end of JSON input`,
status 204); a small script showed Bun refusing the handler's answer: "Expected a Response object,
but received 'Response {…}'".
**Why.** `GlobalRegistrator.register()` replaces the global `Response` with happy-dom's, and the
server's handlers build their answers with the global `Response`, which Bun.serve no longer
accepts. The server and the DOM cannot share a test file.
**Cost.** About ten minutes, then the test was rewritten with a hand-made `ProjectSummary` and a
`fetch` stub by path.
**Prevent by.** A line in CLAUDE.md's _Test-driven_ list: UI tests that register happy-dom stub
`fetch` by path (as `SpeedEditor.test.tsx`, `CharacterView.test.tsx` do) and never start the server
in the same file.
**Seen before.** none found

## CI hung for eleven minutes in "Install ffmpeg"

**What happened.** The first run on PR #100 (run 40254647243) sat in the "Install ffmpeg" step for
over eleven minutes while main's runs took about a minute end to end. It was cancelled and a fresh
head (an update-branch) ran green in 43 s.
**Why.** not established (the step itself never finished).
**Cost.** About twelve minutes of CI wall-clock and a cancel.
**Prevent by.** A `timeout-minutes` on the "Install ffmpeg" step (or the job) in the CI workflow,
so a hung install fails within a few minutes and can be re-run instead of waited on.
**Seen before.** none found
