# Content Studio — Architecture

Content Studio is a local, graphical tool for producing a game's audio. It is started from inside a
checked-out game repository (the _consumer_), reads that repository's project file, and writes
voice files and their metadata **in place**. Committing and pushing is left to the user.

The first workspace is **Narration**: casting a voice for every character by audition, and
recording every line of dialog with the cast voice, regenerating only what is missing or out of
date. The second is **Music** (§8.5, planned): looping background tracks and short stingers, each
chosen by audition from takes generated locally with ACE-Step. Sound effects are a later workspace
on the same foundation (§12 step 16).

The first consumer is RetroQuest, whose current Python tooling (`tts/fish_tts.py`,
`tts/narrate.py`) this tool replaces.

---

## 1. Goals and non-goals

**Goals**

- One command, run from the consumer repo root, opens the studio: `content-studio`.
- Everything the tool needs to know about the game is in one project file in the consumer repo.
- Work on one _part_ (RetroQuest: an act) at a time.
- A character is identified by its name across the whole project: the same name in different
  parts is the same character with the same voice. Different voices need different names
  (`narrator-act1`, `narrator-act2`).
- Cast voices by audition: keyword search on Fish Audio, then listening, dropping and
  shortlisting, and casting one of the shortlist.
- Generate narration for one character or the whole part: missing clips are recorded, clips whose
  inputs changed are re-recorded, clips whose line left the script are removed.
- Output stays compatible with what the game already reads (`manifest.json` with word timings).
- Never touch git beyond reading `git status` to show what changed.

**Non-goals (for now)**

- Editing dialog text. The dialog comes from the game (RetroQuest extracts it by playing the golden
  path through the engine); the studio only reads it. Per-line _delivery cues_ are editable.
- Hosting, multi-user, or remote use. It is a localhost tool for one developer.
- Sound effects: the list and the studio's own descriptions (§8.9), the model (§8.8) and the takes — made, compared, chosen, looping ones seamless — (§8.10) are built (§12 step 16; §13 decision 9).
- Deciding where a track plays. The game decides which track a room or region plays, and when a
  stinger sounds; the studio makes the tracks it lists.

---

## 2. How it runs

```
retroquest/                      ← user runs `content-studio` here
├── content-studio.json          ← project file (committed)
├── .env                         ← FISH_AUDIO_API_KEY (gitignored, already exists)
├── content-studio/              ← the studio folder: its .gitignore (written at start if missing) keeps cache/ out
│   └── cache/                   ← tool state: takes (narration's and music's), auditions, ruled-out voices, what was heard, settings
│   └── narration/               ← cast.json (the cast), act1.edits.json (an act's cues), act1.lock.json (what its clips were made from)
│   └── music/                   ← edits.json (the studio's changes to the tracks), lock.json (the chosen take of each track)
│   └── images/                  ← edits.json (the style and the studio's changes to the images), lock.json (the chosen take of each image)
│   └── effects/                 ← edits.json (the studio's rewordings of the sound effects), lock.json (the chosen take of each effect)
│   └── scenes/                  ← act1.lock.json (the loudness each of an act's scenes was last measured at)
├── tts/act1/
│   ├── script.json              ← dialog resource (read)
│   └── music.json               ← the act's loops, from the game (read; built, §8.5)
├── tts/stingers.json            ← the game's stingers (read; built)
└── web/public/audio/
    ├── narration/act1/
    │   ├── *.mp3                ← clips (written)
    │   └── manifest.json        ← key → file, speaker, duration, word timings (written)
    └── music/generated/
        ├── *.mp3                ← tracks (written; planned)
        └── manifest.json        ← track → file, duration (written; planned)
```

1. `content-studio` walks up from the current directory to find `content-studio.json`. That directory
   becomes the **project root**; every path in the project file is relative to it.
   A game still on the studio's old names (Audio Studio, renamed Content Studio in as-yag.6) is not
   opened: the walk also looks for `audio-studio.json`, and the project folder for `.audio-studio/`,
   and `content-studio` prints the renames left (`core/renames.ts`, `locateProject` in
   `services/workspace.ts`) and exits before any server starts. The old names are never read.
2. It validates the project file (a file without `"version": 2` is refused with one problem at
   `version`, saying to convert it as docs/project-files.md describes) and every resource it points
   to, writes the studio folder's `.gitignore` (`cache/`) when it is missing
   (`services/studioFolder.ts`), then starts a Bun HTTP server on
   `127.0.0.1` (random free port, or `--port`) and opens the browser on it.
3. The UI talks to the server over a small JSON API, and gets live job progress over a WebSocket.
4. The studio writes only to paths the project file names, and every path goes through
   `resolveInRoot`, which refuses anything outside the project root. Clips are served only when
   they are plain files in the part's clips folder (no folders, no symbolic links). The one
   exception is the game's own commands: **Refresh dialog**, on a part's overview, and **Refresh
   from the game**, on an act's Music, Images and Scenes pages (the same `refresh.part` command) and on the Stingers
   and Sound effects pages (the one `refresh.shared` command), run in the project root, only when the user clicks one on the
   studio's page; what a command writes is the game's business, and the studio does not check it
   beyond reading the dialog, the loops or the stingers again.
   Besides those paths, the studio writes the project file itself in a few places only: the project's
   own words that sound the same (`narration.generate.soundAlike`), from the characters page (§8.3),
   the models (`narration.models.fish`, `narration.models.elevenlabs`, ElevenLabs' voice settings
   `narration.generate.elevenlabs`, `music.model`, `images.model` and `effects.model`) from Setup's
   Models panel, and the retirement
   switch of `s1`. The Fish tier and the take fade are the person's own, not the project's: they are
   kept in the cache (`content-studio/cache/settings.json`), never in the project file.
5. The API answers only requests addressed to `127.0.0.1` or `localhost` on its port (against DNS
   rebinding), and takes changes (POST) only from its own page (the Origin header).

Installed once from this repo with `bun link` (later `bun add -g`), then run in any consumer.

---

## 3. Technology

| Concern                                     | Choice                                                           | Why                                                                                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime, server, bundler, tests             | **Bun** (`Bun.serve` with HTML imports, `bun test`)              | One tool for everything; serves the React app with no separate build step.                                                                                                                                      |
| UI                                          | **React 19 + TypeScript**, TanStack Query for server state       | Bun bundles JSX with no extra setup; Query handles caching and refetching.                                                                                                                                      |
| Styling                                     | Plain CSS with design tokens (custom properties), one stylesheet | Small, no framework lock-in; dark-first theme, the Aurora look (`docs/ui/restyle.html`, A): glass panels on a deep background with two faint glows, the accent a gradient on the main action and the logo only. |
| Waveforms and playback                      | **wavesurfer.js**                                                | Waveform, seek, and region playback for the audition and line inspector.                                                                                                                                        |
| Validation                                  | **zod**                                                          | One schema per file type gives validation, types and readable errors.                                                                                                                                           |
| TTS and voice library                       | **Fish Audio REST API** via a thin `fetch` client                | The calls in use are few (search, voice, TTS, credits); no SDK needed.                                                                                                                                          |
| Transcription (word timings, quality check) | **mlx-whisper** in a long-lived Python worker (`uv run`)         | Same model and quality bar as today; the model loads once, not once per clip. Behind an interface, so whisper.cpp can replace it on non-Apple machines.                                                         |
| Encoding and joining                        | **ffmpeg** (subprocess)                                          | Already a dependency; MP3 64 kbps mono as today.                                                                                                                                                                |
| Music generation (§8.5)                     | **ACE-Step 1.5** in a long-lived Python worker (`uv run`)        | Free and local; why, in §13 decision 4.                                                                                                                                                                         |

A native window (Electrobun) can wrap the same web UI later; nothing in the design depends on it.

---

## 4. Module layout

```
audio-studio/
├── bin/content-studio.ts     CLI entry: find project, start server, open browser
├── src/
│   ├── core/                    pure logic, no I/O; most of the tests
│   │   ├── project.ts           project file schema, path templates ({part})
│   │   ├── resources.ts         schemas for script, cast, cues, manifest, lock
│   │   ├── spoken.ts            text sent to Fish: cue + pronunciations + chunking
│   │   ├── pronounce.ts         the pronunciation table's rules (cleaning, problems)
│   │   ├── soundAlikeEdit.ts    the project's sound-alike groups as edited (rows, problems)
│   │   ├── prices.ts            Fish's prices per model, promotions with their end
│   │   ├── spend.ts             whether a paid recording may start (confirmed, covered)
│   │   ├── spending.ts          paid recordings as saved, and the page's totals and rows
│   │   ├── changes.ts           git status output parsed and grouped by part
│   │   ├── dialogDiff.ts        what a refreshed dialog added, removed and changed
│   │   ├── elevenSpeech.ts      ElevenLabs' speech models, their credits, a voice's stage model, the speed
│   │   ├── fingerprint.ts       hash of everything that affects a clip
│   │   ├── planner.ts           script × lock × disk → status per line, generation plan
│   │   ├── summary.ts           parts and characters as the UI shows them
│   │   ├── voiceSearch.ts       search terms from keywords; ranking of found voices
│   │   ├── voices.ts            whose a voice is: `eleven:` ids for ElevenLabs, bare ones Fish's
│   │   ├── castFormat.ts        the cast as text, in its own layout (one line per character)
│   │   ├── align.ts             Whisper words → word timings, heard ratio (narrate.py's, + names)
│   │   ├── numbers.ts           the numbers 0–99 in words, per language, matched to digits
│   │   ├── audition.ts          the audition board: to hear, shortlist, drop and undo
│   │   ├── ruledOut.ts          voices ruled out per character (dropped, left out of searches)
│   │   ├── heard.ts             what Whisper heard of a part's lines below full, as saved
│   │   ├── soundAlike.ts        English words that sound the same, matched as one
│   │   ├── setup.ts             what the machine and project lack, from facts, with a fix each
│   │   ├── notes.ts             the user's notes on a part's lines, as saved
│   │   ├── lineTakes.ts         a line's extra takes, as saved, and as listed
│   │   └── wav.ts               read and join WAVs
│   ├── services/                I/O behind interfaces (fakes in tests)
│   │   ├── env.ts               the Fish and ElevenLabs API keys, from the environment or the env file
│   │   ├── elevenlabs.ts        ElevenLabsClient (subscription, music, tts, voice; more with step 14)
│   │   ├── elevenMusic.ts       Eleven Music as a MusicGenerator: the brief, the key, the MP3 decoded
│   │   ├── fish.ts              FishClient (listVoices, getVoice, tts, credit, createVoice, designVoice)
│   │   ├── voiceSearch.ts       searching Fish for every term, pooled and ranked
│   │   ├── auditions.ts         candidates and the cast voice of a character; cast changes, in turn
│   │   ├── sessions.ts          audition sessions in progress, saved in the tool's cache
│   │   ├── ruledOut.ts          ruled-out voices per character, saved in the tool's cache
│   │   ├── spending.ts          the record of paid recordings (content-studio/cache/spending.json) and the running ones
│   │   ├── soundAlike.ts        the project's sound-alike groups, saved in the project file
│   │   ├── models.ts            s1 → s2.1-pro, and a stage's model, in the project file's `narration.models.fish`
│   │   ├── modelsView.ts        the whole dialog's size and what recorded clips were made with, for the Models panel
│   │   ├── projectFile.ts       reading the project file for a change, and writing it back as it was laid out
│   │   ├── heard.ts             what Whisper heard of each take below full, saved in the cache
│   │   ├── takes.ts             audition takes and tries: recorded once, cached by what they are made of
│   │   ├── setup.ts             the facts for the setup checks: tools on the PATH, the key, Fish
│   │   ├── notes.ts             the user's notes on lines, saved in the cache
│   │   ├── lineTakes.ts         a line's extra takes: taken, listed, used as the clip, dropped
│   │   ├── transcriber.ts       Transcriber interface + mlx-whisper worker
│   │   ├── audio.ts             encode MP3 with ffmpeg, level its loudness (as level.py)
│   │   ├── files.ts             read resources, write atomically, lock formatting
│   │   ├── workspace.ts         find the project, load it and its parts, adopt clips
│   │   ├── git.ts               `git status --porcelain` for the project's paths
│   │   └── jobs.ts              job queue, concurrency, cancel, progress events
│   ├── server/
│   │   ├── index.ts             Bun.serve: routes, WebSocket, static UI
│   │   └── api/*.ts             one file per resource (parts, characters, auditions, jobs)
│   └── ui/                      React app
│       ├── index.html
│       ├── app/                 shell, routing, theme
│       ├── features/
│       │   ├── overview/        part dashboard, cast grid
│       │   ├── audition/        the audition board, ruled-out voices
│       │   ├── characters/      all characters, a character's page, the casting brief
│       │   └── narration/       line table, plan, job progress, inspector
│       ├── player.ts            plays clips one at a time, or a list in turn; takes fade in (from the element's playing event) and out for the person's `takeFade` setting, the game's file does not
│       ├── loopAudio.ts         the player's audio: a loop decoded once and played round on Web Audio with no gap (an audio element's loop clicks where it comes round), every other clip on the element
│       ├── pager.ts             the previous/next control's rules: which key press steps (not in a field or in a control that uses ←/→), and the control's props for an item of a list
│       └── components/          buttons, chips, waveform, player, status pills
├── worker/transcribe.py         mlx-whisper worker (JSON lines on stdin/stdout)
└── docs/
```

**Previous and next** (as-5wz; drawn in `docs/ui/as-5wz-pager.html` and `docs/ui/as-5wz-image-arrows.html`). Every
one-item page (a music loop or stinger, an image, a sound effect, a character, a part's overview and
lines page, a scene) ends its header with `components/Pager.tsx`: ‹ and › around "3 of 12", built
from the list the breadcrumb goes back to (`core/neighbours.ts`, `ui/pager.ts` `pagerFor`), never
wrapping and never crossing acts. A step sets `window.location.hash` as the breadcrumb does, so the
route hold that asks before leaving a scene's unsaved changes applies unchanged. ← and → step too,
unless the press is in a field or inside a control that uses the arrows (`ARROW_USERS` in
`ui/pager.ts`); the image page passes `keys={false}` because its take strip keeps the arrows
page-wide. The language chosen stays in the address of the neighbour. On a character's page, a
part's overview and Lines page and an act's Scenes page, the pages whose header has buttons or a
language switch, the control sits inside the header's action group (`.header-end`), held to the
right end, so a narrower window wraps it with the buttons and never alone at the left (as-ped,
as-85z).

Rule of thumb: `core/` decides, `services/` does, `server/` exposes, `ui/` shows. `core/` has no
imports from the others, so the rules for status, staleness and alignment are tested without
audio, network or disk.

---

## 5. The project file

The format the studio reads, version 2, is described for the people who write the files in
[docs/project-files.md](project-files.md) (epic as-6u9, §12 step 18), which is where the format of
every file is described. This section and §6 say how the studio uses them.

`content-studio.json` in the consumer repo root. Path templates use `{part}`, so a part only needs
an id and a title. Its top level, the studio folder and the cache (as-6u9.2), the `narration`
section (as-6u9.3), the `music` section (as-6u9.4), the `images` section (as-6u9.5), the `effects` section (as-6u9.6) and the `scenes` section (as-6u9.7) are version 2.

```json
{
  "$schema": "https://raw.githubusercontent.com/rmstdope/audio-studio/main/schema/content-studio.schema.json",
  "version": 2,
  "name": "RetroQuest",
  "description": "A retro-style text adventure played in the browser. Narrated by a warm storyteller; characters are villagers of Willowbrook.",
  "env": ".env",
  "partLabel": "Act",
  "parts": [
    { "id": "act1", "title": "Act I: The Call to Adventure" },
    { "id": "act2", "title": "Act II" }
  ],
  "languages": ["en"],
  "refresh": {
    "part": "cd web && npx -y tsx@4.23.15 --tsconfig tsconfig.json ../tts/extract-{part}.ts",
    "shared": "cd web && npx -y tsx@4.23.15 --tsconfig tsconfig.json ../tts/extract-shared.ts"
  },
  "narration": {
    "from": { "part": "tts/{part}/script.json" },
    "clips": "web/public/audio/narration/{part}",
    "manifest": "web/public/audio/narration/{part}/manifest.json"
  }
}
```

- `version` is required and must be `2`. Any other, or none, is refused with one problem at
  `version` ("This project file is in the format before version 2. Add "version": 2 and move its
  fields as docs/project-files.md describes."), whatever else the file holds (`parseProject` in
  `core/project.ts`). There is no migration: a game is converted by hand.
- `$schema` names the JSON Schema of the file, `schema/content-studio.schema.json` in this
  repository, made from `ProjectSchema` (its input side, so a field with a default is optional) by
  `bun run schema` (`core/projectSchema.ts`); a test fails when the checked-in file is out of date.
- `partLabel` (default `Part`) and `parts` (required) are at the top level.
- `languages` (top level) lists the languages the game is narrated in, by code (`["en", "sv"]`; default
  `["en"]`). The first is the source language: its dialog is the line shown beneath a translation.
  Path templates may contain `{language}`; with more than one language every narration path
  (`from.part`, `clips`, `manifest`) must, or languages would share a file. The studio's own files
  of a language besides the source carry its code (`act1.sv.edits.json`, `narrationFile`). Each language is
  named in itself in the UI (`core/languages.ts`: `sv` is Svenska).
- `audition.phrase` (language code → phrase) is each language's standard audition phrase; each
  must fit one take. The source language without one has the built-in phrase (`standardPhrase`);
  another language without one borrows her longest line (§6).
- `refresh` is optional, and so is each of its two commands. `refresh.part` (it must contain
  `{part}`, replaced by the part's id) writes one part's lists of every kind: the UI offers
  **Refresh dialog**, and Refresh from the game on an act's Music, Images and Scenes pages, which
  run it in the project root and read the lists again. `refresh.shared` writes every list of no
  part (the stingers and the sound effects alike): Refresh from the game on the Stingers and Sound
  effects pages runs it, one run at a time whichever page asked. Run from either page it rewrites
  both lists, but each page reports only the changes to its own. This is how the studio stays
  generic: the game owns how its lists are extracted.
- `env` names the file holding `FISH_AUDIO_API_KEY` (and `ELEVENLABS_API_KEY`), read each time a
  key is needed. The environment variable wins if set, except a value Bun itself loaded at start
  from this same file (it loads the `.env` files of the folder it is started in), which the studio
  forgets, so editing the file takes effect without a restart. To see which values Bun loaded, the
  studio reads the start folder's `.env` files once, at start, and only when one of them is the
  project's env file.
- The cast and each part's cues and lock are not named in the project file: they are at fixed
  places in `content-studio/narration/` (`CAST_FILE`, `narrationFile`; see §6).
- `models.fish` names the Fish model for each stage (see §8.4), `models.elevenlabs` ElevenLabs'. Each stage, `audition` too, may name
  any model whose price the studio knows (a paid audition model is paid from a budget per sitting,
  §8.1). Anything else is rejected with a clear message.
- `generate.soundAlike` lists, by language, the game's own words that sound the same (words or phrases, a letter or
  digit in each word: "all right" and "alright"), a group each, added to the studio's built-in
  English ones (`core/soundAlike.ts`: "in" and "inn", "weekly" and "weakly", "there", "their" and
  "they're", …); see §8.2. Optional, empty by default; edited on the characters page (§8.3).
  Declared languages only (`{ "en": [[…]], "sv": [[…]] }`); the built-in groups are English words
  and apply to `en` only. Words
  are compared in any alphabet (letters and their marks kept: "får" is not "för"), and the numbers
  0 to 99 of `en`, `sv`, `de`, `el` and `ru` are built-in groups of their language with the digits
  Whisper writes ("tjugo" and "20", "twenty one" and "21"; `core/numbers.ts`).
- The person's own settings are not in the project file but in the cache,
  `content-studio/cache/settings.json` (`core/settings.ts`, read and written by
  `services/settings.ts`), so each person keeps theirs and nothing personal is committed. A broken
  settings file is a problem naming it, and is never written over. `fishTier` (`under-100`, `100`
  or `1000`) is what the user has paid Fish in total, which sets how many requests Fish takes at
  once (5, 15, 50). Fish offers no way to ask, so the user says it once in the menu on Setup's
  Requests at once row, saved at once (`PATCH /api/fish-tier`, `services/fishTier.ts`); absent
  means not told. `takeFade` (seconds, 0 or more; 0 is no fade) is how long a music take fades in
  and out when it plays in the studio, chosen in the Playing takes panel on Setup (No fade, 0.1,
  0.2, 0.5, 1 or 2 s; a length set by hand shows as an extra entry) and saved at once
  (`PATCH /api/take-fade`, `services/takeFade.ts`); absent means 0.2 s. `ProjectSummary.takeFade`
  carries it; `useClipPlayer` reads it from the project as each clip begins, so a take already
  playing keeps its fade. The game's file and narration never fade.

---

## 6. Resources

The studio defines the format of every file it reads and writes, in
[docs/project-files.md](project-files.md) (version 2); the game's lists and what the game plays
follow it. This section says how the studio uses narration's files.

**Dialog** (`narration.from.part`, read only; one per part and language): `[{ id, speaker, text, scene? }]`. `id` is the game's stable id for
the line (RetroQuest: a hash of speaker and words, so new wording gets a new id). Inside the studio
it is the line's `key` (`LineSchema` reads `id` into it). Between
languages lines are matched by key: a source line missing from a language's dialog (or blank
there) is _Not translated_, and a line only the language has is shown with "No English line".

**Characters** (`content-studio/narration/cast.json`, read and written): one file for the whole project. A character is
keyed by its name; every part whose dialog has a speaker of that name uses that entry, so its voice,
style and audition keywords are the same in every part. To give a character a different voice in
another part, the game names the speaker differently (`narrator-act2`), and it becomes a character
of its own. The pronunciation table is project-wide too. Per-part differences in delivery go in the
part's cues. Two characters may be cast with one voice (a narrator and a character in a prologue,
say); the studio points it out on their pages and cards, as a note, not a problem.

**Per language** (as-170.2): the fields above are the source language's (the first declared). Her
casting in any other language is `languages: { "sv": { voice, voiceName, speed, phrase } }` on the
same entry, so a single-language cast never names a language for its speakers. Keywords and style
are one set for every language. `core/resources.ts` reads it through `voiceOf` and `projectCast`,
which gives the planner and the takes the cast as one language sees it. The audition phrase of a
language is her own in it, else the project's standard one in it, else her longest line in it, else
none (and no audition can start). Her audition and ruled-out voices are kept per language in the
cache, the source language's under the names they always had; an audition's shortlist starts
with her voices in the other languages, so they can be heard saying this language's phrase.
On a language with no voice, the page's explanation names each distinct Fish voice once (as-2tb),
by its name on Fish with the languages it is cast in; until Fish has named it, by those languages
("Its English voice").

**Pronunciations per language** (as-170.3): `pronounce` holds a table per language, the source
language's included (`{ "en": {…}, "sv": {…} }`). `projectCast` gives the cast as one language
speaks it (`SpokenCast`), with that language's own table in `pronounce`, so what is said, priced and fingerprinted is that
language's alone; a language without one has none (English respellings are never sent to another
voice).

New fields: `voiceName` (shown in the UI; the id alone is unreadable), `audition` (the keywords,
plus an optional phrase that replaces the project's standard one) and `speed` (the character's own
speaking speed, half to double as Fish allows, in place of the project's `generate.fish.speed`; its lines,
audition takes and tries are all spoken at it). A speaker in the script with no
entry in the cast shows as **Uncast**. The UI shows, for each character, which parts it appears
in and how many lines it has in each, because recasting it makes its lines stale in all of them.

Pronunciations apply in the order the file lists them, with one limit: JavaScript puts integer-like
keys (`"10"`) first when it reads the file, so the studio applies those first, where RetroQuest's
Python tooling keeps file order. The studio refuses to rewrite a cast where this would change the
order (an integer-like key among others); a longer key such as `"Act 10"` keeps its place.

**Cues** (`content-studio/narration/<part>[.<lang>].edits.json`, read and written): `cues` holds
`{ id: cue }`, replacing a character's style for one line, and `scenes` a cue per scene. The studio
reads both into one cue table, a scene's cue under the key `scene:<name>` (a line key never holds a
colon), and writes them back split (`EditsCuesSchema`, `formatEdits`).
Cues are per language (as-170.3): a line in a language besides the source follows the source
language's cue for the line until the language's own file gives it one, then the character's style.
The planner is given the merged cues (`readPart` builds them), so a changed source cue makes the
language's clips stale for the cue, and `LineState.cueFrom` (`own`, `source`, `style`) and
`sourceCue` tell the page where a cue comes from. Editing a cue in a language writes that
language's file only.

**Scene cues** (as-2qh): a dialog line may name its `scene`, and the edits hold a cue per scene
under `scenes`, by the scene's name. A line is cued by its own cue, else its scene's, else
its character's style; only the speakers in `narration.generate.sceneCueSpeakers` (cast ids, default
`["narrator"]`, edited by hand in the project file) follow scene cues. The cue that results feeds the
fingerprint, so changing a scene's cue makes the lines that follow it stale for "The cue changed"
and putting it back makes them up to date again. In a language besides the source the scene is the
source dialog's name for the line, and its cue follows the source's until the language has its own
(`cueFrom` adds `scene` and `sceneSource`). `PartState.scenes` lists the scenes with their cue,
line counts, up-to-date recorded followers (what saving newly marks stale; a follower already stale
is not counted) and the first line that follows (what Hear it says); the lines page puts a band per
run of a scene's lines above them, carrying the cue and its editor, and a scene cue whose scene left
the dialog is an orphaned cue.

**Cues inside a line** (as-vhm): a line's entry is its opening cue alone (as always), or the _cued
text_: the opening cue, then the line's own words with a bracketed cue between some of them
(`"[ashamed] I did it. [resolute] I will fix it."`). `core/cued.ts` reads it against the line's
words: an entry is cued only when a bracket group follows a word, so `[sad] very slowly` stays an
opening cue; the opening cue is what precedes the first word; a cue is never before the first word
or after the last, one per gap, `at` counting the words before it. An entry whose words, cues
removed, are not the line's (the game changed them) gives no cues inside and is `insideStale`: the
line records with its opening cue only and the page shows the previous text. Recording sends each
cue where it was placed, and each piece of a long line starts with the cue in effect there
(`spokenPieces`, `piecesOf`); the fingerprint counts the cues inside only when there are some, so
clips made before stay up to date. A language besides the source follows the source's opening cue
only; the source's cues inside stay with it (`mergeCues`). The Whisper check compares the line's
words, which never include cues.

**Manifest** (`manifest.json`, written): unchanged, `{ key: { file, speaker, duration, words[] } }`.
This is what the game reads.

**Lock** (`content-studio/narration/<part>[.<lang>].lock.json`, written, committed): one entry per
clip, recording what it was made from. Written one entry per line, keys sorted, so a re-recorded
clip is a one-line diff. `hashes` are short hashes of the inputs that are not kept in the clear
(`cue`, `text`, `said`, `settings`), so the planner can say which one changed. `heard` and `takes`
are absent, and `adopted` is true, for clips made before the studio. `accepted` is true when the
user accepted a weak clip as it is (Accept on the lines page); recording the line again writes a
new entry without it.

The lock is a separate file so the manifest format the game depends on stays exactly as it is.

**Cache** (`content-studio/cache/`, kept out of git by `content-studio/.gitignore`, which the
studio writes at start when it is missing): the tool's own state, none of it the game's: audition
takes, audition sessions in progress, the voices ruled out per character, a line's extra takes
(`content-studio/cache/line-takes/<part>-<hash>/<key>/<id>.wav` and `.json`: the audio as Fish sent it,
joined, and what Whisper made of it), the user's notes on
lines (`content-studio/cache/notes/<part>-<hash>.json`: "too fast", "retake after the rewrite"; on this
machine only, so a teammate does not see them), and what Whisper heard
of each kept take heard below full (`content-studio/cache/heard/<part>-<hash>.json`: per line, the lock
entry's time, the text it was checked against, Whisper's words and the shown words it missed). Deleting it loses nothing the game
needs; it forgets paused auditions, ruled-out voices, notes and what was heard. Notes, what was
heard and a line's extra takes are kept per language: the source language's under the part's own
name, another's under the part's name with the language (`partCacheName`).

All JSON is written with stable key order and the same layout the file already has, through a
temporary file and a rename, so diffs stay small and a crash never leaves a half-written file.

---

## 7. Staleness: the fingerprint

A clip is up to date when its fingerprint matches the lock. The fingerprint is a SHA-256 of
everything that changes the audio:

```
fp = sha256(json([
  model,                      // the draft stage's model of the voice's provider (§8.6)
  voiceId,
  cue,                        // the line's cue, else the character's style
  said,                       // the line with pronunciations applied and checklist bullets read as a list
  settings                    // temperature, topP, speed (the character's own if set), chunkLimit, codec, bitrate, channels
]))[:16]
```

For an ElevenLabs voice the settings begin with its voice settings in place of temperature and
top-p: stability, similarity, style, then the speed and the rest. A Fish voice's fingerprint is
what it always was (a test pins one), so no clip goes stale for ElevenLabs' coming. A part has a
final step when one of its voices records its final with another model than its draft, on that
voice's own provider's stages (`finalStepFor`); then an up-to-date clip of a voice whose own
stages are one counts as final, so a final recording leaves it alone. A part of Fish voices alone
has no final step for ElevenLabs' stages differing, and the other way round.

A clip made with `s1` counts as made with `s2.1-pro` (Fish serves and bills them as one):
`fingerprintMatches` also accepts the fingerprint computed with `s1` when the project names
`s2.1-pro`, and `staleReasons` names no model change between them.

Pronunciations go into the hash through `spokenText`, not as the whole table. Adding
`"Elior": "El-ee-or"` therefore marks only the lines that contain "Elior" as stale, not the whole
act.

The **planner** gives every line one status:

| Status      | Meaning                                                                | Action when generating              |
| ----------- | ---------------------------------------------------------------------- | ----------------------------------- |
| `ok`        | clip exists, fingerprint matches                                       | none                                |
| `weak`      | up to date, but the best take was heard below `minHeard`, not accepted | offered for a retake, not automatic |
| `stale`     | clip exists, fingerprint differs; the UI names the inputs that changed | re-record                           |
| `missing`   | no clip, or its file is absent on disk                                 | record                              |
| `untracked` | clip exists but has no lock entry: made before the studio              | none; offered for adoption          |
| `uncast`    | speaker has no voice                                                   | blocked until cast                  |

Clips in the manifest whose key is no longer in the dialog are listed as **orphans** (removed after
confirmation when generating), and cues whose key is gone as **orphaned cues**. While the dialog
file is there but cannot be read, neither is listed: its problem is shown instead, and generation
is refused until it is fixed. The same holds while the file is **gone** but clips are in that
language's manifest or cues of its own are in its cues file (`DialogState` `gone`, with the counts):
the recordings are held, nothing is orphaned or offered for removal (the planner's `held` input),
and the part's overview, lines page, language switch ("Dialog gone") and sidebar ("dialog gone")
say so in amber. Nothing is stored; it is read from the files each time.

A stale line's reasons come from comparing the lock entry with today's inputs: `voice`, `model`,
`cue`, `text`, `pronunciation` (the words as said changed but the words did not) and `settings`.

**Adopting existing clips.** RetroQuest's 244 clips have no lock yet. On first open the studio
shows them as `untracked` and offers **Adopt**: it writes the lock with today's fingerprints, treating
what is on disk as up to date, so nothing is re-recorded just because the tool is new. Adopting is
refused while any of the part's files has a problem, so a broken cast or lock can't be recorded as
the truth.

---

## 8. Workflows

### 8.1 Audition (casting a voice)

This is the audition built in step 9 (§12).

Every character has a **character page** (`#/characters/<id>`), the one place about it: its
cast voice (Fish's details, its take and Fish's sample, its id and a link to Fish; the take
records by itself when missing; a note when another character has the same voice), its lines per part, its delivery (the style cue and its own speed) and casting
brief (search keywords and audition phrase), the voices ruled out for it, the audition in
progress, if there is one, and **Hear it in the game**: its recorded lines with their part, cue
and status, as the game plays them, one by one or all in turn (the first five shown until asked
for all; any other play stops the list; a clip that fails is skipped). An audition is started,
resumed and stopped from there; the page shows no candidates. The **audition page**
(`#/characters/<id>/audition`) shows the board, with the phrase and style the takes are recorded
with beside it and the keywords Bring in more searches for; with no audition in progress, it
offers to start one.

**Your voices** sit on the board between the Shortlist and To hear: every voice on the user's own
Fish account (`GET /model?self=true`, `listOwnVoices`), whatever the keywords, never ranked and
never in To hear. They are fetched by their own request (`POST /api/auditions/:id/own`) when a
board opens, on a start or a resume, and again on Try again, so the board does not wait for Fish;
a failure leaves the session as it was. Without a Fish key the section says so, with a link to
Setup, and offers no Try again (the answer is `no-key`, which trying again cannot mend). The session keeps them in `yours` (the section) and
`mine` (the whole account, for the "none" and "all used up" lines); a voice marked `own` keeps its
"Yours" badge and blue border on the shortlist and as the cast voice. Shortlist, Unlist (back to
Your voices) and Drop (ruled out like any voice) work as elsewhere; an own voice ruled out is not
put back by a later fetch.
The Voice panel also offers **Clone a voice from recordings**, to every account (whether a private
voice speaks on the free model is unverified, so the sample on the new voice's card says when it
does not). The form opens in the panel: a name, 1 to 20 recordings (their length read in the
browser; under 10 seconds or not audio is left out before sending), a permission tick. The
recordings go to `POST /api/characters/:id/clone-voice`, which makes a private voice on the Fish
account (`FishClient.createVoice`) and writes nothing to the project. The card then offers to cast
the voice (`POST /api/characters/:id/cast-voice`, with the usual confirmation), to bring it into
the audition (the existing `start` and `add`), or to leave it on the Fish account.

**Design a voice from a description** (`voice-design-1`, `POST /v1/voice-design`: $0.01 per
successful request, four voices, each saying the audition phrase cut to the 150 characters Fish's
API reference allows). A **Design a voice…** button on the character page (beside Start/Resume
audition) and in the board's bottom bar opens a box with a text of at most 2,000 characters; it
opens with the last description sent, else a start made from the casting brief (`designStart`).
**Design voices…** opens a confirm (credit, **Pay up to $0.01**; without a readable or sufficient
credit, "Fish can't design voices now"). Paying calls `POST /api/characters/:id/design` with
`{ description, spendUpTo }`: the server admits $0.01 as a budget (`admit`, held back from the
credit while Fish works), asks Fish, and charges nothing when it refuses. With no audition going on
the page starts one afterwards (a paid audition model's own box follows).
Fish makes no voice on the account from a design, only audio, so a design has no Fish id until it
is cast. The studio gives each a local id `design-<12 hex>` and keeps them per character in
`content-studio/cache/designs/<character>-<hash>.json` (one per language in a project with several, named as the audition's and ruled-out files are; `core/designs.ts`: the voices with their number
"Design n", the description, when they were asked for, how many were ever made, and the last
description sent); the preview is encoded to MP3 into `content-studio/cache/takes/` under a key made from
the id, so it plays as the voice's take (a design is never recorded on a paid model). The session
only references them (`designed`, a place like `yours`; `setDesigned` refreshes it from the store
when an audition starts or a design is made), so a design never cast is back on the next audition
for the character; a dropped one is ruled out like any voice and `setDesigned` leaves ruled-out
ids out. The board's **Designed for <name>** section groups them by request, newest first.
Casting a design (`castDesign`, through `POST …/cast`) first saves its preview to the account as a
private voice named `<name> (designed)` (then `(designed 2)`, …: the first name the account does
not have) with `FishClient.createVoice`, then casts that voice like one made from recordings and
removes the design from the store. If Fish cannot save it nothing is cast and the card says so.

```
 keywords ──► search Fish's library, leaving out ruled-out voices ──► ranked candidates
                                       │
                                       ▼
       To hear: a few at a time, each saying the audition phrase in the character's style
                                       │
           ┌───────────────────────────┼─────────────────────────────┐
           ▼                           ▼                             ▼
         Drop                      Shortlist             Bring in more, or a specific voice
  gone at once, ruled out              │
  for the character for good           ▼
                     Cast one of the shortlist: voice + voiceName to cast.json
                     → the character's clips become stale in every part
```

An audition is for a character, not for a part: the result applies to every part it speaks in.

- **Starting an audition searches nothing.** The cast voice, her voices in other languages, Your
  voices and earlier designs come to the board; To hear starts empty (`heard: false` in the
  session, until a voice is brought in), with a line pointing to the bar below. The user chooses
  where voices come from, so starting needs no Fish key: without one, her Fish voices on the
  board are shown by their ids (and the names the cast gives them), and what needs Fish (Your
  voices, Bring in more or a specific voice from Fish) says the key is missing. While Bring in
  more searches, it reads "Searching Fish Audio…" or "Searching ElevenLabs…"; keyboard focus
  starts on it when the board opens with nothing heard.
- **To hear** holds the candidates being listened to, best match first. **Bring in more** adds
  the next ones (`audition.candidatesPerRound`), searching again when the queue runs short (with no search keywords it asks neither library, and
  says the character has none, with a link to their page);
  **Bring in a specific voice** adds one by its Fish id or URL, or, with ElevenLabs chosen in the
  menu beside it, by the bare id of one of the user's ElevenLabs voices (§8.6), looked up there.
- **Drop** takes a voice out of the audition at once and rules it out for the character: no later
  search for it shows that voice again. Its take or sample stops at once if it is playing (as
  does whatever plays when the board goes, on a stop or a cast). The last drop can be undone.
  The character page lists the ruled-out voices; one can be allowed again, or all of them
  forgotten so every voice is in the running again. Bringing in a ruled-out voice by its id allows
  it again.
- **Shortlist** moves a voice to the shortlist, **Unlist** back to the voices to hear. The current
  voice starts on the shortlist. Any shortlisted voice can be cast: the studio first says how
  many recorded lines go stale in each part, then writes `voice` and `voiceName` and ends the
  audition. Keeping the current voice ends the audition with the cast unchanged.
- Only Drop rules a voice out. The voice replaced by a cast, and the shortlisted and unheard
  voices of an audition, can come back in a later one.
- **Pause** leaves the audition as it is (it is saved after every change) for the character page;
  **Stop audition** ends it without casting, after saying what that means. Its dropped voices
  stay ruled out. The cast voice can be dropped from the board, but it is never ruled out: it
  takes part in every audition.
- **Search** queries Fish for the whole keyword phrase and each of its words, several pages each,
  pools the results, keeps voices whose title, description or tags contain the keywords, and ranks
  by match, then popularity (the search `fish_tts.py` already does, ported). Ruled-out voices,
  voices the audition has shown, and the current voice are left out of new candidates.
- **Takes** of the board use `narration.models.fish.audition` (`narration.models.elevenlabs.audition`
  for an ElevenLabs voice). On the free model an audition costs nothing, and
  takes record by themselves for every voice shown, each once; one that fails is recorded again
  only when asked. Each voice also offers Fish's own sample clip.
- **A paid audition model** is paid from one budget per _sitting_. **Start audition** (and
  **Resume…** after a pause) first opens a box titled with the model: what is charged, the cost of
  a take (the phrase's bytes at the model's price), an editable "Spend up to" amount (suggested:
  about 50 takes, to the next five cents) beside the account's credit, and Cancel / Pay up to $X.
  Paying admits the amount as a budget (`core/spend.ts`, held back from the credit like a
  recording's) and the board records by itself until it is used: every take the board records is
  charged to it just before it is sent, a take that fails is refunded, a take already recorded is
  free. The board shows a meter (model, used of given, about N takes left); when what is left
  cannot pay for one more take, a bar says so and takes "Add" money (`POST …/sitting/add`);
  voices without a take show "Take waits for more money" and record once money is added. The
  sitting lives in the server's memory (`sittings` in `server/index.ts`): it ends on Pause, Stop,
  Cast or when the studio closes, and what was left is not kept; a reload keeps it. The saved
  session keeps `spent`, the dollars charged over all its sittings, for the character page. A
  credit that cannot be read, or cannot pay for one take, shows "The audition can't start" instead
  of the amount; there is no fallback to the free model. The cast voice's take on the character
  page and **Hear it** tries stay on the free model (`s2.1-pro-free`), labelled "free model" on
  the page; the take key includes the model, so the two never mix.
- **Phrase**: the project's standard phrase, the character's own phrase, or any of their lines
  picked from the script of any part ("hear it say something it will actually say").
- Both belong to the tool, not the game, so they live in the gitignored cache: audition sessions
  in `content-studio/cache/auditions/<character>-<hash>.json` and ruled-out voices in
  `content-studio/cache/ruled-out/<character>-<hash>.json` (each voice's id, title and when it was
  dropped, so the page names them without asking Fish). A readable name plus a short hash of the
  id makes any character name a safe file name. The cast is only changed on **Cast**.

### 8.2 Generate narration

1. The user picks a scope: the whole part or one character, and whether to retake the weak lines
   too (built); a selection of lines (later).
2. The planner shows the plan: N to record, M to re-record (by reason), K orphans to remove, the
   bytes of text as sent, the cost for the model (free model: $0; "price unknown" for a model not in
   the price list); the account's credit is shown under the project. The page sends the lines and
   orphans it showed;
   the server does only those that are still in its own fresh plan, and a line recorded meanwhile
   is skipped (as is one that became weak meanwhile, unless weak lines were to be retaken). Lines
   are recorded with `narration.models.fish.draft` (`narration.models.elevenlabs.draft` for a
   character cast with an ElevenLabs voice). Up-to-date clips Whisper never checked can be measured
   instead, without new audio (a job of kind `measure`), and weak lines checked again with
   today's rules (a job of kind `check`: Check N weak lines again on the Generate panel).
3. **Generate** queues one job per line. For each line:
   1. build the spoken text and split it into sentence-sized chunks (`chunkLimit`);
   2. TTS each chunk (WAV), join them with a short gap;
   3. transcribe with Whisper, align the words to the shown text, compute the heard ratio (the share
      of shown words heard; punctuation on its own ("—", "…"), which nobody says, is no word and is
      only timed). Alignment is narrate.py's, with these departures. Words are compared without
      single quotes at their ends ("'You" and "will.'" are "you" and "will"; apostrophes inside a
      word, "don't", stay), and a possessive is one word however it is written, as Whisper cannot
      hear which ("Sorceress's" and "Sorceress'", "founder's" and "founders'"); an ampersand is the
      word "and" (Whisper's "A &L." matches "A & L" as words heard as one, below). British and
      American spellings are one word (-our and -or, -re and -er after a consonant, a doubled l
      before -er, -ed, -ing and -ous, -ise and -ize: "traveller" heard as "traveler", "colours" as
      "colors"), and words that sound the same are one word (the built-in groups and the project's
      `generate.soundAlike`: "inn" heard as "in", "weekly" as "weakly"), wherever words are matched
      exactly or run together (a phrase of a group heard as one word, or as another phrase of it,
      "all right" as "alright", "Leer ia" as "Lee ria"; a word or spelling run apart, "week ly" as
      "weakly"), not where a name is guessed; words matched whole come first, so a phrase sharing a
      word with its sound-alike ("Mac Gregor", "Mc Gregor") is listed by the words that differ
      ("Mac", "Mc"); a listed word's plural or possessive ("knight's") is not in the list. Words are
      matched whole first, as narrate.py does; the shown and heard words left between two matches
      are then compared by their parts, split at hyphens and dashes on both sides (punctuation
      beside a dash is no part), and a compound written as one word matches the same word heard as
      two, or the other way round ("silverleaf" and "silver leaf", "every one" and "everyone"); a
      joined word counts as heard when all its parts are, and a word pronounced in other parts than
      shown is compared whole, as said; a word pronounced otherwise that Whisper wrote as shown
      counts too, word for word where as many words were heard as shown ("II" for "Act II:", said
      "Act Two:"). And a name heard in its place one letter off (word for word where as many words
      were heard as shown, or by parts while they line up one to one, Whisper's parts joined:
      "El-eor" for "El-ee-or"), as Whisper spells an invented name ("Aren" as "Arn"), or one letter
      off as it sounds where that leaves four letters or more (ch as k between vowels, c as s before
      e, i and y and else as k, ck and q as k, igh as i, ph as f, y as i, z as s, doubled letters as
      one: "Malakar" as "Malachar", "Lifelight" as "LifeLite"), or, for a known name heard as one
      word Whisper wrote capitalised where it starts no sentence (it capitalises every word that
      does), as it sounds with only its vowels other, one for one, where two consonants or more tell
      it ("Elior" as "Ilyar", not "Mira" as "more", "More, wait" or "Omar"), counts as heard and
      takes the heard word's times. Only a capitalised shown word of four letters or more as said (a
      possessive 's not counted), nothing but letters and not all capitals, qualifies; where a
      sentence starts (after . ! ? … or a colon, opening a quote, single or double, or after a dash
      inside a word), and anywhere in German (`de`), which capitalises every noun ("Hund" heard as
      "Hand" is missed), only a known name: a one-word character id of the cast ("aren", not
      "ancient tree spirit") or pronunciation. Lowercase words, short ones, numbers (in digits or in
      words: "Act Three" heard as "Act Tree" is missed) and other sentence-initial words must match
      exactly. Words are compared in any alphabet, letters and their marks kept ("får" is not "för",
      Russian ё read as е, German ß as ss: "große" is "grosse"), and a name in any alphabet is
      guessed the same way ("Лирия" as "Лирья"); the as-it-sounds spellings are English ones. The
      numbers 0 to 99 of `en`, `sv`, `de`, `el` and `ru`, in their common forms ("en" and "ett",
      "одну"), are words that sound the same as their digits, in the part's own language
      (`core/numbers.ts`). A title-case word mid-sentence ("The Call") is taken for a name, outside
      German;
   4. retry up to `takes` times until the heard ratio reaches `minHeard`, keep the best take;
   5. encode MP3 into the clips folder, update the manifest and lock entries, write both; then
      keep what Whisper heard of the take in the cache if it was heard below full (forgotten
      when heard in full). Measuring a clip keeps it the same way. On the lines page, a score
      below 100% opens the line's text with the missed words marked beside what Whisper heard.
      A take checked before this was kept says so, and a retake keeps it.
4. Fish requests run `parallel` at a time; Whisper runs one at a time (one GPU). The page polls the
   job's progress every second while it runs. A job can be cancelled: no new line starts, lines
   under way finish, and finished clips are kept, because each is written as it completes.
5. Orphans are removed at the end, only if the user confirmed that in the plan.

### 8.3 Smaller actions

- Edit a character's style cue, speed or keywords, a line's cue, or the pronunciation table
  (built): saved at once, and affected lines show as stale (a speed is a settings change).
- Hear a cue before saving it (built: **Hear it** while editing a line's cue): the speaker's cast
  voice says the line after the cue as typed (empty: the character's style), as the cast says it.
  It is a take, not a clip: recorded with the free model (whatever the audition model is), the whole line in one
  request (Fish splits long text itself), kept in `content-studio/cache/takes/` under the take key, so
  the same cue on the same line is recorded once; nothing of the game's is written. The clip
  recorded afterwards uses the draft model, chunked and checked, so it can sound a little
  different.
- Edit the project's own words that sound the same (built: the Words that sound the same panel on
  the characters page, under Pronunciations): one group a row, words separated by commas, saved
  as a whole in the project file's `narration.generate.soundAlike`, refused if the file's groups
  changed since editing began. The project file is otherwise only read; the save keeps the rest of
  it, in its own indentation (a hand-compacted object is written out). Takes already recorded keep
  their heard share; the groups count from the next take on.
- Warn that `s1` retires (built): while the project file names `s1` for
  `narration.models.fish.draft` or `narration.models.fish.final`, a banner on every page says so
  (past tense from 1 January 2027, UTC) with Not now (until the page is reopened; nothing stored)
  and Switch to s2.1-pro. Switch asks first, then
  rewrites only the models that are `s1` to `s2.1-pro` in the project file, the same careful way
  as the sound-alike save (the second change the studio makes to the project file). The audition
  model and recorded lines are not touched. A clip made with `s1` counts as up to date under
  `s2.1-pro` (`sameModel`, `fingerprintMatches` in `core/fingerprint.ts`): Fish serves and bills
  them as one.
- Choose the stage models (built, as-3h4): the **Models** panel at the top of Setup shows the
  audition, draft and final models with Fish's rate and what recording the whole dialog once
  would cost (`GET /api/models`: the models, the dialog's lines and bytes over every part and
  language, the clips by the model they were made with, and what is recording or auditioning).
  A menu change is saved in `narration.models.fish.<stage>` (`PUT /api/models/:stage`, `{ model, was }`:
  the fourth kind of change the studio makes to the project file, the same careful way, refused
  when the file's value differs from `was`, for a model with no price or for `s1`, and while
  anything is recording or auditioning). The audition model, and a draft or final change that
  makes no recorded line out of date, save at once; any other asks first (`changeOf` in
  `core/models.ts`: lines made with a model that is in date now and would not be after). `s1`
  is offered only to a stage still on it.
- Retake a single line (built: Record, or Retake for a weak one), or accept a weak one as it is
  (built: Accept; the line shows as ok, "heard 80%, accepted", until it is recorded again). Or check
  a weak one again (built: Check again): Whisper hears the line's clip again, without new audio, and
  the line is scored and timed with today's rules (heard share and word timings in the lock and
  manifest, what was heard in the cache), as measuring does for clips never checked (§8.2); a take
  scored before the rules improved is not weak once checked again. Whisper hears the clip as kept
  (the levelled MP3, decoded), not the take as Fish sent it, so its score and timings can move a
  little either way besides. Only weak lines are checked again (an accepted one is ok as it is).
  A part's weak lines (or one character's) are checked again at once from the Generate panel (a
  job of kind `check`).
- Hear a part as the game plays it (built): on the lines page, **Play N lines in turn** plays the
  lines shown (filtered as the table is: one character, one status, a search) one after another
  in dialog order, every speaker; a row's **from here** button starts there. The list is fixed
  when it starts: filtering afterwards does not change it, and Stop stays offered. The row
  playing is marked and kept in view; a clip that fails is skipped.
- Extra takes of a line (built: **Takes** on its row, opening a list under it): **Another take**
  has Fish speak the line once more with the draft model, checked by Whisper when the project
  checks takes, and kept in the tool cache as a WAV with its score and timings; nothing of the game's is written. Each take is played, compared
  by score and length, and **Use this take** makes it the line's clip, encoded and written with the
  manifest and lock exactly as a recording is (the same `commitClip`), or dropped. A take made from
  other inputs than today's (the cue, text, voice or settings changed) is marked stale: heard, not
  used. A take is a draft one: a line whose clip is final is never taken back to the draft model
  (§8.4), so Use is refused for it, and a final clip landing meanwhile is kept as a recording
  keeps it. A broken file of the part is reported with its path, as a recording reports it. With a paid
  draft model Another take first asks what it can cost (the same `admit` as Record, priced for one
  take, not the `generate.takes` a recording is held to): **Pay up to $X** and **Cancel** replace the
  button, every take asks again, and nothing of the ask is kept; the take is charged to the budget
  confirmed, so no more than that reaches Fish. Whisper's best is not always the best read; this
  lets the ear decide.
- Keys on the lines table (built): a row takes focus (Tab, or a click); j/k and the arrows
  move, space or Enter plays, f plays from there, r records or retakes, a accepts, h shows what
  was heard, c edits the cue, n the note, t opens the takes. A hint under the table lists them. Nothing while typing
  in a field, nothing with Cmd, Ctrl or Alt held (the browser's shortcuts stay its own), and on a
  button in the row space and Enter are the button's.
- A note on a line (built): a note to oneself under the line's text on the lines page ("too
  fast"), edited in place, with a **With a note** filter; kept in the tool cache, not committed.
  A note on a line that left the dialog is kept but not shown. A notes file that cannot be read
  is named as a problem and never written over: the notes are the user's own words.
- Refresh dialog (runs `refresh.part`; built).
- **Changes** panel (built): `git status` for the project's paths, so the user sees what to
  commit.
- **Spending** page (built): what paid recordings (and, with ElevenLabs, music takes) cost,
  project-wide and read only. Every
  recording made with a paid model (a whole part's, draft or final, or one line's record or extra
  take) is added to `content-studio/cache/spending.json` when it ends: when it started, part, language
  (the source language, as recording is), model, lines recorded out of lines planned, how it ended
  (done, stopped, or a failed line), and the dollars charged to its budget (`Budget.spent`: the
  studio's own price estimate as each line was sent, not Fish's bill). A recording that cost
  nothing is not saved, nor is a free model's. A recording running now is not in the file: the page
  reads it live from the job and its budget, shows it at the top and counts it in the totals. A
  studio killed mid-recording loses that recording's entry. A damaged file is reported with its
  file and path and never written over. The sidebar entry shows the total. With ElevenLabs, the
  record also keeps credits and paid music takes, in its version 2 (§8.6).

### 8.4 Model stages and final generation

There are three model stages in the project file: `audition` (candidate takes), `draft` (everyday
generation while the script and cast still change) and `final` (the recording that ships).

- **Now:** any stage may name any model whose price the studio knows (`core/prices.ts`). A paid recording, a job or one line, starts only when the user
  has confirmed the most it can cost (every line needing every take, priced when asked), and the
  account's credit covers it: the server works the ceiling out itself and refuses a request without
  a confirmation at least that high (answering with the ceiling to confirm), or when the credit is
  short or unknown. The confirmed dollars become the recording's budget: charged before every
  request to Fish, at that moment's price, it refuses another model than the one confirmed and
  anything beyond what is left, so nothing changed meanwhile (the project's model, a cue, the
  takes, a promotion ending) spends more than was agreed; without a budget only the free model
  can be used. All that running recordings were given is held back from the credit until they
  end (Fish may bill a request after it was charged); a recording refused after it was admitted,
  and a job when it ends, give theirs back. An audition on a paid model works the same with a
  budget per sitting, asked for by amount rather than by a ceiling (§8.1).
- **Final recording** (built): when `final` names another model than `draft`, the Generate panel
  offers **Draft** and **Final**. The final plan records every cast, translated line whose clip was not made
  with the final model yet (missing, stale, drafted, untracked), with the final model, priced and
  confirmed like any paid job. A clip is up to date if its lock matches the inputs with either
  model; one made with the final model is marked `final` in the line table, and draft plans
  leave it alone. A final clip whose inputs change (a cue, the text) matches neither and goes
  stale like any other, and the draft plan records it again with the draft model (so a paid clip
  edited afterwards becomes a draft one until the next final recording). A weak final clip is
  retaken only with the final model: from its row, or by the final plan when asked. With one
  model for both, on each of a part's voices' own providers, the part has no final step: a final
  plan or recording is a draft one (§8.6). A paid
  `audition` model is still to come, with its cost per take.

### 8.5 Music

The music workspace makes the game's **tracks**: looping background music, each act's own, one per
room or region as the game chooses, and short **stingers** (victory, game over) for the whole game.
As with characters and lines, the game says which tracks it needs; the studio makes them. A track
is made like a voice is cast: a brief, several generated takes to listen to, and one take chosen.
The steps are in §12, step 12; the spike's findings (12.1) are in §13, decision 5. The screens are
drawn in `docs/ui/music-workspace.html`.

**Files.** The music files' format is in [docs/project-files.md](project-files.md): the `music`
section of the project file (`from.part` for each act's loops, `from.shared` for the stingers, each
optional with at least one, `model`, `clips`, `manifest`), the track lists, the studio's edits
(`content-studio/music/edits.json`) and lock (`content-studio/music/lock.json`), and the manifest.
This section says how the studio uses them. An act's pages exist only with `from.part`, the
Stingers page only with `from.shared`. The number of takes and the output settings are fixed in the
code until a project needs another value. `model` (Balanced when absent) is the music model new
takes are made with, saved from Setup's Models panel (the fifth place the studio writes the project
file, with the same rules as the stages' models).

The clips folder is the studio's own: tracks that are not the studio's (RetroQuest's freetouse.com
files) stay where they are, untouched. The music files (the game's lists, the studio's edits, the
lock, the clips and the manifest) join the Changes panel (§8.3); the edits are committed, the
studio's own changes to the game's music. No music path may hold `{language}`: music is the same in
every language. The top-level `refresh.shared` (§5) is the game's command for what belongs to no
act (the stingers, and the sound effects alike), run in the project root by Refresh from the game
on the Stingers page, as `refresh.part` is for an act; without it the page has no such button.

**Track lists** (read only, written by the game): an act's loops in `from.part`, written by the
game's own `refresh.part` command for that part alongside its dialog, and the stingers for the whole
game in `from.shared`, written by `refresh.shared`. Both are lists in the game's order. A list that is there
and empty means the game asks for none; a list that is not there yet means the game has not listed
them ("The game has not listed the loops for Act IV yet."), and no track is taken for an orphan
because of it.

A track is `{ id, title, text, seconds, bpm?, key?, plays?, file? }` (project-files.md); its `text`
is what the studio calls the track's **brief**, in its pages, its API and its code. The file says
the kind: a track in the parts' lists is a loop, one in the shared list a stinger. A track's id
names its file in the one clips folder, so it is a slug (`^[a-z0-9]+(-[a-z0-9]+)*$`) and unique
across the game (a second use is a problem with both files and paths, and neither track is shown or
made until it is resolved). `plays` (where the game plays
it, shown under its name), `file` (the music file the game plays for the track now, a path inside the
project root to an `.mp3`, `.ogg`, `.wav`, `.m4a` or `.flac`; read only, never moved, levelled,
re-encoded or written, and never taken as a chosen take) and `bpm` and `key` are optional; `text` and `seconds` are the game's
starting point. Tracks are always instrumental (no lyrics). `bpm` and `key` ("D major") are passed
to ACE-Step as its own fields; their allowed values are settled in 12.2. A stinger is at most 10
seconds.

**Edits** (`content-studio/music/edits.json`, read and written by the studio): what the studio
changed of a track's brief, length, tempo and key, `{ id: { text?, gameWas?, seconds?, bpm?, key? } }`,
like a line's cue over a character's style; `null` for `bpm` or `key` means none, over the game's. A
field changed on the track's page is saved as the field is left and marked "changed here"; "use the
game's", or a value typed back to the game's, removes it again. A reworded brief is saved as `text`
with the game's brief it was written over (`gameWas`). When the game's brief later differs from
`gameWas`, the track's page says "The game's brief changed since you changed yours." with the game's
brief now, **Use the game's** (the studio's brief goes) and **Keep mine** (`POST
/api/music/tracks/:id/keep-mine`: the studio's stays, `gameWas` becomes the game's brief now), and
its list shows "game's changed" beside the brief, as sound effects and images do. The game's lists
are never written. Validated like every resource and written through `writeAtomic`, one track per
line in id order.

**Pages.** The sidebar lists a workspace's acts only while one of its pages is open (Narration's
acts the same way); on Setup and the project pages both are folded. Each act shows how far it is,
done out of all: a narration act its lines that are ok in the language shown ("620/624", read with
`GET /api/narration/progress?language=` every few seconds while the acts are listed, its line count
until then), a music act or Stingers its tracks with a take chosen and up to date, an images act its
images chosen and up to date out of all (those the game's lists disagree on counted, never done). A count is green when all are done, red when fewer than three
quarters are, yellow between (an empty list has no colour). At the top of each list's page the
same count stands large beside a ring filled to the share done, the other statuses' counts in chips beside it ("Lines up to date 620 / 624" on an act's narration overview, "Tracks up to
date" on a music act or Stingers, "Images up to date" on an images act) and, while some need
attention, says how many ("4 need attention ›") and links to them: the act's lines page, which
opens on the lines needing attention, or the same music or images page with `?show=attention`,
which lists only the tracks not chosen and up to date (or the images, with those the game's lists
disagree on), with "Show all" back. Music opens into the acts and
Stingers, a page each, listing its tracks
with their status (see Status below). An act's page has **Refresh from the game** when the project
has `refresh.part`: the same command as Refresh dialog, which brings the act's lines and loops
together, and its summary names the loops added and removed besides the lines. A refresh of an act
and takes being made for its tracks refuse each other, as a refresh and a generation do, and so do a
refresh of the stingers and takes being made for a stinger. A project without a `music` section
shows Music with a page saying how to add one. **Plays.** Each row of a list has a **Plays** column saying what its play button plays: the chosen
take ("Take 3", even when the brief changed since), else the game's own `file` ("The game's file"
with the name beneath), else nothing ("Nothing to play yet", no button). A file that is
not on disk when the page loads is marked "The file is not there." and has no button either; the
empty cell keeps the column aligned.
Play runs once from the start (a loop too), one row at a time, and stops on leaving the page; a
play that fails says so in its row. The audio is `GET /api/music/tracks/:id/current`, which the
studio resolves itself from the row (the page sends no path). A track opens its own page (built: its Brief panel and its Takes panel; its board: the In the game block with Un-choose, Make N more takes, Stop, Drop, Choose, earlier-brief marks, and an amber box above the Takes panel when the track changed since its take was chosen, with
**Accept** when what changed is the brief, tempo or key: `POST /api/music/tracks/:id/accept`, in the
board's turn and the project's choice turn, writes those into the lock entry's `inputs`, so the
chosen take counts as made from them and the track is up to date with the same music; a changed
length needs a new take, so the box says so and offers no Accept, and the service refuses it (409),
as it does a track with nothing changed or none chosen).

**Takes.** A take is the brief generated with a new seed, and shaped at once, so what is heard on
the board is what the game will play:

- a **loop** is generated 20 seconds longer than `seconds`, since every take closes as a song does
  (in the spike, fading from 5 to 14 seconds before its end). It is cut at `seconds`, and the
  4 seconds after the cut are crossfaded over its start, so the end runs into the beginning
  without a seam and the loop is `seconds` long. The crossfade is equal power, so where both sides
  are loud it sums past full scale (ACE-Step peaks a take at −1 dBFS): the blend is held at full
  scale there, never wrapped round to the other sign. The board plays a loop take around its seam (its
  last seconds, then its first) as well as from the start;
- a **stinger** is generated at ACE-Step's shortest, 10 seconds, and cut at its own end (its
  trailing silence trimmed) or at `seconds`, whichever comes first, with a short fade-out (a
  fanfare asked for at 10 seconds ends after about 6).

The numbers are fixed in `core/musicTake.ts` and its tests (built, 12.4). A take is cached in
`content-studio/cache/music-takes/<track>/<hash>.<n>.wav` by a hash of its inputs (brief, kind,
seconds, bpm, key; the hash still begins with Balanced's recipe, so choosing a model never changes it) and a take number counted from 1 per hash, with `<hash>.<n>.json` beside it
(seed, length, waveform bars). The same seed does not make the same take again on the Mac, so the cache keeps the take
itself; the seed is kept with it, in the board and the lock, to say where it came from (absent from
a take whose model takes none, as ElevenLabs' will not, §8.6). The brief a
take is made from is the game's with the studio's changes over it. What is built is the Takes panel on a track's page: "Make N takes" (when there are none) queues N, 1 to 6 from the count menu (as-3ek),
made one at a time on the GPU queue, each a dashed card with a progress bar (about 3 minutes
expected, a guess) and its time left, then a card with play (a loop take comes round until stopped,
sample for sample on Web Audio, with the take fade at its start and stop only), its waveform (a loop's seam
marked, and a line where it plays while it plays), its length and, for a loop, **Hear the seam** (`GET …/takes/<file>?seam=1` is the last 4 seconds
followed by the first 4, one WAV). A take that fails is kept as "could not be made" with the
generator's reason and **Try again** (remakes that number, from the brief as it is then, under its hash); the other takes stay, and every failed take stays shown with its Try again when the brief changes (as-cgl). Takes are made from the brief on disk, so a press of Make or of a failed take's Try again first sees every field of the Brief panel saved, as an image's prompt is (§8.7): both buttons and Make's menus are off meanwhile, and no takes are asked for if a field could not be saved or cannot be read (as-ygl). A worker the
computer killed (exit code 137, most often memory running out) says so in plain words, never its
log: "The music generator was stopped by the computer, most likely because it ran out of memory.
Close other music jobs, then Try again." The making state is
in memory (a restart forgets a failure, not a take). The board for a track shows its
takes as cards: The count menu ("Number of new takes", between the model menu and the button) starts at 2 and keeps what was picked after a press; it is page state, never remembered. **Make N more takes** generates N more (two by default, about six minutes), made in the background, so
the page can be left meanwhile; **Drop** removes one (not the chosen one); **Choose** writes one at
once, without asking, since the take it replaces stays on the board to be chosen again. Takes made
from an earlier brief stay, marked "earlier brief". The board is kept in
`content-studio/cache/music/<track>.json` (a track id is a safe file name): `{ next, takes: [{ n, hash, seed?,
seconds, peaks, inputs, model, movedFrom?, trim? }] }` (`model` is the recipe of the music model that made the take, which Choose records in the lock; a board without it is read as Balanced, the only model there was), the take's WAV beside the others in `music-takes/<track>/`. Take
numbers are per track and never reused (`next` is reserved when takes are asked for), and a take
is on the board only once its WAV is written. The cache no longer keeps a sidecar file per take. A dropped take is just gone:
seeds don't come back, so nothing is ruled out.

**Trim silence** (built, as-k7i.1; stingers only, not loops): every stinger take card, and the take in the In
the game block, has **Trim silence** at the left of its bottom row. One press cuts the near-silent start and
end of the take (`core/musicTrim.ts`: samples at or under 300 of 32768, the level a stinger's last sound is
found by, count as near-silence; 0.05 s of lead-in is kept at each cut, and a side with under 0.05 s to cut
is left alone; "nothing to cut" and "near-silent throughout" grey the button with the reason). The take's WAV
stays as generated; the cut is kept on its board entry as `trim: { start, end }` (seconds cut from each end),
so it survives a reload and travels with Move…, and **Undo trim** removes it. The view carries `trim` (with the
length left) or `trimmable` (`cut`, `nothing`, `silent`, scanned once per file and cached in memory); the card
shows the waveform at its full width with the cut ends hatched, the new length (m:ss.s), a "trimmed" tag and a
line saying what went from each end. Play uses `GET …/takes/:file?trimmed=1`, the part between the cuts.
**Choose** cuts the WAV before encoding, so the game's file holds the trimmed sound and the manifest the
trimmed duration; Trim silence and Undo trim on the take already in the game re-commit it (the same
`commitChoice`) first and write the board only if that worked, so a failure leaves both as they were.

**Move a take** (built, as-824): a take that is made, not chosen and not dropped can be moved to another track of
the same kind (loop to loop in any act, stinger to stinger) from the **Move…** button on its card, which opens a
dialog listing the game's other tracks of that kind with their status and length. A move is a move, not a copy: the
take leaves one board and joins the other's, as that track's next number (`max(next, the numbers being made there +
1)`), keeping its sound, seed, model, length and peaks, but with the destination's hash and inputs, so it counts as
made for that track's brief (never "earlier brief", and choosing it reads plain "chosen"); a later change to that
brief marks it as for any take. Its board entry gains `movedFrom: { title, n }` (the track's title as it was and
the take's number there), kept for good and shown on the card and the In the game block. The service takes both
boards' turns in sorted order, refuses the chosen take, an unreadable lock, a destination or source whose list is
being refreshed from the game, and a kind mismatch, and writes the destination's WAV, then its board, then the
source's board, and removes the source's WAV last, so a failure part-way leaves the take on both boards, never on
neither. The manifest, lock and clips are not touched. The page stays on the first track and says where the take
went (a line that is not kept across a reload).

**Fades of a stinger take** (built, as-k7i.2): every stinger take, and the chosen one in the In the game block, has a **Fades…** button that opens an editor in place of the card's waveform and buttons (loops get none): play it with the fades as they stand, a taller waveform with a draggable handle at the inner end of each fade, boxes for Fade in and Fade out (0.05 s steps; 0 is no fade) and a Shape menu (Smooth, a raised-cosine curve, or Straight, a linear ramp; one shape for both fades). Fades belong to the take: its board entry gains `fades: { in, out, shape }` (absent when it has none; `core/fades.ts`), kept through a move, gone with a drop, and never in the lock or the manifest, so a fade never marks a track "changed". The take's WAV on the board stays as generated. `applyFades` (pure) turns the WAV and the fades into the sound the game plays; **Choose** encodes that sound, so the game's `<track>.mp3` always holds the faded sound, never settings for the game to apply. `PUT /api/music/tracks/:id/takes/:file/fades` saves (`DELETE` removes, back to the take as generated); both run in the board's turn, refuse a loop, a take that is not there, lengths together longer than the take or negative, and a lock that cannot be read. When the take is the chosen one the game's file is written again first (the lock untouched) and the board second, so a failed encode changes nothing, and a board that cannot be written puts the game's previous file back (as-1wo: a failed save leaves the game byte-identical; if even that fails the refusal carries `gameChanged`), answered as a refusal with its reason ("The take board could not be written."), not a bare 500. A failed save or remove shows its red failure line above the editor's hint (as-8og). On the chosen take the failure line adds "The game still plays Take n as before." ("with its fades" for Remove fades), and nothing about the game when `gameChanged`. While the editor is open in the In the game block, the block shows the "fading" chip, and neither its own button row nor its line about Un-choose is rendered. `GET …/takes/:file?fadeIn=&fadeOut=&shape=` serves the take with those fades in its sound, so the editor and the cards play what the game will; a take with fades of its own plays without Setup's playback fade (`takeFade`), on its card, in the editor and in the In the game block. A trimmed take is faded after the cut: the fades' lengths are of the part between its cuts, the editor draws that part, and the game's file is the trimmed sound with the fades over it (`playedOf` in `services/musicTakes.ts`; `?trimmed=1` serves only the cuts, so fades asked for in the same address are not applied twice). Saving fades on the chosen take rewrites only its music file (`commitChoice` with `soundOnly`): the manifest and lock, an Accept included, stay as they are. One editor is open at a time (the other Fades… buttons are greyed with the reason), and while the lock cannot be read Fades… is greyed with Choose, Drop, Move… and Trim silence.

**Choose** levels the take to −20 LUFS as narration is levelled (`level.py`'s commands; RetroQuest
levels its music to −20 today) and encodes it into the clips folder as `<track>.mp3`, stereo,
160 kbps, with ffmpeg's LAME encoder, which writes the header that tells a decoder how much
padding to drop. Chrome decoded such an MP3 to its exact length (80.000 s, no silence at either
end, against the WAV), so the game loops it without a gap through Web Audio; a looping `<audio>`
element is not relied on. Safari and Firefox are checked with the game (12.8). As for narration,
the encoder writes a hidden temporary file in the clips folder, renamed into place together with
the manifest and lock update (built, 12.6): the temporary file is renamed over the clip, the manifest written, the lock last, all in one turn per project. A failure of the encode, or of reading the manifest or lock, leaves everything as it was (Choose and Un-choose then say which of the two could not be read and that nothing was changed, the manifest first when both are broken, as-kvz); a write that fails after the rename (a full disk) leaves the new clip beside the old lock, and choosing again repairs it. A take is chosen and dropped in the track's board turn, so neither slips between the other's check and write, and a drop is refused while the lock cannot be read. **In the game** (as-7o1): what the game plays is shown on its own block between the Brief and Takes panels, and the Takes panel lists only the takes that are not chosen (a drop of the chosen one is still refused, 409). The block is one of three things, from the track row (`inTheGame` in `core/musicChoose.ts`; `TrackRow.gameFile` is the game's own file whether or not a take is chosen): the chosen take (green, "chosen", play, waveform, length, Hear the seam, **Un-choose**), the game's own file when none is chosen (green, "The game's own file" and its path, no Un-choose; amber and "The file is not there." when it is not on disk), or a dashed "Nothing plays here yet", also on a brand-new track. While the music lock cannot be read, what a track plays is not known (`CurrentMusic` `unknown`, as-77u): the block is amber, "The music lock could not be read", with no Un-choose (an Un-choose pressed before the lock broke is refused, 409, and its red "Take N could not be un-chosen: the music lock could not be read. Nothing was changed." stays under that amber block after the page re-reads, with focus on the block), and the list's Plays cell says "Not known", never the game's own file, since the lock is what says a take is chosen (as-x73): the same holds elsewhere: every track's Status chip says "not known" (amber) and the list's line says which are chosen is not known instead of counting; the Takes panel (`MusicTakesView.lockUnread`) lists every take, the chosen one among them, with Choose and Drop disabled and one amber line saying why once there is a take card. A chosen take whose clip is gone turns the block amber ("music file missing") with Un-choose and **Choose again**, which writes the file again. **Un-choose** asks first, since it deletes the take's music file from the game, then (`POST /api/music/tracks/:id/unchoose`, in the board's turn and the project's choice turn) deletes the manifest entry, the clip and, last, the lock entry, so a failure part-way can be pressed again; a write the disk refuses (a read-only folder, a full disk) is said as "the game’s file could not be written", never the system's error and a temporary file's path (as-8ql); the take stays on the board, to be chosen or dropped, and the game goes back to its own file or plays nothing. The game's own file is never un-chosen, written or deleted. A track with no chosen take is refused (409). Clips are served only as plain files in the music clips folder (`GET /api/music/clips/<track>.mp3`: no folders, links, hidden files or the manifest). **Red failure lines** (as-usv): a track's page shows at most one, the line of the action pressed last (Choose, Choose again, Drop, Trim silence, Undo trim, Save fades, Remove fades, Un-choose once confirmed, Make more takes, Stop, Accept, Move once confirmed). The Takes panel holds the last pressed action's key (`ui/features/music/trackActions.tsx`, a context for the cards, the In the game block, the Fades editor and the Move dialog); each line shows only while its key is the last, so opening or cancelling an editor or a question clears nothing, and the lines never outlive the page.

**Status** of a track, from the lock and its takes: "chosen" (`ok`), "not chosen" (no take chosen),
"changed since chosen" (`changed`; the track's page says what changed: the brief, length, tempo or key), "music file missing" (a take was chosen but its clip is gone from disk), "not known" (`unknown`, amber, while the music lock cannot be read), and "making 2
takes" while its takes are being made. **Stop** stops the track's takes: the one being made ends at once
(the music worker is stopped, and starts again with the next take) and is discarded, nothing on the
board or on disk, and the ones waiting never start; the takes already made stay. A take that fails says why, and **Try again** makes it again; the other takes
are kept. Without ACE-Step or its models on the computer, a track's page says so, with **Open
Setup**, and takes cannot be made.

**Manifest** (`manifest.json` in the clips folder, what the game reads): `{ track: { file,
duration } }`, its layout fixed once written. The game decides where a track plays, so the kind is
not in it.

**Lock** (`content-studio/music/lock.json`, committed, one entry per line, `{ fp, model, seed?, list,
take, inputs, at }` as project-files.md gives it, `inputs.text` being the brief and `list` an act's
id or `shared` for a stinger): per track, the chosen take's model,
seed (when its model takes one), the number of the take on the board, a hash of what went into it (brief, kind, seconds, bpm, key; not the output settings,
as narration leaves the loudness out; the chosen take's own inputs, so a take from an earlier brief
leaves the track "changed since chosen"), which list it came from (an act or the stingers), and when
it was chosen. The model is not a cause: a take keeps the model that made it, and changing the project's model (or
making takes with another) never marks a track `changed`. A track is `not-chosen` (no lock entry), `chosen`, `changed` (its brief, length, tempo or key
differs from the chosen take's own: the old one keeps playing in the game until
another is chosen; the page says which) or `missing` (a take was chosen but its clip is gone from
disk, which is said ahead of `changed`). A manifest entry without a lock entry is reported as a problem (with the orphans, 12.7).
Nothing is generated again by itself: a new brief means new takes. A track the game no longer lists,
while its list is there, is an orphan, shown on the page of the list its lock entry names under
"Music the game no longer asks for" (built, 12.7): a play button, its name (its id as words, since
the lock keeps no title) with its file name under it, when it was chosen, and **Remove**. Remove
asks first ("Remove the music for Castle gates?", saying what goes) and then deletes, in this
order so a failure can be repeated, its manifest entry, its clip, its board and takes and its lock
entry, then its edits entry (which the next save of the edits would drop anyway) (`POST /api/music/tracks/:id/remove`, 404 for a track that is not
an orphan; a manifest or lock that cannot be read deletes nothing). A list that is missing or
unreadable has no orphans, and one another list names is not one. The edits and board of a track
never chosen that no list names are dropped at the next save of the edits, and only when every
list is there (which list named a track never chosen is not known); while a list is missing,
nothing is dropped.

**Make takes for every track with no chosen take** (as-23x.1): the "Tracks up to date" panel of an act's
page and of the Stingers page has, on its right, "N tracks have no chosen take" and **Make 4 takes each**.
The press only opens a question in the panel (the total, the model and the time, or on Eleven Music
that ElevenLabs bills each take and the total price on the button; the tracks by name; who is left out
and why); **Make N takes** then calls `POST /api/music/lists/:id/make-all`, which runs `planMakeAll`
(`core/musicMakeAll.ts`) on the list: four takes (`TAKES_EACH`) through the ordinary `make` for every
track whose status is `not-chosen` (a changed or missing chosen take counts as chosen), that is not
already making takes and that the project's model can make at its length (`canMake`); nothing is
started if music cannot be made yet (`GET /api/music/model-state`), and if one track fails to start
those already queued are stopped (the page says nothing was made). While any track of the list is
making takes, the panel shows the running line and **Stop all** (`POST /api/music/lists/:id/stop`,
every waiting or running take of the list) instead of the button; it is worked out from
`GET /api/music/making`, which now also counts each track's failed takes (`MusicMakingSummary.failed`,
a track with only failed takes has no "making" chip), so it survives a reload. The latest press of each list is
remembered by the running studio (as-4m0; `contentStudioMusicBatches` in `services/musicTakes.ts`, one per
list, so an act's page and the Stingers page each have their own; `GET /api/music/lists/:id/batch`):
total, tracks, failures before it, the press's own takes that were stopped, by Stop all or on a track's
own page (each take Make all starts points at its press, and `stop` counts it there, so takes
started by hand, on any track, are not, and a take stopped is never counted as made; as-z1l), and `running` while any of
those tracks has a take waiting or being made. The page shows the summary line ("Made 14 of 16 takes.
2 could not be made — X says why.") whenever the press is there and not running, so a reload, a new tab
or a page opened later shows it too, until Close (`POST /api/music/lists/:id/batch/close`, for every
tab), a new press, or takes started by hand on a track of the list (they end a finished summary for
good; a press still running is left alone). A quit forgets it, like a failed take; nothing is written to
the project. Open tabs poll it (3 s while takes are made, 5 s while a summary shows) so a Close elsewhere
arrives. A take stopped from a track's own page during a press counts as made in it.

On the Stingers page (as-23x.2) the same panel says "stinger" throughout (heading "Stingers up to
date", column "Stinger", every line of the press: `Noun` in `ui/musicMakeAllText.ts`), counts the
whole page whatever the "needs attention" filter, and never leaves a stinger out for its length (all
fit every model). Refresh from the game and the press exclude each other there, and the page shows it
before anyone presses: while any stinger take is being made (from `GET /api/music/making`, so also
takes made by hand) Refresh from the game is greyed, and while the refresh runs **Make 4 takes each**
and an open question's **Make N takes** are greyed, each with its reason as hover text and accessible
description (`aria-disabled`, so they stay focusable). An act's page does not do this.

**Generator.** `MusicGenerator` (`services/music.ts`) generates one take as a WAV, from the brief,
kind, seconds, bpm, key and seed, so tests run with a fake. The real one is a Python worker
(`worker/music.py`, ACE-Step through uv, the models loaded on the first take and stopped with the
studio), the same JSON-lines protocol as the Whisper worker. Both workers run in the studio's own
`worker/` folder, not in the game's repository the studio runs from, so what they write beside
themselves (ACE-Step's `.cache/acestep/progress_estimates.json`) stays with the studio, ignored by
its git. Every local worker (music, sound effects, Whisper, and each image take) runs in its own
process group (`services/stopWithStudio.ts`), so stopping it stops what `uv run` started too, and
the studio stops every one on exit, Ctrl-C, SIGTERM and its terminal closing. Each request names
the pair of models to make the take with (`dit` and `lm`, folders in the checkpoints folder); the
worker loads a pair on the first take that needs it and swaps it, freeing the
old, when a take asks for another. The pairs are the **music models** (`core/musicModels.ts`), each a
plain name, the generator's own names and a time per take: **Balanced** (XL turbo, 4B planner: the
model of decision 5, the default), **Quick** (XL turbo, 1.7B), **Quickest** (turbo, 1.7B) and
**Careful** (XL sft, 4B). Only Balanced's time was measured; the others are the agreed estimates.
The project's model is `music.model`; a track's Takes panel has a menu "Model for new takes" that starts
on it, holds while the page is open, and applies only to the takes being asked for; each take card
names its model; Try again remakes a take with its own. A model whose folders are not on the
computer is marked "not on this computer", can still be the project's default (a teammate may have
it) and cannot make takes here. The closed menu shows a short label (`shortMenuLabel`: the plain name
and the time, or why the model can't be used) so it fits beside the button in a narrow window; the
opened list keeps every entry in full, so the label is dropped while the list is probably open
(on a click, Space, Enter, F4 or an arrow key) and comes back on a pick or when the menu loses focus; a
list dismissed without a pick shows the full label until then.

**Stable Audio Open** (as-ui4) adds two models of another generator: **Short** (Stable Audio Open
1.0, about 47 s of music at most) and **Shortest** (Stable Audio Open Small, about 11 s). Each
`MusicModel` has a `family` and a `longest` piece in seconds; a loop is generated
`LOOP_EXTRA_SECONDS` (20) longer than it plays, so Short makes loops up to 27 s and Shortest none, and
every stinger (at most 10 s, generated at 10) fits both. `canMake`/`lengthReason` (`core/musicModels.ts`)
decide it: a track's menu greys a model that cannot make its length with the reason ("makes loops up
to 27 s · this one is 1:30", which wins over "not on this computer"), the track's line says why when the
picked model, Setup's included, cannot make it and the make button is disabled until another is picked, and
`make` refuses it too. Setup's menu greys nothing and, while a Stable Audio model is the default,
says how many of the project's loops (`modelsView`'s `loops`) are longer. The menus are two groups,
"ACE-Step · any length", "Stable Audio · short music only" and "ElevenLabs · in the cloud,
paid" (§8.6). A second worker
(`worker/stable_audio.py`, `services/stableAudio.ts`, stable-audio-tools through uv, offline: no
token is read) loads a model from its own folder in `~/.cache/stable-audio` (fixed, one named folder
per model, downloaded by the user after accepting Stability AI's Community Licence); `createMusicRouter`
sends each model to its family's worker and stops the other worker when the family changes, so only
one holds memory. The worker pins its libraries: stable-audio-tools 0.0.20, with pytorch-lightning
2.5.5 (0.0.20 imports it without declaring it) and numpy below 2 (its PyWavelets 1.4.1 is built for
numpy 1), and uv's `exclude-newer` holds the rest to the date they were last tried together, so a
fresh install gets the libraries that made takes; `musicLive.test.ts` makes one take per downloaded
model, opt-in. It guides with plain classifier-free guidance (`apg_scale=0.0`), since 0.0.20's
default APG needs float64, which the Mac's GPU lacks. Takes are shaped as ACE-Step's are and record
the recipe `stable-audio-open-1.0` or `-small`. Short's time per take, about 100 s, is measured: the
effects spike measured Open 1.0 at 95–112 s a take (§13 decision 9), since it always makes its full
47 seconds at 100 steps. Shortest's 10 s is still an estimate, not measured. ACE-Step and Whisper
share the one GPU and never run at once: both workers stay loaded, and one queue (`services/gpu.ts`,
a process-wide `createSerial` key; Whisper's checks reach it through `onGpu`) runs a take or a
Whisper check at a time. In the spike, with both loaded and running together, 42 of the 48 GB were
in use (20 GB of it compressed), and Whisper ran 2.5 times slower. The setup checklist (§10) names
ACE-Step's environment and its model download, and, in its own optional row, Stable Audio's.

### 8.6 ElevenLabs (planned, step 14)

ElevenLabs is a second, hosted provider, beside Fish for narration and beside the local models for
music. Nothing changes for a project that does not use it, and nothing already recorded or chosen
changes.

**How it is paid.** A plan includes an allowance of characters each period (Starter 30,000 a month);
the API's own pricing says usage is billed in dollars ($0.08 per 1,000 characters for Eleven v3 and
Multilingual v2, $0.04 for Flash, music $0.15 a minute, October 2026), and usage beyond the
allowance is billed only if the account allows it. The studio therefore counts **characters**
against what the subscription reports (`character_limit − character_count`), and shows dollars for
what would go beyond it. Which of these the account actually draws on is checked by the user in step
14.2, and the plan changes there if it is wrong.

**The key.** `ELEVENLABS_API_KEY`, read as Fish's key is: the environment wins, else the project's
`env` file, never stored. Setup has two optional rows, as Stable Audio has: _ElevenLabs API key_
("Not set up" until there is one) and _ElevenLabs_, which reads `GET /v1/user/subscription` and
shows the plan (`tier`), the characters left and when they renew, whether usage beyond them is
billed (`max_credit_limit_extension`: 0 is no, a number is up to that many, `"unlimited"` is without
limit), the voice slots used, and what the plan allows: on Free, no music through the API and no
commercial use; on every self-serve plan, music in a game only while the game has earned under
$500,000 and its developer under $1,000,000 a year from games (ElevenLabs' music terms of 9 October
2026), beyond which ElevenLabs' Enterprise Music plan is needed. The subscription is read for Setup
(and so for the sidebar's count of Setup's problems, from a check at most five minutes old, as
Fish's credit is; a key ElevenLabs refuses counts as one), for a confirmation and for admission,
with a 10-second limit, since Setup waits for it beside Fish.

**One client.** `services/elevenlabs.ts` is the only code that calls ElevenLabs
(`https://api.elevenlabs.io`, header `xi-api-key`), behind an `ElevenLabsClient` interface faked in
tests as `FishClient` is: `subscription`, `tts`, `voice` (one of the account's voices by id, as
the studio's `Voice`), `sharedVoices`, `addSharedVoice`, `deleteVoice`, `designVoice`, `saveDesign`
and `music`. It retries a 429 as Fish's client does. Its work runs in
its own limiter (`elevenWork`), so neither provider waits for the other, at most two requests at
once (the Free plan's limit, which every plan allows; higher plans allow more, which the studio does
not use until it is measured) and never more than `generate.parallel` (`requestsAtOnce`). Speech is asked
for as `wav_24000` (every plan may ask for it; 44.1 kHz needs Pro), so lines join, are checked and
encoded as Fish's are. Music is asked for as `mp3_44100_128` (every plan; the default 192 kbps needs
Creator) and decoded with ffmpeg to 16-bit WAV before it is shaped; it is encoded at 160 kbps when
chosen, as every take is.

**Models, per provider.** Each provider's prices are a table of their own, in their own unit: Fish's
stay `core/prices.ts` (dollars per million bytes), ElevenLabs' speech models get a table beside it
(credits per character, `core/elevenSpeech.ts`, built in 14.7a), and Eleven Music's price per minute is on its music model
(14.5). A stage accepts only its own provider's models: `narration.models.fish` (Fish's, as
today) and `narration.models.elevenlabs` (`audition`, `draft`, `final`; default `eleven_v3`) are
validated and listed each against its own provider's list, so Fish is never sent an ElevenLabs
model.

**Narration: per voice** (built in 14.6 and 14.7a: the ids, the stage model, the settings, the
speed, and speaking). A character's voice says whose it is. An ElevenLabs voice is stored as
`eleven:<voice_id>` (in `cast.json`, its languages, the lock, sessions, ruled-out voices and take
keys); a bare id is Fish's, so every existing file stays as it is. `core/voices.ts` (`providerOf`)
is the one place that reads the prefix; the server's voice-id check and the UI's voice links follow
it (an ElevenLabs voice has no public page to open). A line is recorded by its voice's provider,
with that provider's model for the stage. Recasting a character from a Fish voice to an ElevenLabs
one makes its lines stale for the voice, as any recast does; since a model is valid for one provider
only, the fingerprint needs no provider of its own.

- **Settings** (saved from Setup since 14.9.2). ElevenLabs' voice settings, `narration.generate.elevenlabs`
  (`stability`, `similarityBoost`, `style`; defaults 0.5, 0.75, 0, ElevenLabs' own), are one set for
  every ElevenLabs voice at every stage, and stand in for temperature and top-p in an ElevenLabs
  line's fingerprint and take key, so changing them puts every line recorded with them out of date
  (stale for its `settings`). Stability is one of 0, 0.5 and 1 (Creative, Natural, Robust), the only
  ones Eleven v3 takes; similarity and style run from 0 to 1. The Models panel's ElevenLabs voice
  row (`docs/ui/elevenlabs-voice.html`) edits them and saves them with its own button
  (`PUT /api/elevenlabs/tts` with `{ tts, was }`, refused while a part records or a character
  auditions), at once, or after a question naming each change, the lines recorded on an
  ElevenLabs model in use that go out of date and the credits to record them again on that model
  (`elevenSettingsChangeOf`). The speed in use (the character's, else the project's
  `narration.generate.fish.speed`) is sent as `speed`; ElevenLabs takes 0.7–1.2, so a character with an
  ElevenLabs voice whose speed in use lies outside it has each of its lines refused when recorded,
  with the reason, and its page says why under its speed. Nothing is clamped.
- **Cues** (built in 14.8). Eleven v3 reads `[bracket]` tags as directions, as Fish does, so cues
  are sent as they are. Multilingual v2 and Flash would speak them (`readsCues`), so with those
  models cues are left out of the text and out of the fingerprint (`clipInputs` gives `cue` and
  `inside` empty), so editing a cue never re-records audio that would not change, and out of what a
  plan counts (`sentPieces`). The page still shows a line's cues (`cueInputs`), and from 14.9, when
  such a model can be chosen, the cue editor says they are not spoken. The text is chunked at
  `generate.chunkLimit` as for Fish.
- **Languages.** Each language's voice may be either provider's; `language_code` is sent with models
  that take it.
- **Credits, confirmed** (built in 14.7c). A part's plan prices each line by its voice's provider
  (`elevenModelOf`): Fish's lines in dollars as before (`bytes`, `cost`, `ceiling`), and the lines
  with ElevenLabs voices in credits (`plan.eleven`: their keys, the model, the characters sent, the
  credits of one take each and at most, every take). The plan's answer carries the account
  (`elevenAccount`, read at most every half minute, since a part's plan is asked for again after
  every line) and the credits running recordings and audition sittings hold (`elevenHeld`), so the panel says what the
  plan has left besides them ("27,450 credits left on your plan", "only …" when it falls short). One confirmation agrees to both ("Pay up to $0.42 and 1,200
  credits", or "Use up to 1,200 credits" with only ElevenLabs lines paid), sent as `confirmedCost`
  and `confirmedCredits`; a line's Record and Another take ask in the unit of its voice's provider.
  The server admits each in its own unit (`admitBoth`): the dollars against Fish's credit as
  before, the credits against what the plan has left (`creditsLeft`: what it includes and has not
  used, plus the allowed overage: none, a number, or without limit) less what running ElevenLabs
  recordings were given, all of which is held back until they end. Each line is charged to its
  provider's budget before it is sent. Whether running music takes draw on the same allowance is
  checked by hand (step 14's test script); they are not counted yet. If ElevenLabs refuses a
  request (its quota among the reasons), that line fails with ElevenLabs' words.
- **Page takes and tries** (built in 14.10a, `docs/ui/elevenlabs-takes.html`). Fish's are made
  with its free model. ElevenLabs has none, so the cast voice's take on its character's page and
  a cue try (Hear it, in the cue, scene cue and cue-inside editors) with an ElevenLabs voice use
  `narration.models.elevenlabs.audition` (chosen on Setup's ElevenLabs audition row, saved at
  once, since 14.10b-1) with the project's voice settings at the character's
  speed (refused, with the reason, outside 0.7–1.2), in ElevenLabs' requests at once. They are not
  confirmed (a try is a line's worth of characters). On a model that would speak cues the text is
  sent without them (the style, the opening cue and the cues inside) and the page says so. The
  page take's model and credits are on the Voice panel before it is recorded (`elevenPageTake`);
  a try says after it what it was said with and cost (`triedNote`). Each kept in the take cache
  under a key that adds the voice settings, and the language for a model told it, to Fish's (a
  Fish take's key is as it was), as
  ElevenLabs' WAV: `GET /api/takes/:file` serves a file that starts with `RIFF` as `audio/wav`. One
  already kept costs nothing. What one costs is added to the spending record's `tries` as soon as
  ElevenLabs has made it, even if it then cannot be kept. Board
  takes with an ElevenLabs voice (14.10b-2) are the same take, on the same key, paid from the
  audition's sitting in credits instead: `start` takes `creditsUpTo` beside `spendUpTo`, `POST …/sitting`
  a fresh sitting's `{ amount?, credits? }` (its dollars needed on a paid model, refused with
  nothing to give on a free one), and `…/sitting/add` `{ amount }` or `{ credits }` to top it up.
  A start or a fresh sitting admits both halves before replacing either, so a refusal leaves the
  running sitting as it was, and its old credits are not counted against the new, but for
  its takes in flight: those stay held, also once their sitting has ended, until each lands
  (ElevenLabs may bill them all the same). The credits are admitted as a recording's are (what the plan has left, less what running
  recordings hold and what sittings have left and have in flight), checked and held in one step
  (`holdCredits`), and charged to the take just before it is sent, given back when ElevenLabs
  fails; one that does not fit waits ("Take waits for more credits"), a request that shared another's
  unpaid run tries again with its own money, and only the request that paid reports the credits;
  a sitting given credits for another audition model than the project's now asks to be resumed; and without credits a board
  take of an ElevenLabs voice is refused (`no-sitting`). Ending the sitting (Pause, Stop, Cast,
  `DELETE …/sitting`) ends its credits too. The sitting's view adds `eleven`: ElevenLabs' audition
  model, a take's credits, the credits to suggest (about 50 takes, to the next hundred) and the
  sitting's credits. Each board take that cost credits is a row of the spending record's `tries`
  (`audition`). On the board (14.10b-3, `docs/ui/elevenlabs-audition.html`) the credits are asked
  for only when they are needed, not by Start: while the sitting has none, ElevenLabs voices on
  the board without a take say "Take waits for credits", record nothing, and a bar above the
  voices says how many wait, what a take costs and what is left on the plan (`GET
/api/elevenlabs/account`: the account as plans show it and the credits running recordings and
  sittings hold), with "Use up to N credits". It is `…/sitting/add` `{ credits }`, which, for a
  sitting that has none yet and an audition that is going on, admits them as a fresh half beside
  any dollars, so a Fish-only audition never asks and an ElevenLabs outage never stops one. While
  a paid model's dollars are asked for (the resume box), the bar waits until they are given,
  since that box's fresh sitting would end credits given before it. Once
  given, those voices record by themselves, and a second meter shows the credits (model, used of
  given, about N takes left) with Add when they are used up, as the dollars' meter does. The
  meters stay at the top of the board as it scrolls; the bar, much taller, scrolls away with the
  voices, so it never hides a card's title. A resume asks for them again the same way.

**Spending** (built in 14.7d). The log (`content-studio/cache/spending.json`) moves to version 2 when it
first needs to, with its first ElevenLabs credits or music take (`needsVersion2`), so a Fish-only
project's log stays version 1 and readable by an older studio (which cannot read a version 2 log,
and then logs nothing of its own). In version 2 a recording's row keeps its Fish dollars (`cost`)
and adds the ElevenLabs credits its lines took (`credits`) and their model (`elevenModel`): one row
per recording, since its lines are counted together; a recording on ElevenLabs alone is followed
and saved as a Fish one is. Music takes are a list of their own (`music`: when, the list, the
track and its title, the model, the seconds made and billed, the dollars at the model's price a
minute, and whether it was made (billed, also when the studio then could not keep it) or stopped
while being made, which may still be billed; a take that fails before ElevenLabs makes it costs
nothing and is not listed). Only credits spent are kept, so a recording given credits but
spending none stays a version 1 row. Takes and tries with ElevenLabs voices (14.10a) are a list
of their own too (`tries`: when, `take`, `try`, `audition` or, since 14.12, `design`, the character, a try's part, the language, the
model, the characters sent and the credits), absent from a version 2 log written before them. A
studio from before 14.10a reads such a log but drops `tries` when it next writes it; tries are
small and the bills are ElevenLabs', so this is accepted rather than a version 3. A
version 1 log is read with no credits, no music and no tries.
The Spending page and the sidebar total dollars and credits apart (`$0.78 · 1,200 credits`), for
all and per act, music takes in their act and stingers on a tile of their own once one cost
something; a recording's Cost and Model cells name the providers that spent, a take's Lines cell
says "Music take · The cave" and how long it was made. Takes and tries count in the totals and
on a tile of their own ("ElevenLabs takes, tries and designs"), never as rows: there can be
hundreds.

**Casting.** The audition board searches either provider (built in 14.11a,
`docs/ui/elevenlabs-library.html`: a switch beside Bring in more, _Fish Audio_, _ElevenLabs_; the
audition still starts from Fish's library, and ElevenLabs' voices come in a round at a time,
straight to hear, leaving Fish's queue as it is). ElevenLabs' search is its shared voice library (`GET /v1/shared-voices`: the
keywords, the board's language, gender and age when the character's brief names them), shown as
`Voice` cards with ElevenLabs' preview and its popularity (`cloned_by_count`, "added by 1.2k"),
each search term, two pages at most, pooled and ranked as Fish's are (the words that asked for the
gender and age count as matched by every voice found, since ElevenLabs filtered by them; "middle
aged" is one age). A library voice the studio added that is cast, or on the board under the id it
became, is not brought in again. Voices at a rate of their own (`rate` other
than 1, or a `fiat_rate`) are left out: they cost more credits than the studio counts. A library voice must
be among the user's own voices to speak, which takes one of the plan's voice slots, so it is added
(`POST /v1/voices/add/{public_owner_id}/{voice_id}`) only when the user makes its first audition
take, and the card says so before. Casting one not yet added adds it too (the confirm says so),
and the cast names the id ElevenLabs gave it. A voice the user had added already
(`is_added_by_user`) is spoken and cast by its library id and not added again, unless the studio
added it, when it is the id it became; once added, the board marks it so and no longer says a take
or cast will add it. When ElevenLabs
will not add one, its take fails with ElevenLabs' answer and its credits are given back, or it is
not cast. The studio remembers which voices it added (`content-studio/cache/eleven-voices.json`: the
library id, the id on the account, its name, the character and when), so each is added once. **Voice slots** (built in 14.11b): below Bring in more, once a library
voice is on the board or ElevenLabs' library is chosen, the board says how many of the plan's
slots are used (from the subscription's `voice_limit` and `voice_slots_used`). A voice the studio
added that nothing in this project uses (not cast for any character in any language, and on no
audition in progress, the last one dropped included since Undo brings it back, by either id) is offered
for removal, and freeing marks it as not added on every audition in progress, so a take or cast
adds it again; while the cast or a saved audition cannot be read, none is, the board naming them (another game on the same
account is not checked, and the confirm says so) ("Free 3 voice slots", confirmed before anything is
removed: `DELETE /v1/voices/{id}`, one ElevenLabs no longer has counting as removed), and never
one the user added on ElevenLabs. At the plan's limit the board says so, and the library voices
whose take would add them wait ("Take waits for a free voice slot", as many as slots are left
record; while the account is being read none does, and a take that may have added a voice counts
as a slot used until the account is read again, which the server then asks ElevenLabs for afresh,
as it does after a cast adds one or a free; if that read fails the board says so, with Try again),
recording by themselves once slots are freed. Whether a library voice can speak before it is added
is checked by hand at the end of step 14 (no key in CI); if it can, nothing need be added before
casting. **Add by id** takes an id from the
user's own ElevenLabs voices (one made or added on ElevenLabs' site), with the provider chosen
beside the field; a library voice is found by search. **Design** offers ElevenLabs beside Fish (built in 14.12,
`docs/ui/elevenlabs-design.html`: a switch at the top of the design box): `POST
/v1/text-to-voice/design` (`eleven_ttv_v3`, the description, MP3 previews) gives three previews,
kept as Fish's designs are (numbered, under the description, the preview as the design's take),
each with its `generated_voice_id`. The previews say the audition phrase, then the character's own
lines in the order of the parts, each once, until ElevenLabs' least of 100 characters (cut at a word
within its 1,000; `core/elevenDesign.ts`); when she has too few words ElevenLabs writes its own
text (`auto_generate_text`). A design costs a credit a character of that text, once for its three
voices (ElevenLabs' help centre), so the confirm names the credits ("Use 130 credits", or "Use up
to 1,000 credits" for ElevenLabs' own text), and the server holds them back from the plan while it
designs, as a recording's are, and sends the text it confirmed (not one made again since); the
description takes 20 to 1,000 characters there (ElevenLabs' reference names no limit; to be checked
by hand), checked before anything is held; what was charged (the text's characters) is logged in the spending
record's `tries` as a `design` (a studio from 14.10a to 14.11 cannot read a record holding one). An answer with no voices is a failure that may have been charged. Casting one saves it
(`POST /v1/text-to-voice`, named "Mara (designed)" each time, since ElevenLabs takes the same name
twice and the studio does not list the user's voices, a voice slot) and casts `eleven:<new id>`; a save that worked is remembered as Fish's
is, so a cast that then failed saves nothing twice. If ElevenLabs no longer takes a kept preview's
id, nothing is cast and its card says a design from an earlier session may need designing again. Cloning stays Fish's.

**Music** (built in 14.4, 14.5 and, the spending log, 14.7d). One more family, `elevenlabs`,
with one model, _Eleven Music_ (id `eleven`, recipe `eleven-music-v2.5`, `longest` 600 s, so loops
up to 580 s, no folders, no download, about a minute a take until measured), in its own menu group,
"ElevenLabs · in the cloud, paid". A take is `POST /v1/music` with `model_id` `music_v2_5`, the
brief (with the tempo and key added as `, 84 BPM, D major`) as `prompt`, `music_length_ms` from
`generatedSeconds`, and `force_instrumental`. A project naming `eleven` as `music.model` cannot be
read by an older studio.

- **No seed.** ElevenLabs takes no seed with a prompt, so a take's `seed` becomes optional (absent,
  not null) in the generator's answer, the board, the view, a move and the music lock; local takes
  keep theirs. A lock holding a take without one cannot be read by an older studio.
- **Ready.** `ready` and `installed` may answer later (a promise); the local generators answer at
  once, and Eleven Music (`services/elevenMusic.ts`) reads the project's key each time: the model is
  installed when the key is set, and ready then too; the account's state is Setup's, and a take that
  fails says why in ElevenLabs' own words (a Free plan's refusal among them). Its menu entry says
  "needs an ElevenLabs key" instead of "not on this computer", as does a refused make button. It runs
  on any computer, not only Apple silicon; Setup's Music row is off while the project's model is
  Eleven Music, and the Models panel's Music row says it is made in the cloud and is Paid.
- **No GPU.** The take queue chooses by family: local takes wait for the GPU as before
  (`musicTakes`, `queue.run(GPU, …)`), Eleven Music takes for each other only (a queue of their own,
  one at a time), beside local takes and Whisper. The router is a table from family to generator
  (built, 14.3), and a take made in the cloud stops no local worker.
- **Price.** A music model has a price a minute (`perMinute`: Eleven Music $0.15, ElevenLabs' API
  price; null for the free ones), and a take costs it for the whole take, the 20 seconds a loop is
  made longer included (`takePrice`). A track's menu entry says "about 1 min and $0.28 a take",
  Setup's menu "about 1 min a take, $0.15 a minute of music" with "$0.15 a minute" beside it, and
  the make button the price of all N takes, N times a take's as the menu shows it ("Make 2 more
  takes · $0.56"; the count menu lists each total, "3 takes · $0.84"), and Try again a failed paid take's ("Try again · $0.28"). Takes are not confirmed;
  each is logged in the spending record (14.7d). Stop aborts the request; ElevenLabs may still
  bill a take stopped while being made, which Stop's title says while a paid take is being made.

**Testing.** Every test uses a fake `ElevenLabsClient`. Opt-in live tests
(`AUDIO_STUDIO_LIVE_ELEVENLABS=1`, with a key; §11 says so when they come) speak one short line,
search the library once and make one 10-second stinger, and spend money doing it. Nobody but the
user can run them, so each pull request of step 14 says how to verify it by hand. Each pull request
adds its new modules to the layout in §4.

---

### 8.7 Images

The images workspace shows the game's **images**: what each is called, its size and the words it is
made from, beside the game's **style**. As with music, the game says which it needs; the studio
never writes the game's lists. This section is the reading, the studio's own words and staleness
(as-yag.3), the takes: making, comparing and choosing them (as-yag.2 and as-yag.4), and the game's
look every take is brought to (as-yag.5). The screens are drawn in `docs/ui/as-yag.3-images.html`,
`docs/ui/as-yag.4-image-takes.html` and `docs/ui/as-yag.5-take-look.html`.

**Files.** The images files' format is in [docs/project-files.md](project-files.md): the `images`
section of the project file (`from.part` for each act's images, `model`, `clips`, `manifest`), the
image lists, the studio's edits (`content-studio/images/edits.json`, which hold the style every
image shares and the studio's changes to images) and lock (`content-studio/images/lock.json`), and
the manifest. This section says how the studio uses them. The acts are the narration's parts. No
`{language}` in any path: images are the same in every language. Refresh from the game on an act's
page runs `refresh.part`, as on Music's act pages.

`model` is optional (`klein`, the default, or `z-image-turbo`): the image model an image's new takes
start on. It is saved from the Images row of Setup's Models panel (`PUT /api/image-model`,
`{ model, was }`, as `music.model` is), at once and with nothing asked, over a stale `was` refused.

`clips` is the folder the chosen pictures are written to (`<id>.png`, the studio's own folder) and
`manifest` what the game reads there. Both are required.

**The game's lists** (read only, `core/images.ts`). `from.part` holds an act's images in the game's
order: `{ id, title, text, width, height, file?, patches?, areas? }`; `text` is what the studio calls the image's
**description**, in its pages, its API and its code. `file` is the picture the game shows for it now
when the studio did not make it (a path inside the project root to a `.png`, `.jpg`, `.gif` or
`.webp`; read only, never moved or written, shown as "The game's own image" until a take is chosen);
the id a slug. `patches` (as-bo8.1) is the optional list of small changes the game lays over the
image: `[{ id, title, text, area? }]` in the game's order, `text` read as `description` as for the image.
A patch may name, in `area` (as-qg4.5), the id of one of the same image's `areas` that it covers; a tie to an
area the image does not list makes the list unreadable (`the patch "<id>" names the area "<area>", which this
image does not list`), and a differing tie between acts counts as "patches" differing.
A patch with no id (a slug), title or words, or an id used twice in the image, makes the whole act's
list unreadable, with the file and place named. `areas` (as-qg4.1) is the optional list of named
areas the game wants placed on the image: `[{ id, title }]` in the game's order, never coordinates;
an area with no id (a slug) or title, or an id used twice in the image, makes the list unreadable
the same way. An image id used twice in one list is a problem with both places, and neither image is
shown. An id several acts list (as-94e) is one image, below. A list that is not there yet is not a
problem (the game has not written it).

**The style** is the studio's own, the edits' `style`: `{ look, keepOut, palette, colourDepth,
dithering, parts }`: `palette` is `#rrggbb` colours, `colourDepth` (`full`, `16-bit` or `8-bit`)
and `dithering` (`flat`, `patterned` or `scattered`) are optional, and `parts` an optional addition
per part id (an id the project does not have is a problem at `style.parts.<id>`). The Style page
edits the look and what is kept out directly (`PATCH /api/image-style`, `{ look }` or `{ keepOut }`:
an empty look is refused, an empty kept-out is none); the palette, colour depth, dithering and the
parts' additions are changed in the file. Without a style each prompt is only its words, and the
Style page says to add one. The style and each image's edit are read apart
(`readImageEditsValue`), each with its problems: a bad `images.<id>` drops only that image's edit,
so the image shows the game's words; a bad style is taken as none and the rewordings are kept; a
file that cannot be read at all holds nothing usable. Every save is refused, with those problems,
while any part of the file cannot be read, so a save never writes over and loses it.

**The prompt.** The image's words (the user's own, else the game's description), then the act's
addition, the look, and `Kept out: …`, on separate lines; an empty part is left out. An image can
leave its act's addition out (as-1au): a tick box on its page, "Add Act IV's style to this image",
ticked by default and shown only while the act has an addition. The choice is saved at once
(`PATCH /api/images/:id/act-style`, `{ on }`) as the image's `partStyle: null` in the edits,
kept when the act later has no addition, and the prompt and staleness key then carry no
addition. The screens are drawn in `docs/ui/as-1au-act-style.html`.

**An image several acts list** (as-94e). A game may list one id in more than one act's list (a
recurring character's portrait). When the copies agree on title, words (`text`) and size it is
one image: one set of words, one board, one chosen picture and one clip, shown on every act's page
(`ImageRow.sharedWith` names the other acts; the row of the first listing act is copied per act, and
the notices count it once). The row says "also in Act I" under its id, the page "Shared with Act I:
a change here changes it there too.", and the page's crumb returns to the act it was opened from
(`#/images/items/<id>?from=<act>`; a fresh load uses the first act that lists it). When the copies
disagree, the image is shown in none of them: each act keeps the row in place, dimmed, with the
reason, "—" for size and a "lists disagree" chip (`ImagesAct.conflicts`, with `order` the list's ids
in the game's order), the page of such an image shows only the reason, and the banner has one
problem per list naming another list that differs. The act style of a shared image is one pick for
all acts, not the tick box: the menu "Act style for this image" lists the listing acts that add a
style and None. `partStyle: null` in the image's edit means None; `partStyle: <act id>` names the
act, and a missing, unlisted or style-less pick is the first listing act (None when it adds none). `PATCH /api/images/:id/act-style` takes `{ on }` or `{ from: <act id> | null }`. The
screens are drawn in `docs/ui/as-94e-shared-images.html`.

**The patches the game asks for** (as-bo8.1; `ImageRow.patches`, `ui/features/images/GamePatchesPanel.tsx`).
An image whose list carries patches gets a full-width panel, "Patches the game asks for", directly
below the workbench: a
list of titles, each with its id, that open in place (any number at once; all closed on load except a
patch whose game words changed under the user's) to the patch's workbench (as-bo8.2, below): one field of words, reworded as the image's own
words are. The rewording is `images.<id>.patches.<patchId>: { text, gameWas }` in the edits
(`applyPatchWordsChange`, `resolvePatchCompare`; `PATCH /api/images/:id/game-patches/:patch`,
`{ words }`, and `POST …/compare`, `{ choice }`), with the same notice, "Use the game's" and "Keep
mine", inside the patch; the act's list adds "the game changed a patch's words" to the image's prompt
cell. A patch the game no longer lists leaves the panel but its words stay in the edits and come back
with the id. Patches are one more thing the lists of a shared image can disagree on (`ConflictKind`
`patches`: id, title or words differ; the same patches in another order do not, and the page uses
the first listing act's order). A rewording changes no prompt or take: it never makes an image out
of date. Refresh's panel says nothing of patches. Screens: `docs/ui/as-bo8.1-image-patches.html`.

**The named areas the game declares** (as-qg4.1; `ImageRow.areas`, `ui/features/images/NamedAreasPanel.tsx`).
An image whose list carries areas gets a full-width panel, "Named areas", directly below the
workbench and above "Patches the game asks for": its count ("1 of 5 placed"), one line of
explanation, and below them two parts side by side (one column when narrow, the picture first,
staying in view with an opaque background so the list passes under it, as-5v0, and at most half the window high, keeping its shape, so the rows can be reached, as-e39): the
chosen take on the left and the list of areas on the right, a row per area in the game's order
(title, id, the mark "Placed" or "To place", and "Clear" on the selected placed row). **Marking**
(as-qg4.2): one area is selected at a time (on arrival the first still to place); dragging on the
picture draws its box, a drag inside the selected box moves it, one on a handle (eight) resizes it,
a click selects the smallest box under the pointer, Esc cancels a drag, and the arrow keys (a fixed
step of 4 pixels; with Shift the right and bottom edges) and Delete work from the row. Every change
is saved as it is made (`PUT /api/images/:id/areas/:area`, `{ box }`, null clears), shown at once
and taken back with a red line if saving fails. A box is `{ x, y, width, height }` whole pixels of the
image's own size (at least 4 each way, inside the picture), kept in the image's edit as
`areas.<area id>` (`applyAreaBox`, `checkAreaBox`; sorted by id), so one set serves a shared image
and a box survives the game dropping the area and asking for it again. `AreaRow.box` and `placed`
come from it. The pure geometry is `ui/imageAreaBox.ts`. The patches with a chosen take on the image (read by the panel from the patches query) can be
laid over the picture by switches, for looking only. **Reaching the game** (as-qg4.3,
`services/imageAreas.ts` `syncImageAreas`): a placed box is written for the game in the same save as the
box, as `areas.<area id>: { x, y, width, height }` in the image's images-manifest entry, fractions of
the picture (six decimals; no title; `areaFractions`, `withAreas`). Only the areas the game asks for
are passed, and the key is gone when none is placed. If the manifest cannot be read or written, or the
image has no entry, the whole save fails and the edits are put back byte for byte (a clear never fails
for want of an entry). Choosing a take, bringing to a look and Bring all keep the areas (`publish`),
un-choosing takes the entry with them. Refresh from the game on an act (`passAreasToGame`) brings every
image of the act up to date, which is also how boxes marked earlier arrive; the manifest is written
only when something changed, and a failure is the result `reason: 'areas'`. The manifest is one more
file of the Changes page's Images section. Screens: `docs/ui/as-qg4.3-placed-areas-reach-the-game.html`.
The act's list adds "4 of 5 areas to place" under an image's
status while some are left; it changes neither "n of m chosen" nor the needs-attention view. Areas
are no part of what a picture is made from, so changing them never makes an image out of date, and
Refresh's panel says nothing of them. They are one more thing a shared image's lists can disagree
on (`ConflictKind` `named areas`: id or title differs or an area is missing; the same areas in
another order do not, and the page uses the first listing act's order). Screens:
`docs/ui/as-qg4.1-named-areas.html`, `docs/ui/as-qg4.2-marking-named-areas.html`.

**The studio's own words** are the edits' `images`, committed like the music edits and joining the
Changes panel: `{ <id>: { text, gameWas, partStyle, patches, areas } }`. `gameWas` is the game's text when the words
were written; a game description that differs from it raises the compare notice (**Keep mine** moves
`gameWas`, **Use the game's** removes the words). Emptied words, or the game's own typed back, remove
them; an edit left with nothing is removed. The edits are written with the style first (its keys in
a fixed order, those at their default left out), then the images by id (`formatImageEdits`).

**Staleness.** A chosen take records what it was made from, `{ words, style, width, height }`
(`style` is the look, what is kept out and the act's addition as one string; the palette, colour
depth and dithering are not in it, since they decide how a take is brought to the game's look and
not what the model is asked for), in the lock, which writes it in the clear (`inputs.text`,
`inputs.style: { look, keepOut, part }`, below) and reads it back into the same key
(`ImageLockSchema`). An image is out of date when what a new take would be made from differs: the words
(the user's included), the size or the style. The game changing a description under the user's own
words changes nothing the prompt uses, so it does not make an image out of date.

There is no notice for a changed style: the style is the studio's, so the images made with the old
one are marked out of date, each saying "the style".

**Takes** (`services/imageTakes.ts`, `core/imageTakes.ts`). A take is the image's whole prompt made
with the model asked for (`ImageModelId`, `core/imageModels.ts`: `klein` or `z-image-turbo`; a request
that names none starts on `defaultTakeModel`: the project's `images.model`, else the other model when that
one is not on this computer) at the take size (`takeSize`: the listed shape with the longer side 1024,
each side a multiple of 16; the listed sizes are not, so a take is then brought to them, below)
and a new seed, on the GPU queue (`makeImageTake`). The board is
`content-studio/cache/images/<id>.json`, `{ next, takes: [{ n, seed, model, width, height, madeFrom, seen }] }`
(`madeFrom` is what it was made from, as in the lock), the pictures `content-studio/cache/image-takes/<id>/<n>.png`;
a take is on the board only once its picture is written, numbers are per image and never reused
(reserved at once), and what waits, is made or failed is in memory (`globalThis`), polled by the
page. **Stop** ends the one being made and drops those waiting; a failed take stays with its reason
until **Try again** makes the same number. The reason is one plain sentence naming the model and the
cause (`imageFailureReason`: missing or incomplete weights, with the download command; a model or
argument the installed mflux does not know; or else the exit code); mflux's own output goes to the
server's log only. A take is "earlier" when its words differ from the image's now (the style and the size are not marked on a take); "new" until it has been shown on the right
once (`seen`, saved on the board). `model` on the board is the mflux name of the model that made it; the
view gives it as an id, and the two takes side by side name it after the take. A model that is not on this
computer (`ImageGenerator.installed`: its weights are in the Hugging Face cache) is refused at the server,
and **Try again** remakes with the model the take was asked with. Takes cannot be made only when mflux is
missing or neither model is installed.

**Patches** (as-b9x, as-bo8.2; `core/imagePatches.ts`, `services/imagePatches.ts`, `ui/features/images/PatchWorkbench.tsx`). An experiment in painting a change into a chosen picture with the whole room in view, so it blends in where a separately made picture would not. On an open patch of "Patches the game asks for", the user drags a rectangle over the image's chosen take (the mark; a click or a drag too small to patch changes nothing, and a drag stops at the picture's edges, a side within 4 screen pixels of an edge counting as on it, and a side on an edge of the game's version carried out to the model's own edge, past what the game crops, so no fade shows inside the game's picture, as-lxo) and makes 1 to 4 takes of it from the patch's words. `mflux-generate-flux2-edit` then edits a window of the take's model picture round the marked area (`editWindow`, see Patch models below), with the picked model, on the GPU queue as a take is (`ImageRequest.editing`; the spike: about 15 s, 13.6 GB). Klein also changes things it was not asked to, so only the marked area is kept (`keepArea`), fading in over 24 pixels, except along a side on the picture's own edge. Before that the edit's colours are matched to the take (as-c8q; `matchToTake`): the strip 8 pixels outside each side not on the picture's edge, compared with the take place by place along the side, gives the drift of the edit from the take there. A small difference (what is left inside the area after that correction, worst channel's mean up to 30 of 255) is a drift and is corrected across the whole area; a big one is taken as asked for, so it is corrected at the sides and eases in over 48 pixels, leaving the middle as painted. The sides follow a step such as a horizon (a median along the side, 24 places each way), and a place that differs from the drift around the area (the drift reference is described next) by more than 22 (of 255) fades to that drift by 30, so something the edit painted just outside the area, narrow, wide or soft-edged, is not carried into it as a streak. The drift reference is, of the tones many places of the strip agree on (within 8), the one nearest the median offset of the whole picture, judged on the places themselves before the median, so objects covering most of the strip cannot outvote the sky, and a gradual drift keeps its middle. A tone more than 22 from that median is refused as objects only while at least a tenth of the strip's places agree with the median; when none does, the edit shifted all that lies around the area (a sky moved far while the rest of the picture stayed) and the strip's own tone is the drift. Limits: a drift that changes by more than about 44 across the area, or two parts whose drifts differ by more than 22, leave the part furthest from the picture's own median unmatched; objects covering most of the strip around a sky shifted that far are taken for the drift. A difference up to 22 is indistinguishable from drift and is followed, as is a horizon whose two parts drift up to 22 apart. Nothing is adjustable and patches already made are not rewritten. A take is `content-studio/cache/image-patches/<image>/<patch>/<n>.png`, as big as the image's take and transparent outside its area, on `board.json` in the same folder: `{ next, takes: [{ n, base, seed, words, area, seen, look?, model? }], chosen: { <base take>: <n> }, inGame: { <base take>: <n> } }`. `base` is the image's take it was painted on, `words` the patch's words it was made from (a take whose words differ from the patch's now is "earlier words") and `area` the area it was made with, so a new mark changes no earlier take; `chosen` keeps one choice per take of the image, so choosing another take of the image shows the patch's takes made on it, and choosing the first again brings its takes and their choice back. Choosing reaches the game (as-bo8.3, below). The old trial's `<image>/board.json` and `<image>/<n>.png` are no longer read and not deleted. Takes are queued on the GPU queue as an image's are (a second patch of the image waits behind the first, "Waiting"), Stop stops only this patch's, a failed take keeps its area and words for Try again, and what is waiting, being made or failed is in memory. Only one press of Make runs per patch at a time. Takes are made from the words on disk, so a press of Make first sees the field of words saved: it waits for a save under way, or saves words a failed save left in the field, with Make off meanwhile, and asks for no takes if the words could not be saved (as-d3b). The page lays one take over the one large picture with a switch to take it off (the dashes of the mark step aside when the take shown covers the mark's area), shows each take as a close-up of its area with 25% of its sides around it (`ui/patchCloseUp.ts`), and a closed row says "no takes yet", "2 takes, none chosen" or "3 takes" with the chip "Take 1 chosen" (`patchSummary`). Inside a patch ← → step its takes, C chooses, D drops (not the chosen one), S turns the patch off and on, and the image's own keys rest. Routes: `GET /api/images/:id/patches` (every declared patch's takes on the chosen take, and whether takes can be made), `POST …/patches/:patch/takes` (`{ count, area }` 1 to 4, or `{ retry }`), `GET`/`DELETE …/takes/:n`, `POST …/takes/:n/seen`, `POST …/choose` (`{ n }`), `…/unchoose`, `…/stop`. A patch tied to a placed named area (as-qg4.5) has no mark of the person's own until they drag or press a take: its mark is then computed from the area (`markFromArea`, the area grown by the feather on every side, stopping at the picture's edges), so it follows the area at once as the area is placed, moved or cleared, and starts from it again after a reload. A line ("Marked from the named area…") shows while the mark is at that place, "Back to “<title>”" while it is not (it drops the person's own mark and focuses Make), and a line says so when the area has no place yet. Nothing is stored and a patch never moves the area. The image list and the lock are not touched by a patch. Screens: `docs/ui/as-bo8.2-patch-takes.html`, `docs/ui/as-qg4.5-patch-from-named-area.html`.

**Patch models** (as-ilw; `EDIT_MODELS` in `core/imageModels.ts`, `EditModelMenu`; screens `docs/ui/as-ilw-patch-model-takes.html`). Patch takes are made by one of two edit models, picked per patch in a menu above the count ("Model for new takes", the stronger one first): Qwen Image Edit (`Qwen/Qwen-Image-Edit`, Apache-2.0, 53 GB, about 8 min a take, measured on a 512 × 320 window; the label does not scale with the window) and FLUX.2 klein 4B (about 20 s). Qwen was found by trying candidates on the sample inn's sign: klein left a ghost of the stag and the lettering, Qwen with a plain instruction ("Remove the hanging wooden sign with the lettering from the wall above the door. Fill the place with plain timber wall.") left none (the same words on a fresh 1024 × 640 inn: the whole picture took 20 min and removed the sign, a 512 × 320 window round it took 8 min and removed it). The model is therefore given a window round the marked area, the area plus at least 96 px or half its side of context, sides in multiples of 16 (`editWindow`), pasted back into the take before the colours are matched and the area kept, so a take costs about the window and not the picture. It runs as `mflux-generate-qwen-edit --model Qwen/Qwen-Image-Edit --base-model qwen-image-edit --quantize 8 --steps 30`: mflux's own alias `qwen-image-edit` is the 2509 weights, which are not the ones downloaded, and unquantized it is killed on a 48 GB Mac (8 bits peaks near 38 GB). The edit models are separate from `ImageModelId`, which stays the project's two models for an image's own takes (`images.model`, Setup's main-model row). Each take on the board gains `model` (absent on a take made before the choice, which klein made and which reads "FLUX.2 klein"); the page names it under "Take n", beside "Looking at" and in a take being made. New takes use the menu's model (`{ count, area, model }`; klein when the body names none), Try again the model that failed, and "Remake patches on this take" has a menu of its own (`{ count, marks, model }`) that follows no patch's. Picks live in `GamePatchesPanel` and end with the page; every menu starts on Qwen when it is whole, else on klein with a faint line. A picked model that is not on this computer shows "not on this computer" or "download incomplete" under the menu with Make off (`view.models`, the download of each edit model); a failed take marks its model "last take failed" until a take of that model works (`failedModels`, held in memory like the takes being made, never swapping models by itself). Setup's Image models row lists Qwen Image Edit as optional for patches, with its download command, while it is not whole (`facts.images.patchModel`); it never changes the row's state.

**A chosen patch in the game** (as-bo8.3; `gamePatch` in `core/imagePatches.ts`, `services/imagePatchGame.ts`; screens `docs/ui/as-bo8.3-patch-in-game.html`). Every patch take has a _game version_ beside it, `<n>.game.png`: the image take it was painted on, with the patch blended over it by its own transparency, and the take alone, are both brought to the game's look (`bringToLook`, the image's size, palette and dithering), and only the dots that differ are kept, each fully solid; the rest is fully transparent (`gamePatch`). The soft edge thus fades out in the look's own dither, and laid over the image's game version the result is exactly the painted take brought to the look. It is made as soon as the take is (the board's `take.look` notes the look it was brought to; "bringing" in between), and a take that cannot be brought stays as the model made it. Choose (`services/imagePatches.ts`) writes that picture as `<clips>/<image>.<patch>.png` and the manifest entry `patches.<patch> = { file, width, height }` under the image (the manifest is written in the image's choice queue, like an image's choice; unreadable, it refuses and changes nothing), then the board: `chosen[base]` and `inGame[base]`, the take the game has on each take of the image (a choice made before this step is in `chosen` only, so it is not in the game until Un-choose and Choose). Un-choose takes the entry (and an empty `patches`), the picture and the board's entry away, in that order, so pressing again finishes a half-done job. The image's own choices carry the patches (`publish` in `services/imageTakes.ts`): choosing another take lists only the patches with `inGame` on it, written again from their game versions (one file name is shared by every take of the image), so the patches of the previous take leave the list in the same save and come back with the original; un-choosing the image removes its manifest entry with the patches; patch pictures stay in the folder. A look change brings the patches along with their image (`bringImage`): every patch take's game version is made again from the model's pictures, the pictures in the game are rewritten, and the image counts once in the notice (`readTakeLooks` adds the patch takes' looks); a patch that cannot be brought is named in the failure ("the model's picture of its patch "Bread taken" is missing") and keeps its old look, which shows as the chip "Old look" on its row and above its picture (`PatchWorkView.oldLook`). The page has a box "What the game gets" in each patch's Takes heading, ticked when the page opens and kept per patch while the page is open (`GamePatchesPanel`); ticked, the large picture and close-ups show the game's version at the game's size (`ui/patchGameSpace.ts` maps a mark between the model's picture and the game's, whose crop is `cropWindow`), unticked what the model made, captioned "640 × 400" or "1024 × 640 · cropped to fit". Choose waits while a take is being brought, when the style cannot be read ("Fix the style to choose this take.") and while the lock cannot be read. `GET /api/images/:id/patches/:patch/takes/:n/game` serves the game version.

**Patches set aside** (as-bo8.4; `setAsideQuestion` and `makeAgainOf` in `core/imagePatches.ts`, `PatchRow.chosenOn` / `chosenOnGone` in `core/images.ts`, `readPatchChoices` in `services/imageLists.ts`; screens `docs/ui/as-bo8.4-patches-set-aside.html`). Nothing new is stored: choosing another take of the image already lists only the patches with `inGame` on it (above), so the patches of the previous take are set aside, not deleted, and come back with the original. What the page adds is asking first and marking. Each patch row carries the takes of the image its patch has a chosen take on (`board.chosen`; `chosenOn` for those still on the image's board, `chosenOnGone` for one since dropped), read with the images summary. Choose (or C) and Un-choose on an image whose take in the game has chosen patches ask first, in the place of "In the game" (the same `Confirm` as Un-choose), naming the patches by title in the game's order and, when the take chosen has chosen patches of its own, which come back; the yes is the ordinary choose or un-choose and the question stays open with the studio's message if it cannot be saved. Drop (or D) of a take with chosen patches set aside asks in the place of that take's picture; the patches then stay marked with no take to go back to. A patch needs making again when it is asked for, has a chosen take on some take of the image other than the one in the game and none on that one (`makeAgainOf`); its closed row has the chip "Make again", its opened row a line saying where it was chosen, and the act's row a line "make again: …" beside "the game changed a patch's words". A patch chosen before as-bo8.3 (`chosen` without `inGame`) is counted and named like any other, though the game never had it.

**Patches that overlap** (as-bo8.5; `overlappingPatches` and `patchBoxesOverlap` in `core/imagePatches.ts`, `PatchRow.chosenArea` in `core/images.ts`, `readPatchChoices` in `services/imageLists.ts`; screens `docs/ui/as-bo8.5-patches-overlap.html`). Patches of one image are made independently from the same take, so two chosen patches whose marked areas share a dot may show badly together. Nothing is stored and nothing is stopped: each patch row carries `chosenArea`, the area its chosen take on the image's take in the game was made with (read from the patch boards with the images summary, only while that take's picture is there), and `overlappingPatches` lists the pairs of asked-for patches whose chosen areas intersect (a shared border is not an overlap; the soft edge counts), each once, in the game's order. The image's page shows one amber warning in "Patches the game asks for" (nothing until the patches have loaded, nor when the chosen picture or the lock cannot be read), an opened patch a line naming what its chosen take overlaps, and the act's row a line beside "make again". A patch's choose, un-choose or drop reloads the project (`usePatchTakesChange`) so the rows follow what was saved.

**Remaking patches on a new take** (as-qoj; `remakeCovered`, `planRemake`, `tieOf` in `core/imagePatches.ts`, `remake` / `stopRemake` / `closeRemake` in `services/imagePatches.ts`, `ui/features/images/RemakeLine.tsx`; screens `docs/ui/as-qoj-remake-patches.html`). Under the intro of "Patches the game asks for", when the image has a chosen take and a patch is covered, a line counts them with a menu (1 to 4 takes each, starting at 2, page state) and "Remake patches on this take". A patch is covered when it needs making again (`makeAgainOf`) and has no take on the take in the game, none finished, waiting, being made or failed (`remakeCovered`). The press starts at once and chooses nothing: each covered patch gets the number of takes on the take in the game, in the game's order, through the same per-patch start as Make (so on the same GPU queue, with the patch's words as they stand). Each is made from the first place that exists and fits the picture (`planRemake`): the mark the person drew on the patch (the page sends the marks it holds, `POST /api/images/:id/patches/remake` `{ count, marks }`), the place its named area has now (`markFromArea`), else the area of the take chosen on the newest earlier take of the image (`ImagePatchesView.remake.earlier`, read from the patch boards). A patch with none is left out and named under the press; nothing moves a saved or a named area. The page and the server compute the plan with the same pure functions. The latest press of each image is kept in memory (`contentStudioPatchRemakes`, the takes it queued by patch, like the takes being made); `ImagePatchesView.remake.press` derives its counts: made (on the board on the take it was made on), failed, stopped (neither), and the seconds left. While it runs the line is a progress line with Stop (`POST …/patches/remake/stop`, only this press's waiting or running takes; a patch's own Stop still stops all of that patch's), then a summary with Close (`…/remake/close`, which does not forget a running press). A page that has just loaded reads with `?fresh=1`, which drops a finished press, so a summary is not kept across a reload (a running one is); the time left says "about N s" under a minute. Closed rows say "Making 2 takes" with a bar or "Waiting", add " · 1 could not be made" for failed takes, and carry the chip "new" until a take has been looked at; a failed patch in the summary is a link that opens and scrolls to its row. If any patch cannot be started, the takes already queued by the press are stopped and nothing is kept.

**Named areas set aside** (as-qg4.4; `adoptAreas`, `applyAreaBox` and `areaFractionsOn` in `core/images.ts`, `AreaRow.boxes` / `elsewhere` / `elsewhereGone`, `setAsideQuestion` in `core/imagePatches.ts`, `adoptImageAreas` in `services/imageEdits.ts`; screens `docs/ui/as-qg4.4-areas-set-aside.html`). Each take of an image keeps its own boxes: the image's edit gains `takeAreas` (by take number, then area id); `areas` stays as the boxes of no take yet (placed before this, or with no take chosen), which count on the take in the game and move onto it (`adoptAreas`) when a box is placed there or the take in the game changes (Choose, Un-choose; before the save, so a failed choose can leave them on the new take). A row's `box` and `placed` are those of the take in the game, so the head's count, the act's "areas to place" and `areaFractions` are unchanged; `boxes` has the row's box on every take still on the board, `elsewhere` the other takes when it has none on the take in the game (the chip "Place again"), `elsewhereGone` a box on a dropped take (the board's take numbers are never reused, so a dropped take is found by the board, read for images with `takeAreas`, like the patch choices). The game's manifest gets the boxes of the take being published (`areaFractionsOn` in `publish`), so choosing another take takes the old boxes out of the game in the same save and choosing the original brings them back; nothing is deleted, and Drop needs no write. The Choose, Un-choose and Drop questions of as-bo8.4 name the areas too (`setAsideQuestion` gives `leavingAreas`, `returningAreas`; `setAsideLead`, `setAsideDim` in `ui/imagesText.ts`), one question with two lists when patches and areas both leave. The Named areas panel shows the line `placeAgainLine` above its list while any row reads "Place again", and selects the first area still needing a place when the take in the game changes.

**The game's look** (as-yag.5; `core/imageLook.ts`, `core/imagePixels.ts`, `services/png.ts`). The
game's version of a take is the model's stored picture (`<n>.png`, never changed) brought to the
image's exact listed size and to the style's colours, written beside it as `<n>.game.png`; the
same picture and look always give the same bytes, so it is redone from the stored picture and never
made again. The look is read from the style only: a listed `palette` wins; else `colourDepth`
(`8-bit` is the one fixed set of 8 reds × 8 greens × 4 blues, `16-bit` 32 × 64 × 32, `full` no
reduction, the default); `dithering` applies when colours are reduced (`patterned`, an 8 × 8 Bayer
matrix, by default; `flat` is the nearest colour; `scattered` is Floyd–Steinberg). The size is a crop
to fill (the middle kept) and a box average, in plain TypeScript over a small PNG codec on
`node:zlib` (`Bun.Image` gives no pixel access), so nothing depends on the machine. `lookKey` (size,
colours, dithering) is what a picture was brought to: it is noted on the board take (`look`) and in
the lock's entry (`inputs.look`, as the style's own fields: the palette, else the colour depth, and
the dithering unless full colour; the size only when it is not the entry's own), and an image is "old" when its chosen picture, or any take whose
model picture is there, was brought to another key (one with no key was never brought). A take is
brought as soon as it is on the board (the view says `bringing` meanwhile, and Choose is off); a
style that cannot be read leaves the take as the model made it, with the sentence saying what to
fix (`explainStyleProblem`) and Choose refused. **Bring all** (`POST /api/images/bring-all`, one run
per project in memory, polled by `GET`) brings every old image's takes and its chosen picture
(clip, manifest at the listed size, lock `look`) from the stored pictures, counting `done` of
`total`; an image whose chosen take's model picture is gone fails with that reason and keeps its
old look, and the run stays in view with **Try again** until it is started again.

**Choosing.** **Choose** (in the image's board turn and the project's choice turn, with both the
manifest and the lock readable, or nothing is changed) writes the take's game's version (brought to
the look first if its look is old) to `<clips>/<id>.png`, the manifest entry `{ file, width, height }`
(the listed size) and last the lock entry
`{ model, seed, take, inputs: { text, width, height, style, look }, at }`, keyed by image id, one
per line in id order (`formatImageLock`). **Accept**, in the out-of-date notice on an image's page when
what changed is its words, style or act style (`POST /api/images/:id/accept`, in the image's board
turn and the project's choice turn), writes the image's words and style now into the lock's
entry, so the chosen picture counts as made from them and the image is up to date with the same
picture; a changed size needs a new take, so the notice says so and offers no Accept, and the
service refuses it (409), as it does an image with nothing changed or none chosen. **Un-choose**
(asked first in the page) removes the manifest entry,
then the picture, then the lock entry, so a failure can be pressed again; the take stays on the board.
**Drop** removes a take that is not chosen, with no question, and refuses while the lock cannot be
read. The game's own `file` is never written or deleted. Where the pictures of the chosen image and of
the game's own are served from: `GET /api/images/:id/current` (the chosen clip, else the game's file).

**The workbench** (an image's page, under its notices) keeps the whole round, words, make, look,
choose or drop, in view at once (`docs/ui/image-workspace.html`, layout A). Its first column holds
the Prompt panel, then **Make takes** (the menu "Model for new takes" on a line of its own, which
starts on the project's model, or on the model that is here when that one is missing, with a faint
line saying so, a pick holding only while the page is open; closed it reads "FLUX.2 klein — about 8 s
a take"; then the count menu, which keeps its pick after a press while the page is open, and Make N takes, and Stop while takes are made), then **Takes · N**:
the other takes as a grid of thumbs that scrolls on its own, takes being made among them with their
progress. Takes are made from the words on disk, so a press of Make or of a failed take's Try again first sees the prompt saved, as
a patch's Make does: it waits for a save under way, or saves words a failed save left in the field, with
both buttons and Make's menus off meanwhile, and asks for no takes if the words could not be saved (as-95q).
The second column holds the image the game uses beside one other take. Both columns stay
in view while the page scrolls (sticky, the first at most the window's height); below 1000 px they
stand one above the other. A box in the Takes heading, "What the game gets" (ticked when the page
opens; the page's own, never saved), switches every take shown, on both sides and in the grid,
between what the model made (with its size, and "cropped to fit" when it had another shape) and
what the game gets (with the game's size; in its place, while a take has none, "Bringing to the
game's look…", "Not brought to the game's look yet." or what to fix in the style). On the two
sides, a game picture brought to the look before the image's size changed (480 × 360 for an image
now 1920 × 1080) is captioned with its own size, read from the picture once it loads, and keeps its
own shape, drawn as wide as the image would be (with hard pixels when that enlarges it) until it is
brought to the look again; the grid's thumbs keep the image's shape. The image
the game uses (its game picture is the one the game has now) and the compared take are enlarged by
the largest whole number of the game's size at which the two fit side by side in their column,
drawn with hard pixels; when not even ×1 fits (RetroQuest's 640- and 480-wide images on a laptop)
they are shrunk side by side to fit, down to half the game's size, and drawn smooth; narrower still
they stand one above the other, each fitted to the width. Each has its buttons under its picture
(Un-choose; Drop and Choose). Choose moves the compared take to the left and the take chosen before
comes to be compared, marked "was chosen" for that visit. The compared take is the page's own
state (after a reload the newest) and does not move when a take finishes. Keys work anywhere on
the page except while typing in a field or menu (a box or button leaves them to the page; a radio
keeps its arrows), with no Command, Control or Option held, and not while Un-choose is asked: ← / →
step through the grid, which scrolls to keep the compared take in view, **C** chooses the compared
take and **D** drops it, each only when its button is on, once per press (a held key does not
repeat) and not while the last choice or drop is still being saved. Pressing Make N takes puts focus on the compared take in the
grid (on the Comparing label when there is none yet), so the switched-off button does not lose it
(as-99s). The status of an image on its act's list says "making 2 takes · about 1 min" while takes
are made. The model menu's screens are drawn in `docs/ui/as-yag.7-image-models.html`.

**Make takes for the whole act (as-23x.3).** The "Images up to date" panel on an act's page has a
button, "Make 4 takes each", beside the count. `planImagesMakeAll` (`src/core/imagesMakeAll.ts`)
decides: every image with no chosen take (an out-of-date chosen image counts as chosen) that is not
already making takes gets four, on Setup's model, or on the other one when Setup's is not whole or
failed its last take (`defaultTakeModel`, as an image's own page does). With nothing to make, the
panel says "Every image has a chosen take.", or, when the game's lists disagree about some of the
act's images, names those instead, since they have no chosen take (as-3u3); the line under the act's
heading counts them too. The press always asks first,
inside the panel, and writes nothing until Make. `POST /api/image-acts/:id/make-all` plans again on
the server and queues the takes through `make` per image (one refusal stops those already queued), answering the images and takes it queued;
`POST /api/image-acts/:id/stop` stops every take of the act's images and answers how many;
`GET /api/images/model-state` gives Setup's model and each model's state. The running line is worked
out from `GET /api/images/making`, which now also counts `failed` and `stopped` takes (an image with only
those reports `takes: 0`; both live in memory until the studio restarts, and the summary line takes the difference since the press); the summary is remembered by the running studio, not on disk (as-4m0: `contentStudioImageBatches`
in `services/imageTakes.ts`, one per act, `GET /api/image-acts/:id/batch`, `POST …/batch/close`),
with the same rules as the music lists': it survives a reload and shows in every tab, until Close, a
new press or a hand start on an image of the act, and a quit forgets it. Mockup: `docs/ui/as-23x.3-make-all.html`.

**API.** The pages are in `GET /api/project` (`summary.images`). `PATCH /api/images/:id`
(`{ words }`, null takes them back), `POST /api/images/:id/compare` (`{ choice: keep | game }`),
`PATCH /api/image-style` (`{ look }` or `{ keepOut }`); for takes
`GET` and `POST /api/images/:id/takes` (`{ count, model? }` 1 to 4, or `{ retry }`), `PUT /api/image-model`, `GET /api/images/:id/takes/:n`
(the model's picture), `…/:n/game` (the game's version), `DELETE` it (drop), `POST …/takes/:n/seen`, `POST /api/images/:id/choose` (`{ n }`),
`/unchoose`, `/accept`, `/stop`, `GET /api/images/:id/current`, `GET /api/images/making` and
`GET`/`POST /api/images/bring-all`, `GET /api/images/model-state` and `POST /api/image-acts/:id/make-all` and
`/stop`; every change from
the studio's own page only.

---

### 8.8 Sound effects: the models (as-5wc.3, as-5wc.5)

Sound effects are made with Stable Audio 3 Small SFX on the CPU (§13 decision 9), by a worker of its
own, `worker/effects.py`, run with uv from `src/services/effects.ts` (`createEffectsWorker`). It is
a JSON-lines worker like the music workers, started on the first effect (the model loads in about
4 s) and stopped with the studio. An effect is a description, a length and a seed; the worker
writes a 44.1 kHz stereo 16-bit WAV, and the studio trims its trailing silence (`trimTrailingSilence`
in `src/core/wav.ts`: everything after the last frame above −59 dB, less a 20 ms tail), since the
model stops before the length asked. The effects page (§8.10) calls it.

**Where the weights are read from:** the Hugging Face cache (`HF_HOME`, else `~/.cache/huggingface`),
as the image models' are, not the studio's own folder: a half-finished download there would
otherwise show as Ready. The user downloads them once with `hf download` and a read token passed
on the command line (the repository is gated); the studio never asks for or keeps the token. The
worker runs with `HF_HUB_OFFLINE=1`, so it never downloads: what Setup judged whole is what loads. Whole,
interrupted and absent downloads are told apart by `hubDownload` (`src/services/images.ts`).

**Two models** (as-5wc.5; `src/core/effectModels.ts`): Small SFX (`small-sfx`, about 2 s a take, CPU)
and **Stable Audio Open 1.0** (`open-1`, about 100 s a take, GPU). Open 1.0 runs on the music's
Stable Audio worker (`worker/stable_audio.py`, model Short, the folder
`~/.cache/stable-audio/stable-audio-open-1.0`) through `createOpenEffects(music)` in
`src/services/effects.ts`: the request carries `plain: true`, so the worker sends the description as
it is (no "instrumental", tempo or key), and the studio trims the take's trailing silence like Small
SFX's. One worker serves music and effects, so a `--dev` reload and the image takes' freeing of the
GPU treat it as the music's. `createEffectGenerator` sends each request, readiness check and
download check to its model's generator. Open 1.0's download is whole or absent, since a folder
can't be told whole from half (`effectDownload`).

**One GPU, and what is using it** (`services/gpu.ts`): music takes on this computer, image takes,
Whisper's checks and Open 1.0 effect takes all run on the one GPU queue, one at a time. `holdGpu`
names the use while a job runs (`gpuInUse()`: music, image, effect, recording), so the first waiting
Open 1.0 take of an effect can say "waiting for the graphics chip" with the line "Music is being made
first." and the like; the takes behind it say "waiting". Small SFX's takes stay on their own CPU queue.

**The project's model** is `effects.model` (§8.9), saved from the Sound effects row of the Models panel
(always shown in a project with an effects section, so it can be picked before the game lists any
effect; the menu lists both models by full name with their time, a model not on this computer or
partly downloaded can't be picked, one whose last effect failed can). An effect's page starts each
visit on Setup's model, or on the other when Setup's can't run and the other can (not on this
computer, partly downloaded, or its last effect failed), with a faint line saying why
(`defaultEffectModel`, as `defaultTakeModel` for images); a pick lasts while the page stays open.
Each take keeps the model that made it; Try again remakes with it. The menu shows the full entry closed
too: in a narrow Takes panel it takes a line of its own, first, with Stop, the count and the button under it (as-b2t).

**Setup's Sound-effect models row** (one row for every effects model, after Image models) is checked
afresh each time and writes nothing to the project. It is always checked, since it needs no section
of the project file, and judges each model's download and last failed effect separately, as the
image models' row does. Only the project's own model makes "Needs attention", and only once the game
lists effects; before that, and for the other model, whatever is missing shows as grey "Not set up",
optional, and is not counted in the sidebar. One sentence per model that has something to say, with a
step for each download; what to fix first still wins: uv missing, then a download, then a failed
effect. When neither model can run the row says sound effects can't be made. The last failure of each
model is kept in `content-studio/cache/effect-model-health.json` with the effect it was made on
(`createEffectHealth`: `record` when an effect fails, `clear` when one made with the model works,
nothing when one is stopped); the row links the effect's page, and names no effect once the game no
longer lists it.

### 8.9 Sound effects: the list and the studio’s descriptions

The Sound effects workspace shows the game's **sound effects**: one game-wide list, as the stingers
are. This section is the reading and the studio's own descriptions (as-5wc.2); making, comparing and
choosing takes come with as-5wc.3 and as-5wc.4. The screens are drawn in
`docs/ui/as-5wc.2-sound-effects.html`.

```json
"effects": {
  "from": { "shared": "tts/effects.json" },
  "model": "small-sfx",
  "clips": "audio/effects",
  "manifest": "audio/effects/manifest.json"
}
```

The format of the section, the list, the edits and the lock is in
[docs/project-files.md](project-files.md) (as-6u9.6); this section says how the studio uses them.

The `effects` section is optional; without it the page says how to add one. `model` is optional
(`small-sfx`, the default, or `open-1`): the sound-effects model an effect's new takes start on,
saved from the Sound effects row of Setup's Models panel (`PUT /api/effect-model`, `{ model, was }`,
as `images.model` is), at once and with nothing asked, over a stale `was` refused (§8.8). The
top-level `refresh.shared` (§5) is the game's command that writes the list, with the stingers, run
in the project root only when the user clicks Refresh from the game (the consumer rules in
CLAUDE.md name it). `from.shared` (the list), `clips` and `manifest` are required, and none of them
may contain `{part}` or `{language}`; `clips` and `manifest` are where the studio writes what the
game plays (§8.10). A section without one is a problem naming the path. The edits and the lock are
not named: they are at fixed places, `content-studio/effects/edits.json` (`EFFECTS_EDITS_FILE`)
and `content-studio/effects/lock.json` (`EFFECTS_LOCK_FILE`), both committed with the game.

**The list** is `[{ "id", "title"?, "text", "seconds", "loops"? }]` in the game's order, read only;
the studio reads `text` as the effect's description (`EffectEntrySchema`) and calls it that in its
pages and API. `loops` is an optional
boolean (as-5wc.6): `true` marks an effect the game plays round and round (ambience); absent or `false`, it plays once. An id is a
slug; `seconds` is positive and may be fractional. The list is read entry by entry
(`readEffectEntries`): an entry with a problem, or an id used twice (both entries), is left out and
reported with its file and place (`tts/effects.json at [2].seconds`), and the rest still show. A
file that is not a list is unreadable as a whole. The name shown is the `title` when the game gives
one, else made from the id ("door-creak" is "Door creak").

**The studio's descriptions** are the effects edits, `content-studio/effects/edits.json` (the
studio's own file, committed with the game, never the game's list), one line per effect:
`{ "<id>": { "text", "gameWas" } }`, every kind's rewording. `gameWas` is the game's description
the text was written over. From it the page derives, with nothing else stored,
that the game reworded an effect you changed (`gameWas` differs from the game's words now): the
list shows a second tag and the effect's page a notice. **Keep mine** and changing your own words
set `gameWas` to the game's present words, **Use the game's** drops the entry, so the flag goes only
when decided and survives reloads. Saving an empty text, the game's own words or null drops the
entry. The words of an effect the game dropped stay in the file, shown under the table with
**Forget** (which asks first), and come back if the game lists the id again; an id whose entry is
merely unreadable is not taken for dropped. An edits file that cannot be read (an entry still
written as `words`, say) is reported at its path and never written over.

**Status** is §8.10's: the ring and the sidebar count the effects up to date, over the readable ones only.

### 8.10 Sound effects: takes (as-5wc.4)

An effect's page is a stinger's page without the brief's tempo and key: the **Description** panel, a
green **In the game** block (the chosen take on its own, or a dashed "Nothing plays here yet"), and
the **Takes** panel (the others as cards, two to a row in take-number order). The screens are drawn in
`docs/ui/as-5wc.4-effect-takes.html`.

**Takes.** A take is the description in use (the studio's over the game's) generated for the
`seconds` the game asks, with a new seed, by `EffectGenerator` (§8.8) one at a time: Small SFX's takes on their own queue
(the CPU), Open 1.0's on the GPU queue (§8.8). The model stops when its sound does, so a take ends where its sound
ends (the trailing silence already trimmed) and its **real length** is what the card shows and the
manifest keeps; the length the game asked for stays in the Description panel. Takes are made from the words on disk, so a press of Make or of a failed take's Try again first sees the description saved, as an image's does (§8.7): both buttons and Make's menus are off meanwhile, and no takes are asked for if the words could not be saved; a take retried after the words changed is made from the new words, under their hash (as-ams), and every failed take stays shown with its Try again when the words change (as-j3l). The menu is 1 to 8
takes (starts on 4, page state); a batch goes on when the page is left or reloaded and survives a
`--dev` reload, not a restart. The board is `content-studio/cache/effect-boards/<effect>.json`
(`{ next, takes: [{ n, hash, seed, model, seconds, peaks, inputs }] }`; numbers never reused, reserved
when takes are asked for), the WAV `content-studio/cache/effect-takes/<effect>/<hash>.<n>.wav`, the hash of
the description and length (the model is the take's own field). A take made for an earlier description stays a take, with no mark.
A take that fails is kept in memory as "could not be made" with **Try again**; success clears and
failure records the model's health (Setup's row, §8.8), a stopped take neither. A made take whose board
cannot be written is no failure of the model: it is "could not be made" with the board file as its reason
("content-studio/cache/effect-boards/<id>.json could not be written."), its WAV removed, and no failure recorded
(the model worked, so an earlier failure of it is cleared; as-ct9). **Stop** discards the one being made and the ones waiting.

**Compare.** "▶ The chosen, then this" plays the chosen take, one second of quiet, then the take
(`Clip.after` in `ui/player.ts`); "■ Stop", a second press or any other sound ends it.

**Choose** (no question) encodes the take to `<effect>.mp3` (stereo, 160 kbps, not levelled: effects are
short and the game sets their volume) in the clips folder, written like a music clip: a hidden
temporary file renamed in, then the manifest `{ effect: { file, duration } }` (the game's format, as
music's), the lock last, in the project's one choice turn (`services/effectClips.ts`). The lock
(`content-studio/effects/lock.json`, `{ fp, model, seed, take, inputs: { text, seconds, loops? }, at }`
per effect, one per line in id order through `formatEffectLock`, `text` read back as the
description so the fingerprint and the comparison are as before) records the
take's own inputs. **Un-choose** asks first, then deletes the manifest entry, the clip and the lock
entry last; the take stays on the board. **Drop** removes a take that is not chosen, at once; a
chosen take is refused (409), and the take's line under its buttons says why. A board that cannot be written
refuses Make takes ("No takes were made: content-studio/cache/effect-boards/<id>.json could not be written.") and
Drop ("The take could not be dropped: … could not be written.", the take kept) with a line naming it, never a bare
500 (as-ct9).

**Trim silence** (built, as-dgh.1; one-shot effects only, as stingers' in §8.5 and drawn in
`docs/ui/as-dgh.1-effect-trim-silence.html`): a take card, and the take in the In the game block, has **Trim silence**
at the left of its bottom row (Drop and Choose at the right). It is offered only on a take made to play once for
an effect that plays once (`effectTrimOffered`); a take made to loop never has it. One press cuts the
near-silent start and end (`findTrim` with `EFFECT_TRIM_RULES` in `core/effectTrim.ts`: samples at or under 300
of 32768 are near-silence, 0.01 s of lead-in is kept, a side with under 0.02 s to cut is left alone, so cuts well
under a tenth of a second work). The take's WAV stays as generated; the cut is kept on its board entry as
`trim: { start, end }`, so it survives a reload, goes when the take is dropped, and stays through Un-choose. The
view carries `trim` (with the length left) or `trimmable` (`cut`, `nothing`, `silent`, scanned once per file and
cached in memory; absent on a take that cannot go into the game). The card shows the waveform at its full width
with the cut ends hatched, the new length (one decimal), a "trimmed" tag and a line naming the ends that lost
something, in hundredths of a second (`effectCutLine`). Play, the In the game block and "The chosen, then this"
use `GET …/takes/:file?trimmed=1`, the part between the cuts. **Choose** encodes the trimmed sound, so the
game's file holds it and the manifest the trimmed duration; Trim silence and Undo trim on the take in the game
re-commit it (`commitEffect`, keeping the lock's accepted words and time) first and write the board only if that
worked, and on a take in the game whose clip is missing change only the board. **Undo trim** is always allowed, so
a trim made before the effect began to loop is never stuck (the server refuses a new trim there). A failed
Trim silence or Undo trim says why in red under the take's buttons (in the In the game block, above the line
about Un-choose), and only about the take shown: a later fade saved or removed or Choose again that works
takes it away, and once another take (or none) is in the game it is gone for good, also when the take is chosen
again; a trim still working is never cleared (as-9rs). A board that cannot be written is a refusal that names it,
not a bare 500 ("Take n could not be trimmed: content-studio/cache/effect-boards/<id>.json could not be written.",
as-inp); on the take in the game its clip and its own manifest and lock entries are put back first, in the project's turn so what another effect chose meanwhile stays (`keepEffect`), so "The game
still plays it as it was." holds (if even that fails, the refusal carries `gameChanged` and the reason adds ", and
the game’s files could not be put back", and the line says nothing about what the game plays, as-cy8).

**Status** (`effectStatus`): "none yet" (no take on the board), "not chosen", "chosen", "changed since
chosen" (the description in use or the length differs from the chosen take's own inputs), "clip missing"
(ahead of changed), "not known" (the lock cannot be read; Choose, Drop and Un-choose wait), and, in
the list while a batch is made, "making 4 takes · about 10 s". An effect with a chosen take counts as
chosen in the subtitle, an out-of-date one included; the ring and sidebar count those chosen and
unchanged. **Accept** (`POST /api/effects/:id/accept`) counts the chosen take as made from the
description now, when the description alone changed; a changed length needs a new take (409).
`CONTENT_STUDIO_FAKE_EFFECTS=1` swaps the generator for a stand-in that makes short tones.

**Fades of a one-shot sound effect take** (as-dgh.2; drawn in `docs/ui/as-dgh.2-effect-fades.html`). The stingers' fade editor
(above, §8.5: `FadesEditorBody`, shared) on every take made to play once of an effect that plays once, and on the take in the
In the game block; a take made to loop, and every take of a looping effect, gets none (`effectFadable`, `effectFadesOf` in
`core/effectTakes.ts`), and a take keeps its saved fades while its effect loops, shown and played again when it goes back to
playing once. The lengths move in steps of 0.01 s (0.1 s with Shift; `EFFECT_FADE_STEPS` in `core/fades.ts`), a sound effect
lasting a second or two. Fades belong to the board take (`fades: { in, out, shape }` in
`content-studio/cache/effect-boards/<effect>.json`, absent when it has none), go with a drop, and are never in the lock or
manifest, so fading never marks an effect "changed". The take's WAV stays as generated. `PUT`/`DELETE
/api/effects/:id/takes/:file/fades` run in the board's turn (`setFades` in `services/effectTakes.ts`) and refuse a take made
to loop or an effect that loops, a take that is not there, lengths together longer than the take or negative, and a lock that
cannot be read; when the take is the chosen one the game's `<effect>.mp3` is written first with the faded sound
(`commitEffect` with `soundOnly`: the manifest and lock untouched) and the board second, and a board that cannot be written
puts the game's previous file back (`gameChanged` on the refusal if even that fails); the refusal names the board ("content-studio/cache/effect-boards/<id>.json could not be written.", as-v6w). **Choose** encodes `playedWav`, the take
with its fades, so the game's clip always holds the faded sound, never settings for the game to apply. Every play (the card's ▶,
the In the game block, "The chosen, then this", the editor) asks for the take with its saved fades in the address
(`heardAs`); the editor, its states and its words are the stingers', with the lock line "Choosing, dropping and fading wait
until the sound effects lock can be read." A trim (as-dgh.1) is applied before the fades, as on stingers.

**Effects that loop** (as-5wc.6; drawn in `docs/ui/as-5wc.6-looping-effects.html`). The list's `loops` flag is read
on every read, never stored. A looping effect's take is asked of the model at `seconds` plus a seam
plus a spare second (`loopRequestSeconds` in `core/effectLoop.ts`; the seam is 1 s, at most half of a
short loop, and the spare is dropped because Small SFX fades out in its last tenth of a second to
under a second), then shaped by `shapeEffectLoop`: a sound that lasts to the length is cut at the
end of the seam and the seam crossfaded over the start (`shapeLoop` of music, with a shorter blend),
so the take is exactly `seconds` long and its end runs into its beginning; a sound that stops
before `seconds` is padded with silence to the length, with no crossfade (blending silence over
the start would dip it), and the board take records `quietAt`, which the card shades and words
("Goes quiet at 6.2 s, so it loops with a gap."). It can still be chosen. A take's kind is in its
inputs (`loops`, absent = plays once, in the board and the lock) and in its hash only when it loops,
so one-shot takes keep theirs. A loop plays round on Web Audio (`createClipAudio`), the board's
and the list's ▶ alike (the list plays the chosen clip itself, the MP3 the game plays, which relies
on the encoder's gapless header); a comparison plays a loop for 2 rounds (`Clip.rounds`), a take
made to play once once. `GET …/takes/<file>?seam=1` is the last 4 seconds then the first 4, as
music's. When the game switches an effect between once and looping, the lock's inputs differ in
`loops`: the status is "changed since chosen", the box says "now loops" / "no longer loops"
(alone or after the description or length), and nothing is accepted. Takes of the other kind stay,
marked "made to play once" / "made to loop", and can be played, compared and dropped but not
chosen (the service refuses with 409). Choosing a take of the new kind clears the box.

**Make all** (as-23x.4; drawn in `docs/ui/as-23x.4-make-all.html`). The list's "Effects up to date" panel
carries, beside the count, "N effects have no chosen take" and "Make 4 takes each" (`EffectsMakeAll.tsx`;
the sorting and every sentence are `src/core/effectsMakeAll.ts`). An effect is started when no take is
chosen (a chosen one whose description changed or clip is missing is left out) and it is not already
making takes; the count ignores the list's filter. The button opens a question in the panel and starts
nothing; Make posts the listed ids to `POST /api/effects/make-all`, and the service decides again who is
eligible, then calls the ordinary `make` with 4 takes per effect, so the model is a hand start's (Setup's,
else the other one when it cannot run, and the question says so). While anything is making takes the
panel shows the running line (worked out from `GET /api/effects/making`, hand starts included) and
**Stop all** (`POST /api/effects/stop-all`, every waiting or running take of the project; made takes stay).
The service keeps the latest press in memory (`contentStudioEffectBatches`, like the entries) as the
takes it started, so `GET /api/effects/batch` can say how many were made, stopped (by Stop all or an
effect's own Stop) and failed; the page shows that as a summary, in place of the count line and button, in every tab and after a reload (as-4m0),
until Close (`POST /api/effects/batch/close`, for every tab), a new press, or takes started by hand once the
press has ended; a quit forgets it. `GET /api/effects/models` says which models can run (the question's model line and "Open Setup").

### 8.11 Scenes: the files the game and the studio share (as-p86)

A **scene** is a place the game plays sound in (RetroQuest: a room, with its music track): its music
loop and level, and the sound effects that play with it, how, in which state and how loud. Until
now this lived in the game's code (`ROOM_AMBIENCE`, `effectVolumes.json`). The Scenes workspace
edits it and plays it as the game would. The screens are drawn in `docs/ui/as-p86.1-scenes.html`;
what a person sees is the acceptance of bead as-p86.1. This section is the **contract** the game
(RetroQuest beads rq-xazj, rq-xfkn) and the studio (as-p86.2 to .4) are built against.

**Two files per act, each with one writer.** The game's refresh writes the **declarations**; the
studio writes only the **mix**. Neither is ever written by the other, so a Refresh from the game
cannot lose a setting and a Save cannot change what the game declares. Both are named in an
optional `scenes` section of the project file, in the `{part}` form of the music lists (an act is
a part); the project file is only read, so the consumer rules' list of places it is changed does
not grow.

```json
"scenes": {
  "from": { "part": "tts/{part}/scenes.json" },
  "output": { "lufs": -20, "tolerance": 2 },
  "mix": "web/src/lantern/scenes/{part}.mix.json"
}
```

The format of the section, the scene list, the mix and the scenes lock is in
[docs/project-files.md](project-files.md) (as-6u9.7); this section says how the studio uses them.

Without the section the sidebar has no Scenes workspace. Neither path may hold `{language}`. The
mix is a file of the game (the game imports or fetches it, so it takes effect the next time the
game starts), so its folder is the game's choice; the declarations are the music lists' sibling.
Refresh from the game on the Scenes page is `refresh.part` for the part, as on an
act's Music and Images pages (the game's one command for an act's lists; no new command, no new
consumer rule beyond naming this page).

**The declarations** (`scenes.from.part`, game-written, read only, in the game's order):

```json
[
  {
    "id": "act1-general-store",
    "title": "General store",
    "states": ["plain", "cat-home"],
    "triggers": ["door-opens"]
  }
]
```

- `id`: the scene's slug (`^[a-z0-9]+(-[a-z0-9]+)*$`), unique across the game's acts. RetroQuest
  uses the room's music track id (`roomTrackId`), so a scene's own track and its old
  `effectVolumes.json` key are its id.
- `title`: what the page calls it (the scene's `name` in the studio's pages and API). `states`: the scene's **named sound states**, the first being the
  game's default; `[]` or absent when the scene has none. The game names its default state: where
  a room's `soundState()` answers `''` today (GeneralStore, ForestPath) the declarations call it
  `plain` and the game reads a runtime `''` as that state (rq-xazj does the mapping, once, where
  the scene is entered; the mix always holds the names). A room whose states are all named
  (`withered`/`green`, `dim`/`lit`) lists just those, the first being the default; the studio draws
  each state under its own name, so "plain" appears only where the game names a state so. `triggers`: the names the
  game can fire in the scene; `[]` or absent when none. State and trigger names are slugs, unique
  within the scene.
- The list is read entry by entry, as the effects list is (§8.9): an entry with a problem, or an id
  used twice (both), is left out and reported with its file and place; a file that is not a list
  is unreadable as a whole. A file that is not there yet is "the game has not listed its scenes".

**The mix** (`scenes.mix`, studio-written, game-read), one object per act:

```json
{
  "scenes": {
    "act1-general-store": {
      "music": { "track": "act1-general-store", "level": 1 },
      "effects": [
        { "id": "shop-bell", "play": { "mode": "once", "afterSeconds": 1.5 }, "level": 0.6 },
        {
          "id": "glass-clink",
          "play": { "mode": "random", "everySeconds": [15, 30] },
          "level": 0.5
        },
        { "id": "cat-purr", "play": { "mode": "loop" }, "state": "cat-home", "level": 1 },
        { "id": "door-creak", "play": { "mode": "trigger", "trigger": "door-opens" }, "level": 1 }
      ]
    }
  }
}
```

- `music`: `track` is the id of a loop in the act's music list (§8.5) or of a shared loop, or `null`
  for no music; `level` is the loop's level, 0 to 3 like an effect's, 1 as chosen. The music level
  is the music's alone: it does not change the effects, which the game keeps following the music's
  fades (a crossfade, a dip under a voice) but not its level. Above 1 the game raises the music
  with a gain, not the element's volume. The shared loops are what `refresh.shared` lists;
  today it lists only stingers, which are not loops, so the menu's "shared tracks" are none until
  the game lists some. Absent `music`: what the game chooses for the scene now (its own track when
  it has a chosen take or a file of the game's own, else the act's loop) at 1. A track with neither
  plays no music; the
  scene's effects play all the same. `effects` absent or `[]`: no effects. A scene with no entry at all plays
  its own track and no effects.
- An effect's `id` is one of the game's sound effects (§8.9); the same id may appear twice in a
  scene (two ways to play it). `play` is one of `{ "mode": "loop" }` (round and round),
  `{ "mode": "random", "everySeconds": [N, M] }` (now and then: a random wait of N to M seconds
  before each start, `0 <= N <= M`; the studio's page asks for `N < M`, within 0 to 600 s, and the game reads what the file holds), `{ "mode": "once", "afterSeconds": N }` (once, N seconds after
  entering; it does not sound again until the scene is entered again), and
  `{ "mode": "trigger", "trigger": "<name>" }` (each time the game fires that trigger in the
  scene). `state`, when present, is one of the scene's states: the effect plays only while the
  scene is in it; absent means always. `level` is a number from 0 to 3, 1 being the clip as made
  (the game's `MAX_EFFECT_VOLUME`); it multiplies, as `effectVolumes.json` did, the music's and the
  player's own levels. Row order is the order of the table; it does not affect playing.
- The studio writes the whole file again with stable key order (scenes in the declarations' order,
  then any scene the game no longer declares, in their old order) and two-space indentation (a scene's entry with effects has a line to each effect, a short one is on one line, so a Save changes the lines of its own scene), through
  `writeAtomic`. A Save changes one scene's entry only, and only an act's file is rewritten. A
  `PUT /api/scenes/:part/:id` carries `{ scene, was }` (`was` the entry as the page read it); a
  stale `was` is refused with 409, as the model saves are (§8.8).
- **Gone from the game** is derived on every read, never stored: a state, trigger or effect id in
  the mix that the declarations or the effects list no longer have. It stays in the file, shown
  with its mark, and the game ignores it (a state not in the scene never matches; a trigger never
  fires; an unknown effect id has no clip). The studio never removes it except when the user does.
  A scene in the mix the game no longer declares is not shown and stays in the file.
- **Silent**: an effect with no chosen take (§8.10) has no clip in the manifest; the game and the
  studio play nothing for it. This too is derived.
- **Unreadable is not gone**: while `tts/effects.json` cannot be read, no effect is marked gone; while
  a declarations entry is left out for a problem, none of its states or triggers is (§8.9's rule for
  an id whose entry is merely unreadable).
- The same effect id twice in a scene is two rows with two levels: the game must key levels by row,
  not by effect id (`Ambience.setVolume`, `solo` and `audition` are id-keyed today; rq-xazj changes
  that). `afterSeconds` is 0 or more.
- A mix file that does not exist yet is an empty mix; the first Save creates it, its folder
  included. A mix file that cannot be read (not JSON, wrong shape) is reported with its file and JSON path
  per scene entry and never written over; the page shows the other scenes. An entry with a
  problem is left out and kept as it is on a Save of another scene. The game reads the mix scene by
  scene in the same way (a bad entry plays that scene as if it had none, the rest play), not as a
  whole file, so a hand edit cannot silence every scene.

**How the game plays a scene** (what the studio's play bar copies): the **effects belong to the
scene, not to its music** (rq-xazj moves them off the track's voice): they play with `track: null`
and with a track that has neither a chosen take nor a file of the game's own. Entering a scene whose music is already playing carries
the music on and swaps the effects: those of the scene left stop, those of the new one start.
Entering the scene starts its music and every effect whose state is the scene's current one (the first state at entry, unless the
game says otherwise). Loops loop; a random effect waits a random time in its range before each
start, including the first; a once effect starts after its delay. When the state changes, an effect
that plays only in the old state fades out and one that plays only in the new state fades in
(0.3 s, `STATE_FADE_SECONDS` of `ambience.ts`); the music and effects with no state carry on, and a
once effect that has sounded does not sound again. Leaving a state cancels the wait of a random or
once effect that plays only in it, and coming back starts the wait afresh (a once effect that has
not sounded waits its full `afterSeconds` again); only loops fade, a random or once effect simply
starts its wait. A trigger plays the effects bound to it at once,
once each (an effect with both a trigger and a state plays only while the scene is in that state). Changing the music's track is not something the game does mid-scene.

**Studio side** (for the children): `src/core/scenes.ts` holds the schemas, the reading of both
files entry by entry, and `summarizeScenes`, which derives gone and silent and the counts for the
list (pure, no I/O); `src/services/scenes.ts` reads the two files of every act (`resolveInRoot`,
`readJson`) and joins their problems to the project's; `saveScene` writes the mix.
**Editing** (as-p86.3): the open scene's unsaved draft lives in the page (`src/ui/sceneDraft.ts`, the
rules in the pure `src/core/sceneEdit.ts`: defaults, the red boxes and their words, `toMix`); one
scene at a time, and whatever would leave it (another scene, page or Back, Refresh from the game)
asks first, the browser asks on closing the tab. Save sends `{ scene, was }`, `was` being the entry
the page read (`SceneRow.entry`, null for none). The service re-reads the mix, refuses an unreadable
file or entry, answers `stale` with the entry now saved when `was` differs, and otherwise writes the
whole file again with only that scene replaced (its entry is written from the fields the studio knows: a field of that scene's entry it does not know is dropped on Save) (scenes in the declarations' order, then the rest in
their old order, entries that cannot be read kept as they are). The Add menu and Music menu are
offered `ScenesSummary.effects` and `SceneAct.tracks`.
The Add menu opens below its button, or above it when it does not fit below but fits above, or on
the side with more room with a shorter list when it fits neither (`placeMenu` in `core/menuPlacement.ts`,
measured to the window's bottom edge, as-c9u); typing keeps the side, a resize or scroll chooses again.

The Scenes workspace is read with the rest of the project: `ProjectSummary.scenes` (null without the
`scenes` section) carries every act's scenes, so the sidebar's counts, the page and Refresh from the
game (which invalidates the project) need no route of their own; the `PUT` above is built (`saveScene`), and
no `GET /api/scenes/:part` is built. What a scene's rows say of the rest of the studio comes from the
summaries already read: an effect is _silent_ when its lock has no chosen take, _playable_ when the
chosen take's clip is there; the music is _playable_ when the act's music list has the track with a
chosen take, or with the game's own file, that is there. A scene the mix has no entry for reads as an empty one; where the mix has no `music` the page shows the scene's own
track at 100% when the act's list has it, and "No music" otherwise (the contract's fallback to "the act's loop"
cannot be told from the files, which name no act-level loop); a scene whose entry cannot be read is listed as
"unreadable" and shows none of its rows. The page is `src/ui/features/scenes/`: a ▶ plays one clip
alone at its level through Web Audio (`src/ui/sceneClip.ts`, a gain, since levels reach 300%), over
`/api/music/tracks/:id/current` and `/api/effects/:id/current`. The unsaved scene lives in the page (one at a
time). **Playing** (as-p86.4): the rules above are `src/core/sceneEngine.ts`, a pure engine that is
told the time (seconds since the scene was entered) and answers with cues (start or stop a row's clip,
with a fade or not) and what each row is doing (`RowNow`); it takes a `random` function and has no
clock, so it is tested without audio. Rows are matched across an edit by id, play and state (not
level): an unchanged row carries on, a changed or added one begins afresh, a removed one fades out.
A random row's next wait counts from the end of its clip. `src/ui/scenePlayback.ts` runs the engine
on Web Audio: it loads every clip first (Loading…), then enters the scene, ticks every 250 ms, and
gives each sounding clip a fade gain (0.3 s on state changes, mute and solo, ■; one second for a music
crossfade) and a level gain (a level change is heard at once). `src/ui/sceneRun.ts` is the hook the
page uses (what is on the page, saved or not, is what plays; State, Mute and Solo live there and
are never saved); `src/ui/sceneNow.ts` words the Now column. Mute and solo are keyed by the row's
place in the table and by `music`. Nothing of playing survives opening another scene or a reload.
A scene's track that plays nothing says why in a chip after the Music menu (as-xdx): each act track
carries a `problem` derived on every read from what the Music page knows (`take` or `file` missing: a red
"file not there"; neither chosen nor in the game: an amber "no take chosen"; none when the lock cannot be
read), and the chip links to the track's page and follows the track chosen in the menu before saving.

**Loudness** (as-gdf.1; the screens are `docs/ui/as-gdf.1-scene-loudness.html`). The project file may
say what the game's scenes should sound like: `scenes.output` is `{ "lufs": -20, "tolerance": 2 }`
(integrated LUFS and dB, both or neither; the studio calls `lufs` the target), edited by hand and
only read; without it nothing is flagged. The open
scene's **Loudness** panel and the scene list's count column show the last measure of the act.
**Measure loudness** (`POST /api/scene-loudness/:part`, with `open: { scene, entry }` when the open
scene has unsaved changes) measures every readable scene of the act in the background, one after
another, and returns at once; `GET /api/scene-loudness` says how far each running act has got
(`{ act: { done, total } }`, in memory: a quit forgets it), and the page asks once a second while any
runs. A scene is measured in each of its states (`core/sceneLoudness.ts`, `planStateMix`): one
steady-state minute of the mix the play bar would play, with no chance in it so a figure is the
same every time. The music loops at its level; a loop effect fills the minute; a random effect
starts in the middle of its range and again after each clip and wait; a once effect sounds at its
delay if that falls inside the minute; a trigger effect is not counted (the player fires it). An
effect plays in a state if it has none or that one. Sounds with no take chosen, or no file, are left
out and named, but an effect only when the minute would have played it (`statesPlaying`), once
however many rows it has, with the states when that is only some of them ("rain in rainy and
storm"). The minute is mixed by ffmpeg (`services/sceneAudio.ts`: `amix` with each level as a
`volume`, then loudnorm's first pass, as `levelClip` measures) and the figure is the integrated
loudness (BS.1770), so silence between sparse effects is gated out as in any LUFS reading; a state
with nothing playing has no figure ("nothing plays") and is never flagged. A figure is judged
against the target in `core/sceneLoudness.ts` as it is shown (rounded to one decimal, so the figure,
the distance and the chip agree): within the tolerance is "on target", else "N dB too
quiet / too loud" by how far from the target; a scene whose states disagree is "off target" in the
list. The figures are **kept** in each act's scenes lock, `content-studio/scenes/<part>.lock.json`
(committed; scene id to `saved`, the measure of the saved scene, and `draft`, the open scene's
measure with its unsaved changes, kept beside it so Discard puts the saved figures back), written
one scene per line in id order through `formatEntriesPerLine`. Each measure remembers the scene's entry
and the clip each sound played (its take or the game's file); the page says "changed since
measured" when the saved entry or one of those clips is no longer the same, or, before Save, when
the levels on the page differ from those measured. A Save makes a draft
measured from exactly the saved entry the saved figures, and drops any other draft
(`services/sceneMeasures.ts`). A lock only holds figures that can be measured again, so one that
cannot be read is reported and read as empty, never written over, and Measure loudness on its act
is refused naming it; the other acts are not affected. The figures reach the page with
`ProjectSummary.scenes` (`SceneRow.loudness`, `ScenesSummary.loudnessTarget`).

**Bringing a scene back to the target** (as-gdf.2; `docs/ui/as-gdf.2-loudness-suggestion.html`). When
a measure puts a scene off the target, one line under the Loudness table offers a single change for
the whole scene (`suggestChange` in `core/sceneLoudness.ts`): the even dB that puts the middle of the
measured states on the target, one decimal; the closest one when no change fits every state; only as
much as keeps every level within 300%, and the line then names each state ("The scene" when it has none) still too quiet, with its own figure; nothing when the states disagree and the best change is under
0.5 dB. The press (`scaleDraft`) multiplies the music and every effect by the same factor, to a whole
percent, **on the page only**: Save keeps it, Discard undoes it. The table then shows the expected
figures (measured + dB). The page sends the move with Save (`moved: { db, measuredAt }`); if the
measure made at `measuredAt`, moved by `db`, is exactly the scene saved, `sceneSaved` keeps that
measure as the saved one with `moved: { db }`, and the figures stay the expected ones while the saved
scene is still that (`expectedFigures`) until the act is measured again. A scene changed by hand
after the press, or saved differently since the measure, gets no suggestion: while the scene has unsaved changes the
page is what the measure is compared with, saved press or not. A music with no track has no level, so the
press leaves it alone and the expected scene does too. The levels a press moved show in amber on the page
(with "was N%" for a screen reader) until saved or discarded.

**When a louder change has no room** (as-w5p; `docs/ui/as-w5p-loudness-ceiling.html`). A scene that
needs to be louder while a sound is within 0.1 dB of 300% gets `suggestChange` kind `limit` instead
of nothing: a muted line, no button, naming every sound at the limit with its real level (the music
as "the music"), or saying the sounds themselves are too quiet when every playing sound is there
(`limitLine` in `ui/scenesText.ts`). A too loud scene always gets the ordinary change.

## 9. Server API

Built so far: `GET /api/project`, `GET /api/narration/progress` (each act's ok lines out of all, in a language), `GET /api/parts/:part` (with every line's status),
`POST /api/parts/:part/adopt`, `GET /api/parts/:part/clips/:file`,
`GET /api/characters/:id/voice` (its cast voice as Fish knows it, its take and the audition
phrase; one lookup, no search), `PATCH /api/characters/:id`
(keywords or phrase), `POST /api/characters/:id/takes` (record a take), `GET /api/takes/:file`,
`POST /api/parts/:part/lines/:key/try` (`{ cue }`: a take of the line said with that cue, nothing saved; with `at`, the cue is added at that gap inside the line)
and `POST /api/parts/:part/lines/:key/record` (record one line into the clips, manifest and lock;
`{ confirmedCost }` on a paid model, else 409 with the ceiling to confirm),
`GET /api/parts/:part/plan?speaker=&weak=1` (what generating would do, weak lines included if
asked), `POST /api/parts/:part/jobs` (`{ kind: record | measure | check, speaker, keys, orphans,
retakeWeak }`: start a generation, a measuring or a checking again, the server planning it afresh), `GET /api/parts/:part/jobs/latest`, and
`GET`/`DELETE /api/jobs/:id` (progress, cancel).
Takes are cached in `content-studio/cache/takes/<key>.mp3`, the key a hash of the take's model (the audition model on the board, the free one for the cast voice's page take and tries, ElevenLabs' audition model for an ElevenLabs voice's, with its voice settings), voice,
spoken phrase and settings, so a take is recorded once. Auditions: `GET` and `DELETE
/api/auditions/:id`, and `POST /api/auditions/:id/` `start`, `move` (`{ voice, move: shortlist | unlist | drop }`),
`undo` (the last drop), `more` (`{ provider }`, `fish` unless `elevenlabs`; no body is Fish's), `add` and `cast` (`{ voice }`, a shortlisted one); `start` takes `{ spendUpTo }` on a paid audition model and `{ creditsUpTo }` for ElevenLabs voices' takes; `GET`, `POST` (`{ amount?, credits? }`, a fresh sitting) and `DELETE /api/auditions/:id/sitting` and `POST …/sitting/add` (`{ amount }` or `{ credits }`, the first credits giving a sitting its ElevenLabs half) are the audition's money, and `GET /api/elevenlabs/account` the plan's account and what is held of it, `GET /api/elevenlabs/voices/freeable` the voices the studio added that nothing uses and `POST /api/elevenlabs/voices/free` (`{ voices }`) removes them; a board take is `POST /api/characters/:id/takes` with `{ voice, board: true }`; sessions are kept in `content-studio/cache/auditions/`. Ruled-out voices:
`GET`/`DELETE /api/characters/:id/ruled-out` (list, forget all) and
`DELETE /api/characters/:id/ruled-out/:voice` (allow one again). Every route of a character, its
voice, takes, audition and ruled-out voices takes `?language=` (the source language when absent or
not declared), and casting changes that language only. So does every route under
`/api/parts/:part` that reads or writes a language's files (its lines' heard, note, check, accept,
record, try, takes and take files, cues and their moves, the plan, adopt, jobs and `jobs/latest`),
and `PATCH /api/pronounce` and `PATCH /api/sound-alike`, which save that language's own table or
groups. The rest is the plan:

```
GET    /api/project                              project, parts
POST   /api/scene-loudness/:part                 measure every scene of an act in the background ({ open?: { scene, entry } }; 409 if it is being measured)
GET    /api/scene-loudness                       the acts being measured, scenes done out of all
GET    /api/credit                               the Fish account's API credit (dollars)
GET    /api/setup                                what the machine and project lack (ffmpeg, uv, key, Fish, ACE-Step)
POST   /api/music/tracks/:id/keep-mine           keep the studio's brief over the game's changed one (404 for a track nobody lists)
GET    /api/music/tracks/:id/takes               a track's takes, those being made, failures, and whether takes can be made
POST   /api/music/tracks/:id/takes               { count } or { retry } queue takes (409 and why if the generator is not ready)
POST   /api/music/tracks/:id/choose              { file } make a take the track's music: levelled, encoded, manifest and lock written (409 and why if it cannot)
POST   /api/music/tracks/:id/remove              remove an orphan's music: clip, manifest, lock, board, takes, brief changes (404 if it is not one)
GET    /api/music/clips/:file                    a music clip (a plain .mp3 in the music clips folder)
POST   /api/music/tracks/:id/stop                stop the takes: the one being made ends and is discarded, the waiting ones are cancelled
POST   /api/music/tracks/:id/trim                { file, undo? } cut the near-silence of a stinger take, or give it back as generated; rewrites the game's file when it is the one in the game (409 and why if it cannot)
POST   /api/music/tracks/:id/move                { file, to } move a take to the track `to` of the same kind: `{ ok, n }` its new number (409 and why if it cannot)
DELETE /api/music/tracks/:id/takes/:file         Drop: take it off the board and delete its file (409 if it is not on the board)
GET    /api/music/making                         what is being made, by track ({ takes, left seconds }), for the lists' status
GET    /api/music/tracks/:id/takes/:file         a take's WAV (?seam=1: its seam)
PATCH  /api/fish-tier                            { tier } the Fish tier (or null) in content-studio/cache/settings.json
GET    /api/parts/:part?language=                the part in a language (default: the first), every line
                                                 with its status and reason, and each language's progress
GET    /api/parts/:part/clips/:file?language=    a clip from the part's clips folder (that language's)
GET    /api/parts/:part/lines/:key/heard         what Whisper heard of the line's take, if kept
POST   /api/parts/:part/lines/:key/try           hear the line with a cue ({ cue }): a take, nothing saved
PATCH  /api/parts/:part/lines/:key/note          the user's note on the line ({ note }; empty removes)
GET    /api/parts/:part/lines/:key/takes         the line's extra takes, newest first, current or stale
POST   /api/parts/:part/lines/:key/takes         one more take into the cache; a paid draft model asks for `{ confirmedCost }`
GET    /api/parts/:part/lines/:key/takes/:id.wav a take's audio
POST   /api/parts/:part/lines/:key/takes/:id/use make the take the line's clip (as a recording)
DELETE /api/parts/:part/lines/:key/takes/:id     drop the take
POST   /api/parts/:part/lines/:key/accept        accept a weak line's clip as it is (lock `accepted`)
POST   /api/parts/:part/lines/:key/check         check a weak line's clip again with Whisper (no new audio)
POST   /api/parts/:part/refresh                  run refresh.part (its result names the act's loops added and removed)
PUT    /api/music/tracks/:id/takes/:file/fades  save a stinger take's fades (DELETE removes them); GET …/takes/:file?fadeIn&fadeOut&shape hears them
POST   /api/music/stingers/refresh               run refresh.shared; the stingers added and removed
POST   /api/effects/refresh                      run refresh.shared; the effect ids added and removed
PATCH  /api/effects/:id                          the studio's description of a sound effect ({ description }; null or empty: the game's)
POST   /api/effects/:id/keep-mine                keep the studio's words after the game reworded the effect
POST   /api/effects/:id/forget                   delete the words of an effect the game no longer lists
GET    /api/effects/:id/takes                    the effect's takes, those being made and failed
POST   /api/effects/:id/takes                    make takes ({ count, model? } 1–8, or { retry })
GET    /api/effects/:id/takes/:file              a take's WAV (?seam=1: its seam, the last 4 seconds then the first 4)
DELETE /api/effects/:id/takes/:file              drop a take that is not chosen
PUT    /api/effects/:id/takes/:file/fades        save a one-shot take's fades ({ in, out, shape }; DELETE removes them); GET …/takes/:file?fadeIn&fadeOut&shape hears them
POST   /api/effects/:id/choose|unchoose|accept|stop   choose a take ({ file }), take it back, accept a changed description, stop the batch
POST   /api/effects/:id/trim                     { file, undo? } cut the near-silence of a one-shot take, or give it back as generated; rewrites the game's file when it is the one in the game (409 and why if it cannot)
GET    /api/effects/clips/:file                  a chosen clip (plain `.mp3` only)
GET    /api/effects/:id/current                  the clip the game plays for the effect
GET    /api/effects/making                       the batches being made, by effect
GET    /api/effects/models                       which sound-effects models can run, and the project's
POST   /api/effects/make-all                     four takes for each listed effect with no chosen take ({ ids })
POST   /api/effects/stop-all                     stop every take waiting or being made
GET    /api/effects/batch                        what the latest make-all made, stopped and failed (null: none)
POST   /api/effects/batch/close                  forgets that summary (Close)
GET    /api/music/lists/:id/batch                the latest make-all of a list; POST …/batch/close forgets it
GET    /api/image-acts/:id/batch                 the latest make-all of an act; POST …/batch/close forgets it
PUT    /api/effect-model                         the project's sound-effects model ({ model, was }; stale `was` 409)
POST   /api/parts/:part/adopt                    write lock from existing clips
PATCH  /api/parts/:part/cues/:key                line cue ({ cue }; empty: the style again)
PATCH  /api/parts/:part/cues/:key/inside         a cue at a gap inside the line ({ at, cue, text }; empty cue: remove;
                                                 refused when `text` is no longer the line's words)
POST   /api/parts/:part/cues/:key/move           an orphaned cue to a line ({ to }; null: remove)
PATCH  /api/parts/:part/scene-cues               a scene's cue ({ scene, cue }; empty: remove)
POST   /api/parts/:part/scene-cues/move          an orphaned scene cue to a scene ({ from, to }; null: remove)
GET    /api/parts/:part/plan?speaker=&weak=1&stage=final   scope → plan (no side effects)
GET    /api/characters                           all characters, with the parts and line counts of each
PATCH  /api/characters/:id                       style, speed, keywords, phrase
PATCH  /api/pronounce?language=                   a language's pronunciation table ({ table, was }: whole)
PATCH  /api/sound-alike?language=                 a language's sound-alike groups ({ groups, was })
PATCH  /api/models                               the draft/final takes on s1 to s2.1-pro ({ takes }; refused if the file's s1 takes differ)
GET    /api/models                               the stage models, the dialog's size, clips by model, and what is busy
PUT    /api/models/:stage                        one stage's model ({ model, was }; refused if the file differs, the model is unpriced or s1, or something is recording)
GET    /api/spending                             paid recordings: totals per part, running ones live, or the record's problems
GET    /api/characters/:id/voice                 the cast voice from Fish, its take, the phrase
GET    /api/characters/:id/ruled-out             voices ruled out for it, the latest first
DELETE /api/characters/:id/ruled-out             forget them all
DELETE /api/characters/:id/ruled-out/:voice      allow one again
GET    /api/auditions/:id                        the audition in progress, with phrase and takes
DELETE /api/auditions/:id                        stop it without casting
POST   /api/auditions/:id/start                  an audition: cast voice on the shortlist, nothing to hear
POST   /api/auditions/:id/move                   shortlist, unlist or drop a voice
POST   /api/auditions/:id/undo                   undo the last drop
POST   /api/auditions/:id/more                   more candidates to hear ({ provider? }: Fish's library or ElevenLabs')
POST   /api/auditions/:id/add                    a voice by its Fish id
POST   /api/auditions/:id/cast                   write a shortlisted voice to cast.json
POST   /api/characters/:id/clone-voice           a private voice on the Fish account from recordings (multipart: title, voices)
POST   /api/characters/:id/cast-voice            cast a voice no audition holds ({ voice, name }); ends an audition going on
GET    /api/characters/:id/designs               the description the design box starts with, and what an ElevenLabs design would say and cost (eleven: { text, credits }, null without an audition phrase)
POST   /api/characters/:id/design                have Fish design voices ({ description, spendUpTo: 0.01 }), or ElevenLabs ({ description, provider: 'elevenlabs', creditsUpTo }); 409 until the cost is confirmed and covered
POST   /api/parts/:part/jobs                     run a plan ({ stage: draft | final }; one job per
                                                 part and language at a time); a paid
                                                 one with { confirmedCost }, else 409 with
                                                 { reason: confirm | credit | price, ceiling }
GET    /api/parts/:part/jobs/latest              the part's latest job in the language asked for
GET    /api/jobs/:id                             a job's progress (polled while it runs)
DELETE /api/jobs/:id                             cancel
POST   /api/characters/:id/takes             record a take (own page only)
GET    /api/takes/:key.mp3                   a recorded take
GET    /api/changes                              git status of project paths
WS     /api/events                               file changes (later; job progress is polled)
```

Planned (step 6): the server watches the resource files, so an edit made in the editor (or a
`git checkout`) shows up in the UI at once. Until then the UI reloads when its window regains focus.

---

## 10. Errors and safety

- An invalid project file or resource opens the UI on an error page that names the file, the path
  in the JSON, and what is wrong (from zod), instead of failing on the command line.
- Missing tools and a missing API key are shown on the **Setup** page (`GET /api/setup`, built):
  ffmpeg, uv for Whisper (off when `generate.transcriber` is `none`; a problem off Apple silicon),
  the Fish key in the environment or the env file (read on every check, as `env` above says), whether
  Fish answers (the server's credit
  lookup, only with a key), Requests at once (`generate.parallel` against the Fish account's limit
  from the setting `fishTier` (§5): ready up to 5 with no tier, a problem above it until the tier is
  chosen, and above the chosen tier's limit; off without a key; saving the tier checks again,
  which asks Fish once more), the optional `refresh.part` and, with a `music` section, the music
  generator (Apple silicon, uv, and the two model folders of the project's music model, Balanced's
  `acestep-v15-xl-turbo` and `acestep-5Hz-lm-4B` by default, in `$ACESTEP_CHECKPOINTS` or
  `~/.cache/ace-step/checkpoints`; downloaded outside the studio, about 28 GB for Balanced; when
  the project's model is a Stable Audio one, only the machine and uv) and, in a row of its own, the
  optional Stable Audio Open models in `~/.cache/stable-audio` ("Not set up" until they are there,
  "Needs attention" only when the project's music model is one that is missing, with three numbered
  steps: accept the licence, make a read token, download), with an `images` section the image models
  (**Image models**: mflux, and for FLUX.2 klein 4B and Z-Image-Turbo whether the whole download is in the Hugging Face cache,
  `HF_HUB_CACHE`, else `$HF_HOME/hub`, else `~/.cache/huggingface/hub` (`imageModelDownload`: `absent` with no folder; `whole` when a snapshot holds a
  `.safetensors` file, no snapshot link points at a missing blob, every shard a `*.safetensors.index.json` names is there and no blob is `.incomplete` (a leftover from an interrupted download does not count once an index vouches for the snapshot: an index is there, no folder with a `config.json` or shards still lacks its index or single weights file, and every part a `model_index.json` lists has its folder, where the model has that file: klein's and Z-Image's snapshots do not, so for them a part whose folder has not appeared cannot be told);
  else `partial`), and whether the model's last take failed (the studio's own memory, `content-studio/cache/image-model-health.json`, one entry per model with the
  image, take and the last line of the image tool's error, written when a take fails and removed when a take with that model works; a stopped take is no failure;
  it survives a restart). "Ready" with both whole and no failed take; for a model that is partly downloaded, not on the computer or failed: "Not set up" (Optional)
  when it is the other model, "Needs attention" when it is the project's model or neither model can run (and mflux itself), the incomplete download beating
  a failed take; each with numbered steps ("Finish the download", "Download it") and the commands, and a failed take with the tool's error line, a link to the image
  while it is in the game's lists, and what clears it; the two model menus (Setup's Images row, an image's "Model for new takes") mark "— download incomplete"
  (not pickable) and "— last take failed" (pickable), and an image's new takes start on the other model when the project's failed its last take and the other
  is whole; "Not used" without an `images` section), and two optional ElevenLabs rows (§8.6):
  its key ("Not set up" until there is one, saying where it goes) and its account (asked only with a
  key: the plan, the credits left of its allowance and when they renew, what may be billed
  beyond them, the voice slots used, and what the plan allows), each with what to do about it.
  Checked afresh each time the page opens and on Check again; the sidebar, on every page, counts
  the problems from a check at most five minutes old and never on a window focus, so the studio
  does not ask Fish more than it did. The CLI still warns about ffmpeg, and recording says so.
- Writes outside the project root throw. Deleting clips (orphans) always needs confirmation.
- Fish errors (no credit, voice removed) mark the line as failed with the reason; the rest of the
  job carries on. Too many requests at once (429: Fish allows 5 at a time until $100 has been
  paid in, 15 until $1,000, then 50, as its pricing page said on 2026-10-25; it sends no
  `Retry-After`) is not an error: the client asks again after 1 s, then 2, 4, 8, 16 and 32 s, and
  only then gives up, saying to lower `generate.parallel` or wait for other work on the key. The
  studio itself never has more than `generate.parallel` TTS requests in flight (one limiter for
  lines and audition takes alike), so a 429 means `parallel` is set above the tier, or something
  else uses the same key.
- The studio never runs `git add`, `commit` or `push`.

---

## 11. Testing

- `core/` is covered by `bun test` unit tests: fingerprint stability, planner statuses and reasons,
  spoken-text building, chunking, alignment (ported from `test_narrate.py`), audition state
  transitions.
- `services/` are tested against fakes (a fake `FishClient` and `Transcriber`), plus a few opt-in
  live tests behind an env flag: `AUDIO_STUDIO_LIVE_MUSIC=1` for the local music models, and
  `AUDIO_STUDIO_LIVE_ELEVENLABS=1` with `ELEVENLABS_API_KEY` for a paid Eleven Music take.
- The server API is tested with an in-memory project fixture (a small consumer repo in
  `test/fixtures/`).
- UI: component tests for the audition and line table; one Playwright smoke test over the fixture.
- A component test renders into a DOM from `@happy-dom/global-registrator`, registered by the test
  file itself before it imports React, so the other suites run without one (first:
  `SpeedEditor.test.tsx`).

---

## 12. Delivery plan

Small, independently useful increments:

1. **Skeleton**: CLI finds and validates the project, server and UI shell, parts and characters
   shown read-only.
2. **Status**: fingerprint, planner, lock, _Adopt existing clips_; line table with statuses. No API
   calls yet.
3. **Audition**, in three pull requests:
   1. **Voice search**: Fish client, API key from the env file, keywords saved in the cast, ranked
      candidates with Fish's own samples.
   2. **Takes**: the audition phrase spoken by each candidate in the character's style, cached.
   3. **Rounds and casting**: keep/drop, bring in more, add by id, saved sessions, the chosen voice
      written to `cast.json`.
4. **Generate**, in two pull requests:
   1. **Record a line**: TTS per chunk (WAV, the draft model), joined with a 0.25 s pause, encoded
      with ffmpeg; the manifest (written exactly as Python's `json.dumps(indent=1)`, so untouched
      entries keep their bytes) and the lock updated. Word timings are spread evenly over the clip
      until step 5 transcribes it. A _Record_ button per line on the lines page.
   2. **Generate a part**: a plan for a scope (the part, a character), run as a job with progress and
      cancel, orphaned clips removed after confirmation.
5. **Quality**, in two pull requests:
   1. **Checked takes**: a Whisper worker (`worker/transcribe.py`, mlx-whisper through uv, the
      model loaded once; it exits when the studio does), narrate.py's alignment ported exactly
      (difflib's matching and Python's rounding; fuzz-compared on 300 cases), and up to
      `quality.takes` (`generate.takes` since as-6u9.3) takes per line until one is heard at
      `minHeard`, keeping the best: real word timings in the manifest, the heard share and takes in
      the lock. `quality.transcriber: "none"` (`generate.transcriber` since as-6u9.3) records one
      unchecked take, as before.
   2. **Weak lines and re-timing**: weak lines retaken from their row, or from Generate when asked,
      accepted as they are (Accept, until recorded again), or checked again by Whisper without new
      audio (Check again); clips never checked (adopted from narrate.py, or recorded unchecked)
      measured without new audio (narrate.py `--retime`): the clip decoded to WAV, its length from
      that and what Whisper hears in that WAV (not the MP3, which Whisper hears slightly
      differently), so the timings match narrate.py's exactly; a poorly heard clip shows as weak.
      (Since then, names Whisper spells one letter off count as heard, see §8.2, so such lines
      differ.)
6. **Editing**, in small pull requests:
   1. **Style and cues** (built): a character's style on its audition page, saved in the cast; a
      line's own cue in the lines table, saved in the part's cues file (its order kept, written
      with two-space indent, a cleared cue removed; a number-like key refused, as JavaScript would
      move it). Affected lines show as stale. Orphaned cues (their line's key changed with its
      wording) are shown and re-keyed on the part's overview (6.4.2).
   2. **Pronunciations** (built): the table edited on All characters as a whole (add, change,
      reorder, remove) and saved at once, refused if the file changed since editing began.
      Nothing is trimmed (spaces anchor an entry: `"Al "`), an empty said form leaves the words
      out (as narrate.py does); each written form once, no `__proto__`, and no number-like key
      among others. The table is shown in the order the studio applies it.
      Under it, **Words that sound the same** (built): the project's own sound-alike groups,
      one a row, words separated by commas, saved as a whole in the project file's
      `narration.quality.soundAlike` (`narration.generate.soundAlike` since as-6u9.3), refused if
      the file's groups changed since editing began.
   3. **Changes panel** (built): `git status` for the project's own files only (the project file,
      the cast, each part's dialog, cues, lock, manifest and clips), grouped by part with clips
      counted, merge conflicts marked; read again every few seconds, and counted in the sidebar.
      Only reads, without optional locks (`GIT_OPTIONAL_LOCKS=0`), so it never touches the index
      either, and without `GIT_DIR` and the like from the environment.
   4. **Refresh dialog**, in two pull requests:
      1. **Run it** (built): **Refresh dialog** on a part's overview runs the project's command
         with `sh` in the project root (`{part}` replaced; part ids are safe in a shell), one at a
         time per part, at most 10 minutes; then the dialog is read again and the lines added,
         removed and changed are shown (unknown when the dialog could not be read before), or
         the command's output when it fails. The command runs in its own process group: a
         timeout, the studio exiting (also on Ctrl-C) and the end of the command itself stop
         everything it started. A refresh and a generation of the same part refuse each other,
         on the server.
      2. **Orphaned cues** (built): a part's overview lists the cues whose line left the dialog,
         with their text; each is given to a line (in its place in the cues file; lines without a
         clip offered first, since a reworded line has none yet, and suggested when it is the only
         one; numbered as in the dialog) or removed. Listed in the cues file's order. A line with its own
         cue is not offered over. Scene cues whose scene left the dialog are listed there too, given
         to a scene without a cue of its own, or removed.
7. **RetroQuest switch-over**. RetroQuest's narration moved on meanwhile (Acts II–IV recorded with
   `narrate.py`, clips levelled to −16 LUFS by `level.py`, a cast per act, `extract-act.ts`), so:
   1. **Parity** (built): measured clips are transcribed from their decoded WAV, as
      `narrate.py --retime` does; on Act I the manifest was byte-identical to its (until names
      spelled one letter off counted as heard).
   2. **Loudness** (built): `output.lufs` levels each new clip as `level.py` does, command for
      command (`pyFixed` formats numbers as Python does); clips come out byte-identical. Not in
      the fingerprint: changing the target does not make clips stale.
   3. **The switch** (built, RetroQuest #508): in RetroQuest, one shared `tts/cast.json`
      (`content-studio/narration/cast.json` since as-6u9.3) from the four act casts (the
      grandmother's recast everywhere; the mother's Act III style as cues on her Act III lines),
      `content-studio.json` for all four acts with the new extractor, every act's clips adopted,
      `.content-studio/` ignored, `narrate.py`, `test_narrate.py` and `fish_tts.py` retired
      (`level.py` stays for the music).
8. **Paid models**, in pull requests:
   1. **Prices and credit** (built): a dated price list (`core/prices.ts`, from Fish's pricing
      page; a promotion ends at its moment, so `drama-3` costs $10 until 2026-11-12 17:00 UTC and
      $50 after), plans priced when they are made, and the account's API credit
      (`GET /wallet/self/api-credit`; Fish gives it as a string without a unit, taken to be
      dollars) shown under the project, read again after recording and every five minutes, or
      "unknown" when Fish does not answer.
   2. **Paid models per stage** (built): `draft` and `final` may name a priced model (`audition`
      stays free); a paid job or line asks to "Pay up to $X" with a second click, X being the most
      it can cost, and the server refuses one without that confirmation or beyond the credit
      (`core/spend.ts`).
   3. **Final recording** (built, §8.4): a Draft/Final choice in the Generate panel when the two
      models differ; final clips marked in the line table and left alone by draft plans.
   4. **Choose the models** (built, as-3h4): the Models panel on Setup, which saves each stage's
      model in the project file (§8.4, "Choose the stage models").

   What a paid account could still have (paid auditions, the `s1` retirement, your own voices) —
   everything is built or filed: cloning (as-5gk.5), voice design (as-5gk.6), the rate tier on
   Setup (as-5gk.7) and the spend log (as-5gk.8); the rest is in `docs/paid-account.md`, not planned yet.

9. **Audition rework** (§8.1), in small pull requests:
   1. **Ruled-out voices** (built): a dropped voice is ruled out for the character in
      `content-studio/cache/ruled-out/`, left out of every later search for it; listed on the character
      page, each allowed again or all forgotten.
   2. **Shortlist board** (built): voices to hear, Drop (gone at once, the last undone from a
      notice) and Shortlist, bring in more or a specific voice (also one dropped before), cast any
      shortlisted voice after saying what goes stale; Pause, and Stop audition after saying what
      it means. Takes record by themselves. Rounds are gone; an audition saved in rounds is no
      longer one in progress.
   3. **Character page** (built): the cast voice (Fish's details, its take, recorded by itself,
      and sample, its page on Fish), the lines per part, delivery and casting brief, ruled-out
      voices, and the audition in progress (resume, or stop after saying what it means). The
      audition page shows only the board; the list of matching voices before an audition is gone.
   4. **Hear it in the game** (built): the character's recorded lines on its page, part by part
      in dialog order, with cue and status, played one by one or all in turn.
10. **The lines page as a studio**, in small pull requests:
    1. **Hear it** (built): a line's cue heard before it is saved, as a free take (§8.3).
       **Cues inside a line** (built, as-vhm): cues placed between a line's words, shown as chips,
       placed from the gaps on hover or the `p` key, heard before they are saved.
    2. **Playthrough** (built): the lines shown played in turn, from the first or from a row, the
       row playing marked and kept in view (§8.3).
       2a. **Scene cues** (built, as-2qh): a cue per scene that its narrator lines follow, edited in a
       band above the scene's lines (§ Cues).
    3. **A character's speed** (built): `speed` in the cast, edited on the character page; its
       lines, takes and tries spoken at it, and its lines stale when it changes (§6, §7).
    4. **Setup page** (built): what the machine and the project lack, with the fix for each (§10).
    5. **Shared voices** (built): a character cast with another's voice says so on its page, card
       and the characters page; it may be meant, so it is a note, not a problem.
    6. **Notes on lines** (built): a note to oneself per line, in the tool cache (§6, §8.3).
    7. **Keys** (built): the lines table worked from the keyboard (§8.3).
    8. **Extra takes** (built): more takes of a line in the cache, compared by ear, one made the
       clip (§8.3); the recording split into speaking, checking and committing a take for it.
11. **What was heard**, in two pull requests:
    1. **Kept and compared** (built): what Whisper heard of a take below full kept in the cache
       when it is checked; the lines page shows it beside the text, missed words marked.
    2. **Listen again**: a line checked before that has Whisper hear its clip again, from the
       comparison, keeping what it heard.
12. **Music** (§8.5), in small pull requests:
    1. **Spike** (done: §13, decision 5): ACE-Step 1.5
       on the M5 Pro, run from Python through uv. Its models, sizes and licence of the weights;
       time and memory for a 90-second take with the larger and smaller model, also with Whisper
       loaded; quality of instrumental loops and stingers in RetroQuest's style; whether tempo
       and key in the brief come through; whether a take runs on to its end or closes as a song
       does (which the loop's crossfade needs to know); whether the same seed makes the same
       take; whether the crossfaded seam is heard; and how a loop plays without a click in the
       game's browsers (MP3 in `<audio>`, another codec, or Web Audio).
    2. **Track lists** (built): the project file's `music` section, the game's loop and stinger lists and
       the studio's briefs (schemas, problems with file and path), and the Music pages, a page per
       act and one for the stingers, listing the tracks, read only; Refresh from the game on an
       act's page, and on the Stingers page running `refreshShared` (`refresh.shared` since
       as-6u9.2; CLAUDE.md's consumer rules
       updated in that step to name both buttons and the new command); the sample project in
       `test/fixtures/sample` gains loop and stinger lists.
    3. **Briefs** (built): a track's page (a track opens from its row), its brief, length, tempo
       and key changed and saved in the studio's briefs as each field is left, marked "changed
       here", and the game's taken back; `PATCH /api/music/tracks/:id`, one field at a time.
    4. **Takes** (built): the ACE-Step worker behind `MusicGenerator` (and in the setup checklist), a take
       generated, shaped and cached per click on a track's page, and played, loops around their
       seam too.
    5. **Board** (built): a track's takes as cards, Make N more takes (N chosen, 1 to 6, in the background), Drop;
       takes from an earlier brief marked; Stop and Try again; the board saved in
       `content-studio/cache/music/<track>.json`; "making 2 takes · about 4 min" on the lists.
    6. **Choose** (built): the chosen take levelled, encoded and written with the manifest and lock; each
       track's status on the Music pages; the music files in the Changes panel.
    7. **Orphans** (built): the music of a track the game no longer lists, shown on its list's page and
       removed after confirmation; the briefs and boards of unlisted tracks never chosen dropped.
    8. **Hear a track from the list** (built): `file` in the track lists, the Plays column and
       `GET /api/music/tracks/:id/current`.
    9. **RetroQuest** (in the game's repository, not the studio's): the game's extractor writes
       each act's loops and the stingers with their first briefs, and the game reads the music
       manifest and plays a track per room or region, and the stingers, looping through Web Audio;
       checked in Chrome, Safari and Firefox. If a browser pads an MP3, the manifest gains loop
       points.
    10. **Music models** (built): `music.model` in the project file, saved from a Music row in Setup's
        Models panel; four models (Balanced, Quick, Quickest, Careful); a menu "Model for new
        takes" on a track's Takes panel; every take names its model; the model is no longer a cause of
        "changed since chosen".
    11. **Stable Audio Open** (built): Short and Shortest in every music menu, grouped under
        headings, greyed on a track too long for them; their own worker and optional Setup row.
    12. **In the game** (built): what a track plays shown above its other takes, and a chosen take
        that can be un-chosen (§8.5).
    13. **Move a take** (built, as-824): Move… on a take card moves it to another loop in any act, or
        another stinger, counted as made for the track it joins (§8.5).
        13a. **Trim silence on a stinger take** (built, as-k7i.1): one press cuts the near-silent start and end,
        kept with the take and written into the game's file when the take is chosen (§8.5).
    14. **Make takes for every track with no chosen take** (built, as-23x.1): one press on an act's or the
        Stingers page makes four takes for every track with no chosen take, on the project's model (§8.5).
    15. **The same press on the Stingers page** (built, as-23x.2): the page says "stinger", and Refresh from
        the game and the press are greyed while the other runs (§8.5).
13. **Languages** (epic as-170), in small pull requests:
    1. **Show a part's lines in each declared language** (built): `narration.languages` (top-level `languages` since as-6u9.2),
       `{language}` in the paths, a language switch on the lines page with each language's
       progress, untranslated lines, read only (no recording yet).
    2. **Cast each character per language** (built): a voice, speed and phrase per language in the
       cast, an audition and ruled-out voices per language, a language switch on a character's
       page and its audition, and a chip on a card for each language without a voice.
    3. **Record a part's lines per language** (built): recording, Whisper's check (told the
       language in a project with several), measuring, accepting, extra takes, orphans and jobs
       (one per part and language) work in every declared language, into its own clips, manifest and
       lock; cues follow the source language's; pronunciations and words that sound the same are
       per language; the overview, All characters and the cards follow the language switch.
14. **ElevenLabs** (§8.6), in small pull requests, each verified by hand by the user (no key in CI):
    1. **The plan**: §8.6, this step and decision 7.
    2. **Key and account** (built): `ELEVENLABS_API_KEY`, the client with `subscription` only,
       Setup's two optional rows. The user checks what the account draws on (allowance or dollars,
       and whether music and speech share it) and its concurrency, and the plan follows.
    3. **Music, ready for a second provider** (built): an optional seed (board, view, move, lock),
       the music router as a table from family to generator. No behaviour changes. Each provider's
       prices stay in tables of their own, so nothing needed splitting.
    4. **Eleven Music takes** (built): the family and model in every music menu, takes made, decoded
       and shaped, outside the GPU queue (the take queue by family), ready by key, Setup's Music
       row, an opt-in live take.
    5. **What music costs** (built): the price on the menus, the make button, and Stop's
       warning. Music rows in the spending log came with its version 2, in 14.7d.
    6. **A voice says whose it is** (built): `eleven:` voice ids (`core/voices.ts`: `providerOf`,
       `providerId`, `elevenVoice`, `FISH_VOICE_ID` and `VOICE_ID`), and no Fish page linked for an
       ElevenLabs voice. The routes that would reach Fish or the cast (a take, adding, moving and
       casting a voice) still take Fish's ids only, until 14.7 can speak with an ElevenLabs one;
       allowing a ruled-out voice again takes either. No behaviour changes. The speaking seam moves
       to 14.7, which first needs it.
    7. **Record lines with an ElevenLabs voice**, in four pull requests:
       1. **Speak a line with ElevenLabs** (built): ElevenLabs' speech models and their credits a
          character (`core/elevenSpeech.ts`), a voice's stage model from its provider (Eleven v3
          for every stage until 14.9, so its lines have no final step), its settings in the
          fingerprint, the budget charged from the text in the model's unit, the client's `tts`
          (24 kHz WAV), and `speakerFor`: a line and an extra take spoken by the voice's provider,
          refused without its key or at a speed ElevenLabs does not take. Nothing makes an
          ElevenLabs voice yet, and the server gives recording no ElevenLabs client, so nothing
          can be spent.
       2. **Cast an ElevenLabs voice** (built): Add by id with the provider chosen beside the
          field (_Fish Audio_, _ElevenLabs_; an ElevenLabs id is a bare id), the voice looked up
          with the client's `voice` (its preview as its sample, shown as "ElevenLabs preview"),
          moved, shortlisted and cast as any other; the character's page shows it as ElevenLabs
          gives it. It records no take by itself and offers no Record take (on the board or its
          page), and a take or a cue try with it is refused, saying so; Fish is asked nothing
          about it. Its lines are not recorded yet: without the server's ElevenLabs client for
          recording, a line is refused as without a key.
       3. **Record an ElevenLabs voice's lines** (built): the server's ElevenLabs client for
          recording and extra takes, its own limiter (two at once), a part's plan split by
          provider, credits in the confirm and admission against what the plan has left, and the
          speed refusal on the character's page (under its speed).
       4. **The spending log's version 2** (built): a recording's ElevenLabs credits, a row for
          each paid music take, and the Spending page's totals in dollars and credits apart.
    8. **Cues by model** (built): cues left out of the text, the fingerprint and the plan's count
       for models that would speak them, so that choosing such a model (next) never reads a cue
       aloud; the page still shows them. Nothing changes on screen yet: no such model can be
       chosen.
    9. **Choose ElevenLabs' models and settings**, in two pull requests:
       1. **ElevenLabs' models** (built): `narration.elevenlabs.models` (`audition`, `draft`,
          `final`; Eleven v3 unless named; only ElevenLabs' speech models, so `readsCues` knows
          each) in the project file, each ElevenLabs voice's stage model taken from it; the Models
          panel's ElevenLabs draft and final rows (shown in a project with an ElevenLabs voice: a
          menu of the models with their credits a character and whether they speak cues, saved at
          once or after a question naming the lines going out of date and the credits to record
          them again, as Fish's rows do); a final step for a part when one of its voices'
          own stages differ (`finalStepFor`), the part's generate panel naming both providers'
          models; the credits
          budget on the stage's ElevenLabs model; the cue editor saying a line's model speaks
          cues, so none are sent. A line recorded with cues and now on such a model is stale for
          its model and its cue. The audition row came with 14.10b-1. The
          consumer rules in CLAUDE.md name the new saved keys.
       2. **ElevenLabs' voice settings** (built): `narration.elevenlabs.tts` (stability,
          similarity, style) in the project file, spoken with and fingerprinted in place of the
          fixed defaults, and saved from the Models panel's ElevenLabs voice row, asking first
          when recorded lines go out of date. The consumer rules in CLAUDE.md name the key.
    10. **Page takes, tries and auditions with an ElevenLabs voice**, in two steps:
        1. **The page take and cue tries** (built): on ElevenLabs' audition model, not
           confirmed, their credits shown and kept in the spending record's `tries` (totals and
           a tile of their own on the Spending page); a try on a model that reads no cues says
           so rather than sending the line's cues or dropping them unseen.
        2. **Auditions on ElevenLabs**, a credits sitting beside Fish's dollars (chosen over a
           Record button per card, so a board of ElevenLabs voices fills with takes by itself), in
           three pull requests:
           1. **The ElevenLabs audition row** (built) on the Models panel, saved at once as
              Fish's audition row is.
           2. **The credits sitting** (built) on the server: started and added to in credits,
              held back from the plan as a recording's credits are, board takes with ElevenLabs
              voices charged to it.
           3. **The board's screens** for it (built): credits asked for on the board when an
              ElevenLabs voice there waits for them (chosen over asking at every Start), the
              credits meter, Add, and "Take waits for credits" / "for more credits".
    11. **Find a voice in ElevenLabs' library**, in two pull requests:
        1. **Search and add** (built): the client's `sharedVoices` and `addSharedVoice`, the
           provider switch beside Bring in more, library cards and previews, a library voice added
           on its first board take (once charged, its credits given back if ElevenLabs will not)
           or when cast, and the voices added remembered.
        2. **Voice slots** (built): shown on the board, takes that would add a voice waiting at
           the plan's limit, and the voices the studio added that nothing uses offered for
           removal (the client's `deleteVoice`).
    12. **Design a voice with ElevenLabs** (built): the design box's switch, previews saying the
        phrase and the character's lines kept as designs, confirmed and held in credits, logged
        as `design` tries, and saved as a voice when cast (the client's `designVoices` and
        `saveDesignedVoice`).
15. **Images** (epic as-yag), in small pull requests; the tool is renamed Content Studio last:
    1. **Spike** (done: §13, decision 8): FLUX.2 klein 4B and Z-Image-Turbo through mflux, their
       time, memory and licence on the M5 Pro, and whether one style text and the game's colours
       keep about ten RetroQuest rooms one set.
    2. **The game's image list and style** (as-yag.3, done: §8.7), read-only, with the studio's own
       prompt overrides.
    3. **An image take** (as-yag.2, done) with either model, on the GPU queue with music and Whisper.
    4. **Takes and choosing** (as-yag.4, done: §8.7): an image's takes compared with the chosen one.
    5. **The game's look** (as-yag.5, done: §8.7): each take brought to the image's size, and to a palette or colour depth when the style file asks, shown beside what the model made.
    6. **Two models** (as-yag.7, done: §8.7): Setup says which are installed and chooses the main one;
       takes can be made with the other.
    7. **Shared images** (as-94e, done: §8.7): an image the game lists in several acts is one image shown in each, with one act-style pick; lists that disagree are reported.
    8. **The rename** to Content Studio (as-yag.6), with §1 and the opening of this document, which still speak of a game's audio.
    9. **Make takes for the whole act** (as-23x.3, done: §8.7): one press on an act's Images page makes four
       takes for every image with no chosen take, after a question in the panel.
    10. **Patches** (as-b9x, an experiment, done: §8.7): an area of a chosen take edited in context and shown over it; nothing reaches the game.
    11. **The game's patches listed** (as-bo8.1, done: §8.7): the image list carries patches, an image's
        page lists them and they can be reworded.
    12. **The game's patches made and chosen** (as-bo8.2, done: §8.7): takes of a declared patch are made
        on the image's chosen take, compared and chosen.
    13. **A chosen patch in the game** (as-bo8.3, done: §8.7): its transparent picture beside the image's and an
        entry under the image in the manifest; the game's own use of it is in the game's repository.
    14. **The game's named areas listed** (as-qg4.1, done: §8.7): the image list carries named areas, an image's
        page and the act's list show which are left to place; placing them is the next step of as-qg4.
    15. **Named areas marked** (as-qg4.2, done: §8.7): a box per area on the chosen take, kept in the image's edits.
    16. **Placed areas reach the game** (as-qg4.3, done: §8.7): each placed box goes into the image's images-manifest entry as fractions, in the same save, and on Refresh from the game.
    17. **A patch tied to a named area** (as-qg4.5, done: §8.7): a patch starts marked from its named area, so a spot is defined once.
    18. **A chosen patch in the game** (as-bo8.3, done: §8.7): its transparent picture beside the image's and an
        entry under the image in the manifest; the game's own use of it is in the game's repository.
    19. **Patches set aside** (as-bo8.4, done: §8.7): choosing, un-choosing or dropping a take whose chosen
        patches would stop showing asks first; patches to make again are marked on the image's page and the act's row.
    20. **Patches that overlap** (as-bo8.5, done: §8.7): two chosen patches whose areas share a dot are warned about
        on the image's page, in the open patch and on the act's row.
    21. **Remake patches on this take** (as-qoj, done: §8.7): one press makes 1 to 4 takes of every patch to make
        again that has none on the take in the game; nothing is chosen.
    22. **Named areas set aside** (as-qg4.4, done: §8.7): each take keeps its own boxes; choosing, un-choosing or dropping a take whose
        placed areas would stop being used asks first, with the patches; areas to place again are marked in the Named areas panel.
    23. **Patch models** (as-ilw, done: §8.7): a menu of two edit models on each patch and on Remake, Qwen Image Edit and FLUX.2 klein;
        each take names its model.
16. **Sound effects** (epic as-5wc), in small pull requests:
    1. **Spike** (as-5wc.1, done: §13, decision 9): Stable Audio 3 Small SFX against Stable Audio Open 1.0,
       their time, memory, licence and how a take ends, on the M5 Pro.
    2. **The model** (as-5wc.3, done: §8.8): a worker making one effect with Small SFX on the CPU, its
       trailing silence trimmed, and Setup's Sound-effect models row.
    3. **The game's effects list and the studio's descriptions** (as-5wc.2, done: §8.9), read-only,
       with the studio's own description overrides and the Sound effects workspace.
    4. **Takes** (as-5wc.4, done: §8.10): make, hear, compare, choose, un-choose, drop and accept; the
       lock, manifest and clips; statuses in the list.
    5. **Looping effects** (as-5wc.6, done: §8.10): the list marks which effects loop; their takes are
       made seamless at the game's length, play round, have Hear the seam, and a change of how an
       effect plays is a change since chosen.
    6. **The second model** (as-5wc.5, done: §8.8): Stable Audio Open 1.0 on the GPU queue, Setup checking both
       models and choosing the main one (`effects.model`), and a model menu on an effect's page.
    7. **Trim silence on a one-shot effect take** (as-dgh.1, done: §8.10): one press cuts the near-silent start and
       end, kept with the take and written into the game's file when the take is chosen.
    8. **Fades on a one-shot take** (as-dgh.2, done: §8.10, `docs/ui/as-dgh.2-effect-fades.html`): the stingers'
       Fades… editor on each take made to play once, in steps of 0.01 s, written into the game's clip.

17. **Scenes** (epic as-p86), in small pull requests:
    1. **The mockup round and the contract** (as-p86.1, done: §8.11, `docs/ui/as-p86.1-scenes.html`): the
       Scenes page, its editor and play bar, and the declarations and mix files.
    2. **The game reads scenes from JSON** (RetroQuest rq-xazj): `ROOM_AMBIENCE` and
       `effectVolumes.json` become the declarations (written by the game's refresh) and the mix (read by
       the game); the game sounds as before. The studio's page waits for it.
    3. **The Scenes page** (as-p86.2, done: §8.11): the sidebar entry, the act's scene list and the open
       scene read only, with ▶ on the music and each effect, the not-yet-listed, Refresh and failed
       states; the `scenes` section of the project file; the sample project has scenes.
    4. **Editing a scene** (as-p86.3, done: §8.11): the music, effects, add menu, unsaved changes, Save,
       Discard and the leave dialog, saved to the mix only (`PUT /api/scenes/:part/:id`, 409 with the
       saved entry when it changed meanwhile).
    5. **Playing a scene** (as-p86.4, done: §8.11): the play bar with State and Triggers, the
       scheduler of §8.11, the Now column, Mute and Solo, edits heard at once.
    6. **Triggers in the game** (RetroQuest rq-xfkn): the game fires the declared triggers and plays the
       effects the mix binds to them. The studio's play bar fires them from as-p86.4 on; a scene with no
       triggers declared shows none.
    7. **Loudness of the scenes** (as-gdf.1, done: §8.11): a kept loudness per scene and state against
       the target in the project file, warnings in the Loudness panel and the scene list. Suggesting
       and applying a change (as-gdf.2, done) is in the same section.

18. **One format for the project's files** (epic as-6u9), each step converting the studio, the sample
    project and RetroQuest together, in this order:
    1. **The reference** (as-6u9.1, built): `docs/project-files.md`, the format of version 2 for
       the people who write the files.
    2. **The project file** (as-6u9.2, built): `version` and `$schema` (the JSON Schema made by
       `bun run schema`), the top-level parts, languages and refresh (`part`, and one `shared`
       command for the stingers and the effects), the studio folder `content-studio/` with its
       `.gitignore` and its cache (what `.content-studio/` held), and the personal settings
       (`fishTier`, `takeFade`) moved into `content-studio/cache/settings.json`.
    3. **Narration** (as-6u9.3, built): the `narration` section (`from.part`, `models.fish` and
       `models.elevenlabs`, `generate` with the checks and `soundAlike` by language, `audition`
       with `phrase` by language and `searchLanguage`, `clips`, `manifest`), dialog lines by `id`,
       and the cast, the cues (`{ cues, scenes }`) and the lock (`hashes`) at fixed places in
       `content-studio/narration/`. The fingerprint is unchanged, so a converted game's clips stay
       as they stood.
    4. **Music and stingers** (as-6u9.4, built): the `music` section (`from.part`, `from.shared`,
       `model`, `clips`, `manifest`), tracks' words as `text`, the edits (`{ text, gameWas,
seconds, bpm, key }`, the game's changed brief shown with Use the game's and Keep mine) and
       the lock (`inputs.text`, `list: "shared"`) at fixed places in `content-studio/music/`. The
       take hashes and the cache are unchanged, so a converted game's tracks stay as they stood.
    5. **Images** (as-6u9.5, built): the `images` section (`from.part`, `model`, `clips`,
       `manifest`), images' words as `text`, the edits (the studio's own style, `parts` in place of
       `acts`, edited directly with no notice for a changed style; rewordings `{ text, gameWas }`
       and `partStyle`) and the lock (flat by id, `inputs` in the clear) at fixed places in
       `content-studio/images/`. The staleness keys and the cache are unchanged, so a converted
       game's images stay as they stood.
    6. **Sound effects** (as-6u9.6, built): the `effects` section (`from.shared`, `model`, `clips`,
       `manifest`), effects' words as `text` with an optional `title` (the name shown), the
       rewordings (`{ text, gameWas }`) moved from the gitignored cache into the committed edits,
       and the lock (`inputs.text`) at fixed places in `content-studio/effects/`. The take hashes,
       the boards and the takes in the cache are unchanged, so a converted game's effects stay as
       they stood.
    7. **Scenes** (as-6u9.7, built): the `scenes` section (`from.part`,
       `output: { lufs, tolerance }`, `mix`), scenes' names as `title`, and the kept loudness moved
       from the gitignored cache into each part's committed scenes lock,
       `content-studio/scenes/<part>.lock.json`.
       The mix's format and the measures' fields are unchanged, so a converted game's figures stay
       as they stood.
    8. **RetroQuest end to end** (as-6u9.8, built): the studio run on RetroQuest through every
       section's pages, with no problems listed and a narration clip, a track, a stinger, an effect
       and a scene mix played, and the game playing its narration, music, stingers, images, effects
       and scene mixes in Act I from the converted files. No file of the old format is left in
       either repository; a few delivery-plan steps above name the old places they were built with,
       with the new name beside them.

---

## 13. Decisions

1. **Characters are shared by name across parts.** The same name in two parts is one character
   with one voice. Different voices need different names (`narrator-act1`, `narrator-act2`).
   Hence one project-wide `cast.json`.
2. **UI framework: React.**
3. **Models: free only, for now.** The project file already has `audition`, `draft` and `final`
   model stages; paid models are allowed for every stage (§8.4).
4. **Music is generated locally with ACE-Step 1.5.** No hosted music API has a lasting free tier
   with rights to use the result (ElevenLabs Music's free plan is non-commercial; others give
   signup credits only). Of the open models, MusicGen's weights are non-commercial (CC-BY-NC) and
   Stable Audio Open is limited to 47 seconds and stronger at effects than at melody; ACE-Step's
   code and weights are MIT-licensed, it makes full instrumental tracks, and it runs on Apple
   Silicon. Tracks are chosen from takes, since every generation differs. Stable Audio Open was added later
   (as-ui4) as an alternative for stingers and short loops, with the same weights-outside-the-studio rule;
   ACE-Step stays the one that makes the game's act loops. ElevenLabs Music was added later beside
   them, paid (decision 7).
5. **ACE-Step's XL turbo model with the 4B language model** (the spike, 12.1, on a MacBook M5 Pro
   with 48 GB, MLX). A 96-second take takes 2 to 4 minutes with it, about a minute more for the
   first after a start, while the models load; the length matters little (with the 1.7B language
   model a 10-second take took 33 to 55 seconds, a 96-second one 52 to 67). The 1.7B language model
   takes about 1¼ minutes a take, and the XL sft model at 50 steps (where the turbo model allows no
   more than 8) about 6½, up to three times turbo's wait. In a blind test of one brief, two takes
   from each (indicative only), the two judged worst were the 1.7B's, and sft was not clearly better
   than turbo. The quality is fair rather than good, so a board of several takes is how a good one
   is found. The chosen models take about 28 GB on disk, downloaded once, outside the studio for
   now. Not measured: whether the music follows the tempo and key asked for (ACE-Step takes them as
   given), whether a crossfaded seam is heard (judged on the board), and stingers beyond a fanfare
   and a game-over phrase.
6. **The game lists the music it needs.** As with characters and lines, the game says which loops
   each act has and which stingers the whole game has, with a first brief for each; the studio only
   makes them, and keeps its own changes to a brief beside the game's. Hence no adding or removing
   of tracks in the studio, and a track the game drops becomes an orphan.
7. **ElevenLabs beside Fish and the local music models, per voice and per model.** Asked for by the
   user (October 2026) for its quality, in narration and in music. A character's voice belongs to
   one provider, so a game can mix them and nothing recorded with Fish changes; each provider has
   its own stage models. ElevenLabs' plans include characters and bill dollars beyond them (checked
   in 14.2), so its recordings are confirmed in characters against what the plan has left, with the
   dollars of any overage; music takes show their price but are not confirmed, as each costs cents.
   This reverses decision 4's reason for staying local, not its outcome: the local models stay the
   free default. Music through the API needs a paid plan, and commercial use Starter or above,
   within ElevenLabs' indie-game limits; Setup says so.
8. **Images are made locally with FLUX.2 klein 4B and Z-Image-Turbo, through mflux** (the spike,
   15.1, on a MacBook M5 Pro with 48 GB, MLX, mflux 0.20.0). Ten Act I rooms of RetroQuest, each
   made at 1024×576 with seed 42 from a style text and the room's description, the model loaded once and MLX's cache cleared after each take (klein's times are with the reworded style text below; schnell's without clearing the cache):

   | Model                     | Steps | Time per take | Memory (MLX peak) | On disk | Licence           |
   | ------------------------- | ----- | ------------- | ----------------- | ------- | ----------------- |
   | FLUX.2 klein 4B           | 4     | 6–9 s         | 20 GB             | 15 GB   | Apache-2.0        |
   | Z-Image-Turbo             | 9     | 33–66 s       | 37 GB             | 31 GB   | Apache-2.0        |
   | FLUX.1 schnell (not used) | 4     | 13–19 s       | 41 GB             | 31 GB   | Apache-2.0, gated |

   Clearing the cache matters for Z-Image-Turbo, which took about 80 s a take without it, and makes no clear difference to klein (5–10 s without it, same text). Even so, Z-Image-Turbo's first step takes 14–25 s on every take after the first, against about 7 s on the first, not explained.
   Klein follows each description most closely (the Dream's man lifting the child and the faceless
   figure, the field's withered crops) and is by far the fastest; Z-Image-Turbo paints the cleanest
   gouache but leaves out parts of a description; schnell's rooms do not hold together as a set
   (half flat poster on a cream ground, half painted). Both klein and Z-Image-Turbo are kept, at
   the navigator's choice: klein for speed and closeness to the brief, Z-Image-Turbo for its
   painting. Which one is the project's main model, and making takes with the other, is planned in
   as-yag.7. Klein 9B was left out: its weights are non-commercial. As with music, the weights are
   downloaded once, outside the studio. No free image API is kept as a fallback, since a local take
   costs nothing.

   **Memory beside the other workers.** With ACE-Step and Whisper both loaded, 42 of the 48 GB were in use (§8.5), so an image worker cannot stay loaded beside them, nor the two image models beside each
   other (57 GB). So an image take (`services/images.ts`, as-yag.2) is one process of the model's own mflux command (`mflux-generate-flux2` for klein, `mflux-generate-z-image-turbo`; plain `mflux-generate` refuses both), started for the take and gone when it ends, which also gives every take a clean MLX cache (the cache clearing above). It waits its turn on the GPU queue with music and Whisper (`makeImageTake`), and when its turn comes `freeGpu` closes the idle Whisper and music workers (registered with `onGpuFree`), as the music router closes the other music family; they start again with their next request, so the cost of an image take is the reload of whatever is used next. The two image models never share memory, being separate processes one after the other.

   **One look holds across a set through the shared style text**, not through the palette. Klein's
   and Z-Image-Turbo's ten rooms each read as one set from the same style text. The text is the
   only place to say what not to draw: mflux runs none of these models with a negative prompt
   (Z-Image-Turbo and schnell ignore one, FLUX.2 refuses it), so what the studio does with the
   style file's `avoid` list is as-yag.3's to settle; written into the text as "no …", it worked.
   The text also draws what it names: "gentle lantern light" put a lantern in most rooms, and
   "like an old picture book" made klein paint an open book with a fold down the middle, with
   lettering on signs. Reworded to "soft warm light", "one single full-bleed image with no fold,
   frame or border" and "no text or lettering anywhere", the folds, lettering and stray lanterns
   went and the set still held. The soft, worn-page edges remain; cropping to the game's size can
   take them off. The sheets are in `docs/spike-images/`: `klein-4b-game-style.jpg`,
   `klein-4b-adjusted-style.jpg` (RetroQuest's rq-mh5r rewords its text so), `z-image-turbo.jpg`
   and `flux1-schnell.jpg`.

   **Colours: RetroQuest keeps full colour.** as-yag.5's looks on three of klein's rooms
   (`colours.jpg`, and `colours-detail.png` at full size): 16-bit looks the same as full colour;
   the shared 8-bit set (8×8×4) with patterned dithering shows its pattern and a yellow-green cast,
   a clear retro look; the game's six listed colours turn walls red and green, patterned or flat.
   The navigator chose full colour for RetroQuest, so rq-qtbi removes the palette from its style
   file; until then, as-yag.5 would bring its images to the six colours. Not measured: quantised
   weights (`--quantize 8`), which would lower the memory, and how far a set holds across acts
   rather than within one.

9. **Sound effects are made locally with Stable Audio 3 Small SFX, on the CPU; Stable Audio Open
   1.0 is kept as a second effects model** (the spike, 16.1, as-5wc.1, on a MacBook M5 Pro with
   48 GB). Ten RetroQuest-style effects (footsteps, a door creak, a pickup chime, a UI click, forest
   ambience, a sword draw, a chest opening, a fireplace, coins, distant thunder; 1 to 10 seconds),
   each from the same text with both models:

   | Model                           | Runs on | Time per take | Memory                 | On disk                               | Licence                                    |
   | ------------------------------- | ------- | ------------- | ---------------------- | ------------------------------------- | ------------------------------------------ |
   | Stable Audio 3 Small SFX        | CPU     | 1.7–2.5 s     | 5.3 GB (process, peak) | 6.5 GB                                | Stability AI Community, plus Gemma's terms |
   | the same, on the GPU (MPS)      | GPU     | 0.3–0.9 s     | not measured           | the same                              | the same                                   |
   | Stable Audio Open 1.0 (`Short`) | GPU     | 95–112 s      | 20 GB (MPS, allocated) | about 5 GB used (15 GB as downloaded) | Stability AI Community                     |

   The two memory figures are measured differently (the process's peak resident memory; the GPU
   memory torch allocated) and are only roughly comparable. The navigator judged both models usable
   by ear, with no clear preference. Small SFX is the default for its speed: its time grows only a
   little with the length (a 1 s click in 1.7 s, a 10 s ambience in 2.5 s), and on the CPU it
   needs no turn on the GPU queue, so an effect can be made while the GPU is busy, though slower:
   beside an Open 1.0 take on the GPU, a CPU take took 7–12 s. Small SFX loads in about 4 s with
   its weights cached. Open 1.0 always makes its full 47 seconds at 100 steps whatever is asked,
   hence its time; it is kept at the navigator's choice, as a second take when Small SFX misses,
   and needs nothing new: it is already downloaded and runs in `worker/stable_audio.py` on the GPU
   queue. The music worker makes its takes the same way, so Short's music takes are as slow, about
   100 s, as §8.5 now says.

   **How it runs.** Small SFX loads through Stability's `stable-audio-3` library (git
   `790793b`, 0.1.0; not on PyPI), `StableAudioModel.from_pretrained("small-sfx", device="cpu")`,
   `generate(prompt, duration, seed)` at its defaults (8 steps, guidance 1), which returns
   44.1 kHz stereo. That library pins torch 2.7.1 and numpy 2, while the Stable Audio Open worker
   pins numpy below 2 (§8.5), so effects get a worker of their own, not a third model family in
   `worker/stable_audio.py`. Loading Small SFX with that worker's stable-audio-tools 0.0.20 (or
   that library's unreleased main, which Stability says can load it) was not tried. The weights
   come from the gated `stabilityai/stable-audio-3-small-sfx`, accepted once by the user on Hugging
   Face, and `from_pretrained` downloads them into the Hugging Face cache with the user's token.
   That departs from §8.5's rule for Stable Audio Open (its own folder in `~/.cache/stable-audio`,
   no token read); the step that builds the effects worker chooses between the two (as-5wc.3 chose the Hugging Face cache, §8.8). Stability also
   publishes the weights ungated for MLX (`stable-audio-3-optimized`), not tried.

   **The takes' edges.** Every Small SFX take ends in silence (the last 10 ms below −59 dB), and
   the one-shots stop well before the length asked: a 3 s door creak by about 2.2 s, a 2 s sword
   draw by 0.95 s, a 1 s click by 0.4 s. The long sounds (ambience, fire) fill nearly all their
   length and then fade out themselves in their last tenth of a second to under a second, so no
   take loops as it is. The one-shots start within 0.13 s, most of them quietly (−41 to −63 dB in
   the first 10 ms); the chime and one of the sword draws start at once (−17 to −30 dB), and the
   ambience starts at full level. So a later step trims a take's trailing silence, and an effect
   that loops (ambience) would need a crossfaded seam as the music loops do (§8.5) or a step of
   its own. Two of Open 1.0's ten takes were cut off at the end (footsteps and ambience, −15 to
   −28 dB in the last 10 ms).

   Ruled out before the spike: ElevenLabs Sound Effects (the Free plan's output is non-commercial;
   a paid plan may come later, as for music, decision 7), MMAudio, Meta's AudioGen and Sony's
   Woosh (non-commercial weights) and TangoFlux (research use only). Not measured: memory beside
   ACE-Step and Whisper (42 of the 48 GB in use with both loaded, §8.5; Small SFX adds about 5),
   Small SFX's memory on the GPU, its time beside a running Whisper check, offline loading
   (`HF_HUB_OFFLINE`) once downloaded, and effects RetroQuest actually lists.

**Focus after Stop all (as-dxo; drawn in `docs/ui/as-dxo-stop-all-focus.html`).** On the four Make-all panels
(Music, Stingers, Images, Sound effects) Stop all is greyed with `aria-disabled` while the stop is under
way, so it keeps focus and its words. `useStopFocus` (`src/ui/components/useStopFocus.ts`) remembers whether
focus was on Stop all when the running line ends, whether by the stop or by the takes finishing, and then
moves it to the summary's Close, or to the panel's button (the panel itself without one) when there is no
summary; focus anywhere else is left alone. A refused or unreachable stop keeps the running line and Stop
all and shows "The takes could not be stopped. They are still being made; try again." under the panel until
the next press, the end of the takes, or a reload. Nothing is persisted.
