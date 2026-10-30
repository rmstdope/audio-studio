# Content Studio

## The project

A local, graphical tool for producing a game's audio, starting with narration: casting a voice per
character by audition on Fish Audio, and recording every line of dialog with it. It runs from
inside a checked-out game repository (the _consumer_, first of all RetroQuest), reads that
repository's `content-studio.json`, and writes voice files and their metadata in place.

`docs/architecture.md` is the design: read it before changing how the tool works, and keep it up to
date in the same change when the design moves. Its delivery plan (§12) says what comes next.

## Work tracking

Planned work is tracked in beads (`bd`), prefix `as`; `skills/beads-workflow` carries the commands.
GitHub issues are the inbox for outside requests and bug reports only. Every bead is created
unranked and ranked later with the navigator; a bead is planned in one session and implemented in
another. `docs/architecture.md` §12 is the design's delivery plan; beads are the work queue, and a
bead that changes the design updates §12 with it.

The board syncs through the Dolt remote on `origin`, not through git. A fresh clone runs
`bd bootstrap` once (it refuses if a database already exists, so do not run `bd list` first); after
that it is `bd dolt pull` and `bd dolt push`.

## How we work

### Small increments

Work in very small steps, each one complete and useful on its own: a step leaves the tool working,
with its tests, docs and checks green. Prefer several small changes to one large one. If a step
grows, split it, and finish the part that is done.

### Test-driven

Write the test first, watch it fail, then write the code that makes it pass. This holds for bugs
too: first a test that reproduces the bug, then the fix. While hunting a bug, trace and experiment
freely; once it is pinned down, capture it in a test before fixing it.

- Every behaviour change comes with tests in a `*.test.ts` file next to the code (`bun test`).
- `src/core/` is pure, so most rules are tested there without disk, network or audio.
- `src/services/` and `src/server/` are tested against temporary repositories made with
  `test/helpers.ts` (`tempRepo`, `projectJson`), never against a real consumer.
- Calls to Fish Audio and Whisper go behind interfaces with fakes in tests; live tests are opt-in.

### Simple design

Prefer the simplest thing that works and is easy to change. Don't build for steps that have not
come yet. When a requirement is unclear, ask with the question tool (predefined answers, plus free
text when needed) instead of guessing.

## Layout

```
bin/content-studio.ts CLI: find the project file, start the server, open the browser
src/core/             pure logic: schemas, fingerprint, planner, text rules (no I/O)
src/services/         I/O: reading and writing the consumer's files, later Fish, Whisper, ffmpeg
src/server/           Bun.serve: JSON API and the UI
src/ui/               React app (TanStack Query), one stylesheet with design tokens
test/                 helpers and the sample project used by `bun run dev`
```

`core` decides, `services` does, `server` exposes, `ui` shows. `core` imports from none of the
others.

The UI is bundled for the browser: from `src/core` and `src/services` it may only use
`import type`, except for modules with no Node built-ins (no `node:crypto`, `node:fs`, …), or the
bundle breaks.

## Rules for the consumer repository

- Read and write only the files the project file names, through `resolveInRoot` and `writeAtomic`;
  nothing outside the project root. Clips are the one exception to `writeAtomic`: the encoder
  writes a hidden temporary file in the clips folder (through `resolveInRoot`), renamed into place
  only together with the manifest and lock update.
- Another exception, to reading and writing only the named files: the project's own
  `refreshDialog` command (the game's code, named in its project file) runs in the project root
  only when the user clicks Refresh dialog on a part's page or Refresh from the game on an act's
  Music or Images page, and so does `music.refreshShared` when the user clicks Refresh from the game on the
  Stingers page; each writes what the game writes.
  The studio runs nothing else of the consumer's.
- The project file itself is read, and changed in eight kinds of places only: the words that sound
  the same (`narration.quality.soundAlike`, and `narration.quality.soundAlikeByLanguage` for the
  other languages), saved from the Words that sound the same panel, `narration.models.draft` /
  `final`, moved from `s1` to `s2.1-pro` when the user confirms the retirement banner,
  `narration.models.audition` / `draft` / `final`, saved from the Models panel on Setup,
  `narration.elevenlabs.models.audition` / `draft` / `final` and `narration.elevenlabs.tts`,
  saved from that panel's ElevenLabs rows,
  `music.model`, saved from the Music row of the same panel,
  `images.model`, saved from the Images row of the same panel,
  `narration.quality.fishTier`, saved from the menu on Setup's Requests at once row, and
  `takeFade`, saved from the Playing takes panel on Setup. Each save
  writes the whole file again in its own indentation and line endings (a hand-compacted object is
  written out).
- Never run git commands that change the consumer (`add`, `commit`, `push`, `checkout`). The user
  commits; the studio at most reads `git status`.
- The game reads `manifest.json`: keep its format exactly. The studio's own state goes in the lock
  file and in `.content-studio/`.
- Write JSON with stable key order and small diffs (`formatEntriesPerLine` for the lock).
- Never delete clips without the user confirming it in the UI.
- Only changes from the studio's own page are accepted (the Origin check on POST routes).

## Commands

```sh
bun install
bun test               # all tests
bun run typecheck      # tsc --noEmit
bun run format         # prettier --write; format:check is what CI runs
bun run check          # format:check, typecheck and tests: run before every commit
bun run dev            # the studio on test/fixtures/sample, reloading on changes
content-studio --dev   # in a consumer repository, reloading on changes (after `bun link`)
```

## Code conventions

- TypeScript strict, no `any`: use precise types, `unknown` with narrowing, or zod.
- Validate every file read from the consumer with a zod schema in `src/core/`; report problems with
  their file and JSON path (`Problem`) instead of throwing.
- Every exported function, type and component has a `/** … */` doc comment saying what it is for.
- Prettier formats everything (`.prettierrc.json`); don't hand-format.
- Match the surrounding code: naming, comment density and idiom.
- UI copy is plain and specific; colours come from the tokens in `src/ui/styles.css`.

## Before every commit

`bun run check` passes (CI runs the same checks on every pull request and on `main`), new behaviour
has tests, and `docs/architecture.md` matches what was built. Work on a branch, not on `main`.

## Producer review

Nothing merges red. Before delivery, a producer obtains and addresses one independent, full review
of the complete diff and bead. If its changes are substantial enough to make another review useful,
the producer chooses the right follow-up scope and obtains it; minor, self-contained answers need
not create a review loop. Unresolved findings, a red or missing check, or a reviewer that cannot
produce a usable result go to a person. Whether the navigator also takes part in the plan, the
review or the merge is `navigator_gates` in `.cerebro/project.conf`; absent means none.

How the review is done here:

1. A fresh sub-agent reviews the whole diff of the pull request against `main`. Give it the pull
   request and this file, not your own conclusions, so its reading is not anchored on yours. Ask
   for correctness bugs first, then breaches of the rules in this file (tests, design, the consumer
   rules), then simplifications.
2. Address every finding: fix it (test first, as always), or answer it with why it stays as it is.
   No finding is left without an answer.
3. Report the findings and what was done with each in the pull request.
