# as-yr5 — retrospective

- **Implementer:** Nightcrawler
- **Date:** 2026-10-27
- **PR:** #177

## A fix passed review and failed verification on the one page its tests did not render

**What happened.** The first fix (PR #174) de-duplicated the part's banner and was proven by a
test of the filtering rule alone. Its reviewer noted that no test rendered the pages, and the
answer kept it that way ("a page-level harness belongs in its own bead"). Psylocke then found the
same cast problem still shown twice on All lines, from a third banner (Generation cannot be
planned) that a page-level test would have counted.
**Why.** The acceptance was about what a page shows ("each problem appears once on a part's
page"), and the reproduction test asserted on a helper's output instead of on the page's text,
so a banner outside the helper was invisible to it.
**Cost.** A failed verification, a reopened P0 bead, a second bugfix pass and PR.
**Prevent by.** In `fix-bug` step 2 (*Reproduce with a test*): when the bead's acceptance is about
what a page shows, the reproduction test renders that page and asserts on its text.
`src/ui/features/lines/LinesView.test.tsx` shows it can be done here: it runs the real studio on
the sample in the same file and counts the message on the page.
**Seen before.** none found

## The real server in a happy-dom test file, again, and a way to keep it

**What happened.** The page test above started `startServer` in a `*.test.tsx` that registers
happy-dom, and every answer came back empty (`Unexpected end of JSON input`; Bun: "Expected a
Response object").
**Why.** As as-zcw found: `GlobalRegistrator.register()` replaces the global `Response`, which the
server's handlers then build their answers with. Saving `Request`, `Response` and `Headers` before
`register()` and putting them back right after (`Object.assign(globalThis, { Request, Response,
Headers })`) lets the server and the DOM share the file; React renders fine with Bun's classes.
**Cost.** About five minutes.
**Prevent by.** Amend the as-zcw prevention: UI tests that need the real server keep Bun's fetch
classes as `LinesView.test.tsx` does, rather than never starting the server in the same file.
**Seen before.** as-zcw
