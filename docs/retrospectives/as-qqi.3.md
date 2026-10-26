# as-qqi.3 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-10-26
- **PR:** #106

## A test that polled "nothing is being made" passed locally and failed in CI

**What happened.** `musicTakes.test.ts` "remembers what is being made across a reload" asserted a
take was still being made after `make()` returned. The fake generator finishes in a few
milliseconds, so on CI's slower runner the take was done before the check: 1 fail, CI red on a
head that was green locally. Looking into it, running the suite eight at a time reproduced a second,
real race: `view()` listed the take files, then read the in-memory making entries; a take finishing
between the two was in neither, so a page poll briefly showed one take fewer.
**Why.** The first was a test that depended on timing instead of holding the generator open; the
second, an order of reads that did not match the order of the writes (entry dropped after its
files are written, so entries must be read first).
**Cost.** One red CI run and one extra push. The second race had shipped to the reviewer and past
the local run.
**Prevent by.** A test of "still being made" holds the fake generator on a promise it releases
afterwards (as the fixed test does); a test of a view over files and in-memory state is run once
with several instances in parallel (`for i in 1..8; do bun test <file> & done`) before the PR.
**Seen before.** none found.

## A replace meant for one route landed on another

**What happened.** A scripted edit replaced the first `return file ? new Response(Bun.file(file)) :
notFound()` it found, which was narration's `/api/takes/:file`, not the new music route. Typecheck
passed; only the route test (a 5 s take served whole instead of an 8 s seam) showed it.
**Why.** The same line occurs in two routes; the replace was anchored on the line, not on the
route.
**Cost.** A few minutes and a revert of the narration route.
**Prevent by.** Anchor a scripted edit on the route's own path string, and read `git diff` of the
file before committing.
**Seen before.** none found.
