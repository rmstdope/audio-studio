---
name: verify-audio-studio
description: Audio Studio's verification skill, named by `verification_skill` in .cerebro/project.conf. Psylocke verifies merged beads that change what a user sees or hears by running the studio on the sample project in Chrome. She batches related beads into one look, builds the project state each look needs in the verification tree's own fixture, never spends Fish credit without the navigator's yes, checks that the studio only wrote what the consumer rules allow, does the checks herself, hands the navigator the running studio for anything only a person can judge (how a voice or a take sounds, "good enough"), explores near the change, then presents the evidence, a recommended pass or fail per bead, and proposed follow-up beads.
---

# Verifying Audio Studio beads

This skill **extends `verify-bead`; it does not replace it.** Load `verify-bead` first and follow it,
together with `agents/verifier.md`. That covers the candidates, the fresh `origin/main` worktree, the
commit check, `verification=pending`, the port refusal, the sha in every verdict, the report written
onto the bead before asking, the recipes in *Taking the verdict*, and the end of a pass. Where this
file is more specific, this file wins. It adds seven things: batching, building a project state, a
fallback port, protecting the navigator's money and their real repositories, checking what the studio wrote, human
checks, and exploratory testing.

Every question below is the verifier's three-action sandwich: `asking --bead <id> --phase verify`,
the question, then `working --bead <id> --phase verify` before anything else. In a batch, `--bead`
is the first bead of the batch.

Below, **the tree** is the verification worktree, `.cerebro/worktrees/psylocke`, and **the sample**
is its `test/fixtures/sample/`, the project the declared launch opens.

## Which beads are looked at

The verifier's classification decides: `app-paths --classify` says `application` for anything under
`src/` or `bin/`. Everything it calls `invisible` is marked `not-needed` silently, as the verifier
says. Never widen or narrow that by judgement. If you think a classified bead changes nothing a user
can notice (a test-only change under `src/`, a refactor of `src/core/`), still look briefly at the
surface it feeds, and say in the report that the look found nothing visible to check.

## Batch beads into one look

Starting the studio and building the sample's state is the expensive part, so share it. After the
candidate lists are built, and after the epic sweeps (which batch themselves through
`verifier-epic-candidates`), group the ordinary candidates:

- **Batch together** beads that are all in the tree at the same `origin/main` sha and share a
  journey: the same page (Setup, a part's lines, a character page, the audition board, Words that
  sound the same), the same workflow (casting, recording a part, taking a line again), or the same
  sample state to build (the same languages, models or cast).
- **Keep apart** a bead whose look needs a sample state that would spoil the others' (a broken
  project file, no API key, `s1` models, a fresh cast with nothing recorded). Keep a reopened
  `verification:failed` bead apart too: its rebuild deserves its own clean look.
- **At most four beads per batch.** The question tool takes four questions per call, and the verdict
  call asks one per bead.

Say each batch and its reason in one line before launching, for example "batch A: as-170.1,
as-170.2, both the per-language pages, one run at `<short sha>`". Then, per batch:

