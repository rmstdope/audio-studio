# as-jkm2 — retrospective

- **Implementer:** Nightcrawler
- **Date:** 2026-11-13
- **PR:** #473

## A layout fix passed its test and failed verification, and the suggested repair would have changed nothing

**What happened.** #472 shrank the portrait stage on Patches. Its test added up heights measured once in Chrome and gave 751 against 757. Psylocke measured 770. Her report suggested raising the stage's 580 px budget by 20. Measuring the page (`getBoundingClientRect` in an iframe sized 1400×757, with fake images) showed why neither held. The right-hand tools column (286 px) was already taller than the stage column, so the stage's size did not decide where the takes strip started. The test also left out the model line under each thumbnail. My first replacement then passed by 1 px for a mark the reviewer found, and the review loop needed two more rounds.

**Why.** The test's arithmetic was built from one measured layout and one mark shape. Nothing checked which column was the taller one, or the thumbnails' parts, against the real page.

**Cost.** One failed verification and a P0 reopen, and two extra review rounds on #473.

**Prevent by.** For a fit-in-the-window bug, measure every box on the page's path (each column, and each part of a repeated item) in Chrome before choosing the fix, and write those measurements into the test comment. Test the extremes of the input (a whole-picture frame, a tall picture), not only the sample's case. A step in `.claude/skills/fix-bug` for layout bugs would carry this.

**Seen before.** as-p86.3 and as-uae (happy-dom tests passing a behaviour that only a browser showed wrong).

## Image services tests failed under a full run, a different one each time

**What happened.** `bun run check` failed once on `imagePatches.test.ts` › *times a finished patch take under the model's own key…*, and on the next run on `imageTakes.test.ts` › *adds the next take with its picture…* (`board.takes[1]` undefined). Both pass alone, and a third full run was green. This change touches neither file.

**Why.** Not established. Shared `globalThis` state in the image services, or load, is a guess.

**Cost.** Two extra full runs (~3 min each).

**Prevent by.** Not established; a bead to find the shared state is the navigator's call.

**Seen before.** as-kw3x.1 (flaky server tests).