1. Prepare every bead (verify-bead's *Prepare*): one checklist per bead, criterion by criterion.
   Mark each step that would call Fish, and whether it is free or paid (*Fish credit*, below).
2. Build the sample state the batch needs (below), then launch once (verify-bead's *Launch*), on the
   declared port, or the next free one (*When the declared port is taken*).
3. Walk the beads in the order that builds the states most cheaply, keeping a separate evidence log
   per bead. A screenshot can serve two beads, but name it in both logs.
4. Check what the studio wrote (below), once for the batch.
5. Collect every human check in the batch into **one** hand-off (below).
6. Explore once for the whole batch (below).
7. Write **one report per bead** onto that bead (`Verification report at <full sha>`, as
   verify-bead says), then ask for the batch's verdicts in **one** call of the question tool, one
   question per bead.

A batch never merges verdicts: each bead passes or fails on its own evidence. If the navigator's
answers split a batch, record each bead by its own recipe.

## Building the sample state

The declared launch serves the sample with the merged build, without reloading (`launch_web` in
`.cerebro/project.conf`, no `--dev`). The sample is small on purpose: two parts (`act1`, `act2`),
three languages (`en`, `sv`, `de`), dialog for `act1` in `en` and `sv` only, a narrator and a
keeper in the cast, and a line by `wren`, who is not in the cast. Nothing is recorded, and there is
no `cues.json`, lock, manifest or `.audio-studio/` until the studio writes them.

To reach the state a bead needs, **edit the sample in the tree, before launching**, by hand and
only there:

- the project file: `narration.languages`, `parts`, `models` (`s1` for the retirement banner, a paid
  model for a paid flow), `quality` (`parallel`, `transcriber: none` to skip Whisper), `soundAlike`;
- `tts/cast.json`: a speaker added, cast or left uncast, a style, `pronounce` entries;
- a part's `script.json`: a line added, changed (to make a recorded clip stale) or removed (to make
  an orphan clip);
- a broken file, to see the error page that names the file and the JSON path.

A state the studio itself builds (cues, recorded clips, an audition in progress) is built **through
the studio**, as a user would, and that walk is part of the evidence. Getting the dialog of a part
through **Refresh dialog** needs a `refreshDialog` command; the sample has none, so a bead about
Refresh is looked at by adding a harmless one to the sample's project file (`true`, or a
command that writes only inside the sample), never by pointing the studio at a game.

Edits to the sample are part of the evidence: list each one in the report. The edited sample is
never committed. **Never commit in the tree**, and never edit anything in it but the sample.

**Never point the studio at a real consumer** (RetroQuest or any game on this machine), even when the
sample cannot show what the bead changed: the studio writes into the repository it opens, and the
navigator's casting and clips are not test data. A state the sample cannot be edited into is a gap,
and a question to the navigator if it decides the verdict.

## When the declared port is taken

This replaces the verifier's port refusal for this project, as the navigator asked: **an occupied
port is not a question.** The studio takes any port (`--port`), and something on 4317 is usually
the navigator's own studio, which stays untouched.

1. Check the declared port (`project-conf launch_web_port`, 4317) as the verifier says:
   `lsof -nP -iTCP:4317 -sTCP:LISTEN`.
2. If it is taken, check 4318, 4319 and so on up to 4326, and take the first that is free.
3. Run the declared `launch_web` command exactly as declared, with only its `--port` value changed
   to that port, and open `http://localhost:<that port>` in Chrome.
4. Say in one line which port you used and why ("4317 is taken by pid 41210; the studio runs on
   4318"), and put the same line in each report.

Never stop, kill or reuse whatever holds a port, and never verify against a studio you did not
start. If all ten ports are taken, that is a blocker, and a question to the navigator as verify-bead
says.

## Fish credit, the API key and the navigator's money

Most journeys worth looking at call Fish Audio: the voice library, auditions, takes, recording a
part, the credit on Setup. The key comes from the environment, or from the sample's `.env`
(`test/fixtures/sample/.env`, ignored by git).

- **No key** is an ordinary state: the Setup page says so, and every Fish journey shows its no-key
  message. Look at that, then, if any criterion needs Fish, ask the navigator once per pass whether
  to provide one: they put it in the sample's `.env` in the tree themselves, or export it before
  you launch. **Never read, print, copy or log the key**, never take it from another repository's
  `.env`, and never put it in a report or a screenshot.
- **The free model costs nothing**: `s2.1-pro-free` (the sample's default for every stage) and
  everything the studio labels "free model". With a key, free calls are yours to make.
- **Anything that spends credit is the navigator's.** Never press **Pay up to $X**, record on a paid
  model, start a paid audition, clone or design a voice, or confirm any cost the studio shows,
  without a yes to that exact amount in the question tool. Drive the journey up to the confirmation
  yourself and screenshot it: the amount, the credit beside it and the Cancel are evidence too. Then
  either ask ("as-5gk.1 needs one paid audition: Pay up to $0.05 on s2.1-pro. Pay it?"), or press
  Cancel and record the paid half as a gap.
- **Keep `quality.parallel` at or below the sample's**, and run one recording job at a time: other
  work may share the key, and a 429 storm is a finding only when the bead touched the limiter.

When the look is over, delete any `.env` the navigator put in the sample, and say in the report that
it was removed.

## The look, for Audio Studio

On top of verify-bead's *Look*, check what the acceptance touches:

- **The mockup.** A bead agreed with a mockup names it in its acceptance. It is committed under
  `docs/ui/` (`docs/ui/<bead>-<slug>.html`). Open it from the tree in a second tab
  (`file://<absolute path of the tree>/docs/ui/<file>.html`), compare it with the studio side by
  side, and screenshot both.
- **Wide and narrow.** The studio is a desktop tool, but its layout changes below 900, 720, 640 and
  600 pixels. Look at a wide window first, then resize to about 600×900 and look again. A bead that
  changes a page's layout, a table, a dialog or long text always gets both. Phone width is only
  looked at when the acceptance names it.
- **The theme.** The studio has one, light, theme, with colours from the tokens in
  `src/ui/styles.css`. A colour that is not one of the tokens is a finding when the bead introduced
  it.
- **Live progress.** A job (recording a part, an audition) reports over a WebSocket. Watch it run,
  reload the page mid-job and confirm the progress comes back, and note what the page says when the
  job ends or fails.
- **What persists.** When the bead adds or changes state the studio keeps (a cast voice, cues,
  takes, a sound-alike word, an audition), reload the page, then stop and relaunch the server, and
  confirm it came back from the files rather than from the browser.
- **The words.** UI copy the bead changes is plain and specific (`CLAUDE.md`, *Code conventions*).
  Quote the line in the log next to the screenshot. Jargon, a vague error or a message that names no
  file or fix is a finding; whether a line reads *well* is a human check.
- **The consoles.** Read the browser console after the journey (filtered by a pattern, not dumped
  whole), and the server's own output from the launch. A new error or warning during the journey is
  a finding.

## Check what the studio wrote

The consumer rules in `CLAUDE.md` are what makes the studio safe to run inside a game, and a look is
the one place they are seen on real files. After the journey, once per batch:

```bash
git -C .cerebro/worktrees/psylocke status --porcelain --ignored
git -C .cerebro/worktrees/psylocke diff -- test/fixtures/sample
```

Subtract your own edits to the sample, then check:

- **Only the sample changed**, and inside it only files the project file names (cast, dialog, cues,
  lock, clips, manifest, per part and language), `.audio-studio/`, and the project file itself.
  Anything else, anywhere in the tree, is a finding against the bead whose journey wrote it.
- **The project file** changed only in `narration.quality.soundAlike`, or in
  `narration.models.draft` / `final` moved from `s1` to `s2.1-pro` after the banner was confirmed,
  and kept its indentation and line endings.
- **A manifest** keeps the game's format: open one and compare its shape with
  `docs/architecture.md` §6. The lock is written one entry per line, in stable key order.
- **No clip was deleted** without the confirmation in the UI, and no hidden temporary file is left
  in a clips folder after the job ended.
- **Nothing ran git** in the sample beyond reading `git status`.

A breach of these rules counts against the bead's verdict even when every acceptance line passed:
the rules are part of what was agreed for every bead.

## Human checks: hand the navigator the running studio

Some criteria have no screenshot that settles them. They go to the navigator, and you prepare
everything first so their part takes a minute:

- **Audio**: a take, a recorded line or an audition candidate plays, in the right voice, says the
  right line, sounds clean, follows the cue and the pronunciation, and its word timings match. You
  can show *that* it played (the request in the network log, the player's time moving, the duration
  in the manifest) and what Whisper heard. Whether it sounds right is theirs to judge.
- **"Good enough"**: whether copy reads well, whether a layout or a board feels right, whether a
  warning lands when it should.
- **Spending**: every paid step, asked as *Fish credit* says.
- **Anything you could not reach**: a state the sample cannot be edited into, a paid account, a
  Fish answer only a real account gives (a rate tier, an own voice).

The hand-off, once per batch, after your own checks and before the verdict:

1. Leave the server running and the studio **in the exact state** to judge, in a tab you name, with
   the clip or take to listen to on screen.
2. Write `asking`, then ask in **one** call of the question tool, one question per human check
   (at most four, so split a long list into more calls). Each question says:
   - the URL and tab, and what is on screen right now;
   - what to listen for or judge, in the user's terms, and what good looks like, quoting the
     acceptance or `## Outcome`;
   - optionally, a few numbered steps to try ("press Play on a3; listen for 'slow tide' at the end").

   Options: **Good**, **Concern** (works, but worth a follow-up), **Fail** (does not meet what was
   agreed), each with room for a note.
3. Write `working` the instant they answer. Copy each answer and note into the bead's log verbatim,
   attributed to the navigator. A human check left unanswered is a gap, not a pass.

If they are away, the beads stay pending with the report attached, as verify-bead says. The next
pass re-asks from the report without looking again.

## Explore near the change

After the agreed criteria and before the report, spend **about 10–15 minutes per batch** using the
studio near what changed, as a curious user would. No script; aim at the change's edges:

- the empty states: no key, no ffmpeg on the path (if the bead touched Setup), a part with no
  dialog, a language with no dialog, a speaker not in the cast (`wren`), nothing recorded yet;
- the neighbouring pages and the same thing reached another way (the sidebar, a deep link, the
  browser's back button);
- doing things in the wrong order, twice, or undoing them: cast then recast, cancel a job midway,
  record again after a line's text changed, a sound-alike word added and removed;
- reloading or opening a second tab mid-job, and stopping and relaunching the server between steps;
- a project file or resource broken by hand, and fixed again, with the page open;
- long lines and names wrapping, the narrow window, and the keyboard-only path.

Log each finding with steps, what appeared and a screenshot. Then sort it:

- **A regression this batch caused** (it worked before this bead's commit, and the bead's diff
  explains the break), or a breach of the consumer rules, counts against that bead's verdict. Say
  which criterion, outcome or rule it breaks.
- **Everything else** (an older defect, a rough edge, an idea) is a proposed follow-up and never
  fails the bead.

When unsure which it is, say so in the report and recommend the follow-up.

## Present the results

The report on each bead follows verify-bead's *Recommend*, with these sections:

- `Verification report at <full sha>`, then the bead's title and its batch;
- the **sample state**: each edit you made to the sample, and whether a key was present;
- the evidence log, one entry per criterion, with the human checks marked as the navigator's
  answers;
- **What the studio wrote**: the files it changed, and whether the consumer rules held;
- **Exploration**: what you tried, and each finding with its sorting;
- the **gaps**: what nobody could reach, paid steps not taken among them;
- the **recommendation**: Passed, Passed with a follow-up, or Failed (build or plan), with the one
  or two facts it turns on;
- the **proposed follow-ups**: for each, a title in *Writing a good bead* form, the outcome for the
  user (or the developer), one acceptance line, and why it is not a defect in this bead. A defect in
  shipped behaviour is proposed as a bug (`--type bug --labels bugfix`), anything else as a task.
  Both are filed at P4, unranked, and only when the navigator approves them.

Then in chat, before the verdict question, give the navigator a short summary per batch: one line per
bead with the recommendation, then the follow-ups. The full evidence is on the beads. Ask for the
verdicts and the follow-ups in one call where they fit in four questions, and in consecutive calls
where they do not. Record only what they answered, by the recipes in `agents/verifier.md`.

## When the look is over

Stop the server you started, and only that one. Then put the sample back and remove what the studio
and you added, so the next look starts from the committed sample:

```bash
git -C .cerebro/worktrees/psylocke checkout -- test/fixtures/sample
git -C .cerebro/worktrees/psylocke clean -fdx -- test/fixtures/sample   # also the .env and .audio-studio/
git -C .cerebro/worktrees/psylocke status --porcelain                   # nothing
```

Close the tabs you opened, and say in the report that the sample was restored and any key removed.
