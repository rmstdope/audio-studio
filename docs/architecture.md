# Audio Studio — Architecture

Audio Studio is a local, graphical tool for producing a game's audio. It is started from inside a
checked-out game repository (the _consumer_), reads that repository's project file, and writes
voice files and their metadata **in place**. Committing and pushing is left to the user.

The first workspace is **Narration**: casting a voice for every character by audition, and
recording every line of dialog with the cast voice, regenerating only what is missing or out of
date. The second is **Music** (§8.5, planned): looping background tracks and short stingers, each
chosen by audition from takes generated locally with ACE-Step. Sound effects are a later workspace
on the same foundation.

The first consumer is RetroQuest, whose current Python tooling (`tts/fish_tts.py`,
`tts/narrate.py`) this tool replaces.

---

## 1. Goals and non-goals

**Goals**

- One command, run from the consumer repo root, opens the studio: `audio-studio`.
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
- Sound effects (the architecture leaves room for them).
- Deciding where a track plays. The game decides which track a room or region plays, and when a
  stinger sounds; the studio makes the tracks it lists.

---

## 2. How it runs

```
retroquest/                      ← user runs `audio-studio` here
├── audio-studio.json            ← project file (committed)
├── .env                         ← FISH_AUDIO_API_KEY (gitignored, already exists)
├── .audio-studio/               ← tool state: takes (narration's and music's), auditions, ruled-out voices, what was heard
├── tts/cast.json                ← character resource, shared by all parts (read + written)
├── tts/act1/
│   ├── script.json              ← dialog resource (read)
│   ├── cues.json                ← per-line delivery cues (read + written)
│   ├── narration.lock.json      ← per-clip fingerprints (written, committed)
│   └── music.json               ← the act's loops, from the game (read; built, §8.5)
├── tts/stingers.json            ← the game's stingers (read; built)
├── music/
│   ├── briefs.json              ← the studio's changes to the game's briefs (read + written)
│   └── music.lock.json          ← the chosen take of each track (written, committed)
└── web/public/audio/
    ├── narration/act1/
    │   ├── *.mp3                ← clips (written)
    │   └── manifest.json        ← key → file, speaker, duration, word timings (written)
    └── music/generated/
        ├── *.mp3                ← tracks (written; planned)
        └── manifest.json        ← track → file, duration (written; planned)
```

1. `audio-studio` walks up from the current directory to find `audio-studio.json`. That directory
   becomes the **project root**; every path in the project file is relative to it.
2. It validates the project file and every resource it points to, then starts a Bun HTTP server on
   `127.0.0.1` (random free port, or `--port`) and opens the browser on it.
3. The UI talks to the server over a small JSON API, and gets live job progress over a WebSocket.
4. The studio writes only to paths the project file names, and every path goes through
   `resolveInRoot`, which refuses anything outside the project root. Clips are served only when
   they are plain files in the part's clips folder (no folders, no symbolic links). The one
   exception is the game's own commands: **Refresh dialog**, on a part's overview, and **Refresh
   from the game**, on an act's Music page (the same `refreshDialog` command) and on the Stingers
   page (`music.refreshShared`), run in the project root, only when the user clicks one on the
   studio's page; what a command writes is the game's business, and the studio does not check it
   beyond reading the dialog, the loops or the stingers again.
   Besides those paths, the studio writes the project file itself in a few places only: the project's
   own words that sound the same (`narration.quality.soundAlike`), from the characters page (§8.3),
   the models (`narration.models`, `narration.elevenlabs.models` and `music.model`) from Setup's
   Models panel, the retirement
   switch of `s1`, `narration.quality.fishTier`, and `takeFade` from Setup's Playing takes panel.
5. The API answers only requests addressed to `127.0.0.1` or `localhost` on its port (against DNS
   rebinding), and takes changes (POST) only from its own page (the Origin header).

Installed once from this repo with `bun link` (later `bun add -g`), then run in any consumer.

---

## 3. Technology

| Concern                                     | Choice                                                           | Why                                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime, server, bundler, tests             | **Bun** (`Bun.serve` with HTML imports, `bun test`)              | One tool for everything; serves the React app with no separate build step.                                                                              |
| UI                                          | **React 19 + TypeScript**, TanStack Query for server state       | Bun bundles JSX with no extra setup; Query handles caching and refetching.                                                                              |
| Styling                                     | Plain CSS with design tokens (custom properties), one stylesheet | Small, no framework lock-in; dark-first theme.                                                                                                          |
| Waveforms and playback                      | **wavesurfer.js**                                                | Waveform, seek, and region playback for the audition and line inspector.                                                                                |
| Validation                                  | **zod**                                                          | One schema per file type gives validation, types and readable errors.                                                                                   |
| TTS and voice library                       | **Fish Audio REST API** via a thin `fetch` client                | The calls in use are few (search, voice, TTS, credits); no SDK needed.                                                                                  |
| Transcription (word timings, quality check) | **mlx-whisper** in a long-lived Python worker (`uv run`)         | Same model and quality bar as today; the model loads once, not once per clip. Behind an interface, so whisper.cpp can replace it on non-Apple machines. |
| Encoding and joining                        | **ffmpeg** (subprocess)                                          | Already a dependency; MP3 64 kbps mono as today.                                                                                                        |
| Music generation (§8.5)                     | **ACE-Step 1.5** in a long-lived Python worker (`uv run`)        | Free and local; why, in §13 decision 4.                                                                                                                 |

A native window (Electrobun) can wrap the same web UI later; nothing in the design depends on it.

---

## 4. Module layout

```
audio-studio/
├── bin/audio-studio.ts          CLI entry: find project, start server, open browser
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
│   │   ├── spending.ts          the record of paid recordings (.audio-studio/spending.json) and the running ones
│   │   ├── soundAlike.ts        the project's sound-alike groups, saved in the project file
│   │   ├── models.ts            s1 → s2.1-pro, and a stage's model, in the project file's `narration.models`
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
│       ├── player.ts            plays clips one at a time, or a list in turn; takes fade in (from the element's playing event) and out for the project's `takeFade`, the game's file does not
│       └── components/          buttons, chips, waveform, player, status pills
├── worker/transcribe.py         mlx-whisper worker (JSON lines on stdin/stdout)
└── docs/
```

Rule of thumb: `core/` decides, `services/` does, `server/` exposes, `ui/` shows. `core/` has no
imports from the others, so the rules for status, staleness and alignment are tested without
audio, network or disk.

---

## 5. The project file

`audio-studio.json` in the consumer repo root. Path templates use `{part}`, so a part only needs
an id and a title.

```json
{
  "$schema": "https://raw.githubusercontent.com/<owner>/audio-studio/main/schema/project.json",
  "name": "RetroQuest",
  "description": "A retro-style text adventure played in the browser. Narrated by a warm storyteller; characters are villagers of Willowbrook.",
  "env": ".env",
  "narration": {
    "partLabel": "Act",
    "parts": [
      { "id": "act1", "title": "Act I: The Call to Adventure" },
      { "id": "act2", "title": "Act II" }
    ],
    "characters": "tts/cast.json",
    "paths": {
      "dialog": "tts/{part}/script.json",
      "cues": "tts/{part}/cues.json",
      "lock": "tts/{part}/narration.lock.json",
      "clips": "web/public/audio/narration/{part}",
      "manifest": "web/public/audio/narration/{part}/manifest.json"
    },
    "refreshDialog": "cd web && npx -y tsx@4.23.15 --tsconfig tsconfig.json ../tts/extract-{part}.ts",
    "models": { "audition": "s2.1-pro-free", "draft": "s2.1-pro-free", "final": "s2.1-pro-free" },
    "tts": { "temperature": 0.7, "topP": 0.7, "speed": 1.0 },
    "output": { "codec": "mp3", "bitrate": "64k", "channels": 1, "lufs": -16 },
    "quality": {
      "minHeard": 0.9,
      "takes": 3,
      "chunkLimit": 400,
      "parallel": 4,
      "transcriber": "mlx-whisper",
      "whisperModel": "mlx-community/whisper-large-v3-turbo",
      "soundAlike": [["Lyria", "Liria"]]
    },
    "audition": {
      "phrase": "Come in out of the rain, child. Sit by the fire, and I will tell you how it all began.",
      "candidatesPerRound": 5,
      "language": "en"
    }
  }
}
```

- `languages` lists the languages the game is narrated in, by code (`["en", "sv"]`; default
  `["en"]`). The first is the source language: its dialog is the line shown beneath a translation.
  Path templates may contain `{language}`; with more than one language every path (`dialog`,
  `cues`, `lock`, `clips`, `manifest`) must, or languages would share a file. Each language is
  named in itself in the UI (`core/languages.ts`: `sv` is Svenska).
- `audition.phrases` (optional, language code → phrase) is the standard audition phrase of each
  language but the first, whose own is `audition.phrase`; each must fit one take. A language
  without one borrows her longest line (§6).
- `refreshDialog` is optional. When set, the UI offers **Refresh dialog**, which runs it in the
  project root and reloads the script. This is how the studio stays generic: the game owns how its
  dialog is extracted.
- `env` names the file holding `FISH_AUDIO_API_KEY`. The environment variable wins if set.
- `characters` is one file for the whole project, not a per-part path (see §6).
- `models` names the Fish model for each stage (see §8.4). Each stage, `audition` too, may name
  any model whose price the studio knows (a paid audition model is paid from a budget per sitting,
  §8.1). Anything else is rejected with a clear message.
- `quality.soundAlike` lists the game's own words that sound the same (words or phrases, a letter or
  digit in each word: "all right" and "alright"), a group each, added to the studio's built-in
  English ones (`core/soundAlike.ts`: "in" and "inn", "weekly" and "weakly", "there", "their" and
  "they're", …); see §8.2. Optional, empty by default; edited on the characters page (§8.3).
  The same for a language besides the source in `quality.soundAlikeByLanguage` (`{ "sv": [[…]] }`,
  declared languages only); the built-in groups are English words and apply to `en` only. Words
  are compared in any alphabet (letters and their marks kept: "får" is not "för"), and the numbers
  0 to 99 of `en`, `sv`, `de`, `el` and `ru` are built-in groups of their language with the digits
  Whisper writes ("tjugo" and "20", "twenty one" and "21"; `core/numbers.ts`).
- `quality.fishTier` (`under-100`, `100` or `1000`) is what the user has paid Fish in total, which
  sets how many requests Fish takes at once (5, 15, 50). Fish offers no way to ask, so the user
  says it once in the menu on Setup's Requests at once row, saved at once
  (`PATCH /api/fish-tier`, `services/fishTier.ts`). Optional; absent means not told.
- `takeFade` (seconds, 0 or more; 0 is no fade) is how long a music take fades in and out when it
  plays in the studio, chosen in the Playing takes panel on Setup (No fade, 0.1, 0.2, 0.5, 1 or 2 s;
  a length set by hand shows as an extra entry) and saved at once (`PATCH /api/take-fade`,
  `services/takeFade.ts`). Top level, not under `music`, since the panel shows in a project with no
  music yet. Optional; absent means 0.2 s. `ProjectSummary.takeFade` carries it; `useClipPlayer`
  reads it from the project as each clip begins, so a take already playing keeps its fade. The
  game's file and narration never fade.

---

## 6. Resources

The formats are the ones RetroQuest uses today, so existing files work unchanged. The studio only
**adds** fields; the game ignores what it doesn't know.

**Dialog** (`script.json`, read only; one per part and language): `[{ key, speaker, text }]`. `key` is the game's stable id for
the line (RetroQuest: a hash of speaker and words, so new wording gets a new key). Between
languages lines are matched by key: a source line missing from a language's dialog (or blank
there) is _Not translated_, and a line only the language has is shown with "No English line".

**Characters** (`tts/cast.json`, read and written): one file for the whole project. A character is
keyed by its name; every part whose dialog has a speaker of that name uses that entry, so its voice,
style and audition keywords are the same in every part. To give a character a different voice in
another part, the game names the speaker differently (`narrator-act2`), and it becomes a character
of its own. The pronunciation table is project-wide too. Per-part differences in delivery go in the
part's cues. Two characters may be cast with one voice (a narrator and a character in a prologue,
say); the studio points it out on their pages and cards, as a note, not a problem.

```json
{
  "speakers": {
    "grandmother": {
      "voice": "e48a228e21a443d6a4302dc6238c8128",
      "voiceName": "Gentle Granny",
      "style": "[warm, gentle, a little worried]",
      "speed": 0.9,
      "audition": { "keywords": ["elderly female", "warm", "storyteller"], "phrase": null }
    }
  },
  "pronounce": { "Act I:": "Act One:" }
}
```

**Per language** (as-170.2): the fields above are the source language's (the first declared). Her
casting in any other language is `languages: { "sv": { voice, voiceName, speed, phrase } }` on the
same entry, so a single-language cast, and RetroQuest's file, are unchanged. Keywords and style
are one set for every language. `core/resources.ts` reads it through `voiceOf` and `projectCast`,
which gives the planner and the takes the cast as one language sees it. The audition phrase of a
language is her own in it, else the project's standard one in it, else her longest line in it, else
none (and no audition can start). Her audition and ruled-out voices are kept per language in the
cache, the source language's under the names they always had; an audition's shortlist starts
with her voices in the other languages, so they can be heard saying this language's phrase.
On a language with no voice, the page's explanation names each distinct Fish voice once (as-2tb),
by its name on Fish with the languages it is cast in; until Fish has named it, by those languages
("Its English voice").

**Pronunciations per language** (as-170.3): the source language's table is `pronounce`; another
language's is `languages: { "sv": { "pronounce": {…} } }` at the top of the cast. `projectCast`
puts the language's own table in `pronounce`, so what is said, priced and fingerprinted is that
language's alone; a language without one has none (English respellings are never sent to another
voice).

New fields: `voiceName` (shown in the UI; the id alone is unreadable), `audition` (the keywords,
plus an optional phrase that replaces the project's standard one) and `speed` (the character's own
speaking speed, half to double as Fish allows, in place of the project's `tts.speed`; its lines,
audition takes and tries are all spoken at it). A speaker in the script with no
entry in `cast.json` shows as **Uncast**. The UI shows, for each character, which parts it appears
in and how many lines it has in each, because recasting it makes its lines stale in all of them.

Pronunciations apply in the order the file lists them, with one limit: JavaScript puts integer-like
keys (`"10"`) first when it reads the file, so the studio applies those first, where RetroQuest's
Python tooling keeps file order. The studio refuses to rewrite a cast where this would change the
order (an integer-like key among others); a longer key such as `"Act 10"` keeps its place.

RetroQuest today has `tts/act1/cast.json`; switching over moves it to `tts/cast.json` once (only Act I
is cast so far, so there is nothing to merge).

**Cues** (`cues.json`, read and written): `{ key: cue }`, replacing a character's style for one line.
Cues are per language (as-170.3): a line in a language besides the source follows the source
language's cue for the line until the language's own file gives it one, then the character's style.
The planner is given the merged cues (`readPart` builds them), so a changed source cue makes the
language's clips stale for the cue, and `LineState.cueFrom` (`own`, `source`, `style`) and
`sourceCue` tell the page where a cue comes from. Editing a cue in a language writes that
language's file only.

**Scene cues** (as-2qh): a dialog line may name its `scene`, and the cues file holds a cue per scene
under the key `scene:<name>` (a line key never holds a colon, so it cannot collide with one, and the
game, which looks up its own keys, ignores it). A line is cued by its own cue, else its scene's, else
its character's style; only the speakers in `narration.sceneCueSpeakers` (cast ids, default
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

**Lock** (`narration.lock.json`, written, committed): one entry per clip, recording what it was
made from. Written one entry per line, keys sorted, so a re-recorded clip is a one-line diff.

```json
{
  "0022d0ca3a78d2": {
    "fp": "720367754eff3c80",
    "voice": "7d80…",
    "model": "s2.1-pro-free",
    "parts": { "cue": "30e4588b", "text": "a05bdb9c", "said": "a05bdb9c", "settings": "4666d299" },
    "heard": 0.96,
    "takes": 1,
    "at": "2026-10-23T10:14:00Z"
  }
}
```

`parts` are short hashes of the inputs that are not kept in the clear, so the planner can say which
one changed. `heard` and `takes` are absent, and `adopted` is true, for clips made before the studio.
`accepted` is true when the user accepted a weak clip as it is (Accept on the lines page); recording
the line again writes a new entry without it.

The lock is a separate file so the manifest format the game depends on stays exactly as it is.

**Cache** (`.audio-studio/`, gitignored): the tool's own state, none of it the game's: audition
takes, audition sessions in progress, the voices ruled out per character, a line's extra takes
(`.audio-studio/line-takes/<part>-<hash>/<key>/<id>.wav` and `.json`: the audio as Fish sent it,
joined, and what Whisper made of it), the user's notes on
lines (`.audio-studio/notes/<part>-<hash>.json`: "too fast", "retake after the rewrite"; on this
machine only, so a teammate does not see them), and what Whisper heard
of each kept take heard below full (`.audio-studio/heard/<part>-<hash>.json`: per line, the lock
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
with beside it and the keywords the audition started with; with no audition in progress, it
offers to start one.

**Your voices** sit on the board between the Shortlist and To hear: every voice on the user's own
Fish account (`GET /model?self=true`, `listOwnVoices`), whatever the keywords, never ranked and
never in To hear. They are fetched by their own request (`POST /api/auditions/:id/own`) when a
board opens, on a start or a resume, and again on Try again, so the board does not wait for Fish;
a failure leaves the session as it was. The session keeps them in `yours` (the section) and
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
`.audio-studio/designs/<character>-<hash>.json` (one per language in a project with several, named as the audition's and ruled-out files are; `core/designs.ts`: the voices with their number
"Design n", the description, when they were asked for, how many were ever made, and the last
description sent); the preview is encoded to MP3 into `.audio-studio/takes/` under a key made from
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

- **To hear** holds the candidates being listened to, best match first. **Bring in more** adds
  the next ones (`audition.candidatesPerRound`), searching again when the queue runs short;
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
- **Takes** of the board use `models.audition`. On the free model an audition costs nothing, and
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
  in `.audio-studio/auditions/<character>-<hash>.json` and ruled-out voices in
  `.audio-studio/ruled-out/<character>-<hash>.json` (each voice's id, title and when it was
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
   are recorded with `models.draft`. Up-to-date clips Whisper never checked can be measured
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
      `quality.soundAlike`: "inn" heard as "in", "weekly" as "weakly"), wherever words are matched
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
  request (Fish splits long text itself), kept in `.audio-studio/takes/` under the take key, so
  the same cue on the same line is recorded once; nothing of the game's is written. The clip
  recorded afterwards uses the draft model, chunked and checked, so it can sound a little
  different.
- Edit the project's own words that sound the same (built: the Words that sound the same panel on
  the characters page, under Pronunciations): one group a row, words separated by commas, saved
  as a whole in the project file's `narration.quality.soundAlike`, refused if the file's groups
  changed since editing began. The project file is otherwise only read; the save keeps the rest of
  it, in its own indentation (a hand-compacted object is written out). Takes already recorded keep
  their heard share; the groups count from the next take on.
- Warn that `s1` retires (built): while the project file names `s1` for `models.draft` or
  `models.final`, a banner on every page says so (past tense from 1 January 2027, UTC) with Not now
  (until the page is reopened; nothing stored) and Switch to s2.1-pro. Switch asks first, then
  rewrites only the models that are `s1` to `s2.1-pro` in the project file, the same careful way
  as the sound-alike save (the second change the studio makes to the project file). The audition
  model and recorded lines are not touched. A clip made with `s1` counts as up to date under
  `s2.1-pro` (`sameModel`, `fingerprintMatches` in `core/fingerprint.ts`): Fish serves and bills
  them as one.
- Choose the stage models (built, as-3h4): the **Models** panel at the top of Setup shows the
  audition, draft and final models with Fish's rate and what recording the whole dialog once
  would cost (`GET /api/models`: the models, the dialog's lines and bytes over every part and
  language, the clips by the model they were made with, and what is recording or auditioning).
  A menu change is saved in `narration.models.<stage>` (`PUT /api/models/:stage`, `{ model, was }`:
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
  take, not the `quality.takes` a recording is held to): **Pay up to $X** and **Cancel** replace the
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
- Refresh dialog (runs `refreshDialog`; built).
- **Changes** panel (built): `git status` for the project's paths, so the user sees what to
  commit.
- **Spending** page (built): what paid recordings (and, with ElevenLabs, music takes) cost,
  project-wide and read only. Every
  recording made with a paid model (a whole part's, draft or final, or one line's record or extra
  take) is added to `.audio-studio/spending.json` when it ends: when it started, part, language
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

**Project file.** An optional `music` section beside `narration`, its acts the narration's parts.
Only the paths and the model are settled; the number of takes and the output settings are fixed in
the code until a project needs another value. `model` (optional; `balanced`, `quick`, `quickest`,
`careful`, `short` or `shortest`, Balanced when absent) is the music model new takes are made with, saved from Setup's
Models panel (the fifth place the studio writes the project file, with the same rules as the
stages' models):

```json
"music": {
  "model": "balanced",
  "refreshShared": "cd web && npx -y tsx@4.23.15 --tsconfig tsconfig.json ../tts/extract-shared.ts",
  "paths": {
    "loops": "tts/{part}/music.json",
    "stingers": "tts/stingers.json",
    "briefs": "music/briefs.json",
    "lock": "music/music.lock.json",
    "clips": "web/public/audio/music/generated",
    "manifest": "web/public/audio/music/generated/manifest.json"
  }
}
```

The clips folder is the studio's own: tracks that are not the studio's (RetroQuest's freetouse.com
files) stay where they are, untouched. The music files (the game's lists, the studio's briefs, the
lock, the clips and the manifest) join the Changes panel (§8.3); `briefs.json` is committed, the
studio's own changes to the game's music. No music path may hold `{language}`: music is the same in
every language. `refreshShared` is optional: the game's command for what belongs to no act (the
stingers), run in the project root by Refresh from the game on the Stingers page, as `refreshDialog`
is for an act; without it the page has no such button.

**Track lists** (read only, written by the game): an act's loops in `loops`, written by the game's
own `refreshDialog` command for that part alongside its dialog, and the stingers for the whole game
in `stingers`, written by `refreshShared`. Both are lists in the game's order. A list that is there
and empty means the game asks for none; a list that is not there yet means the game has not listed
them ("The game has not listed the loops for Act IV yet."), and no track is taken for an orphan
because of it.

```json
[
  {
    "id": "willowbrook-village",
    "title": "Willowbrook village",
    "plays": "Willowbrook, the village square",
    "brief": "gentle medieval village, lute and recorder, warm, unhurried",
    "seconds": 90,
    "bpm": 84,
    "key": "D major"
  }
]
```

The file says the kind: a track in `loops` is a loop, one in `stingers` a stinger. A track's id
names its file in the one clips folder, so it is a slug (`^[a-z0-9]+(-[a-z0-9]+)*$`) and unique
across the game (a second use is a problem with both files and paths, and neither track is shown or
made until it is resolved). `plays` (where the game plays
it, shown under its name), `file` (the music file the game plays for the track now, a path inside the
project root to an `.mp3`, `.ogg`, `.wav`, `.m4a` or `.flac`; read only, never moved, levelled,
re-encoded or written, and never taken as a chosen take) and `bpm` and `key` are optional; `brief` and `seconds` are the game's
starting point. Tracks are always instrumental (no lyrics). `bpm` and `key` ("D major") are passed
to ACE-Step as its own fields; their allowed values are settled in 12.2. A stinger is at most 10
seconds.

**Briefs** (`music/briefs.json`, read and written by the studio): what the studio changed of a
track's brief, length, tempo and key, `{ id: { brief?, seconds?, bpm?, key? } }`, like a line's
cue over a character's style; `null` for `bpm` or `key` means none, over the game's. A field changed
on the track's page is saved as the field is left and marked "changed here"; "use the game's", or a
value typed back to the game's, removes it again. The game's lists are never written.
Validated like every resource and written through `writeAtomic` in stable key order.

**Pages.** The sidebar lists a workspace's acts only while one of its pages is open (Narration's
acts the same way); on Setup and the project pages both are folded. Music opens into the acts and
Stingers, a page each, listing its tracks
with their status (see Status below). An act's page has **Refresh from the game** when the project
has `refreshDialog`: the same command as Refresh dialog, which brings the act's lines and loops
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
studio resolves itself from the row (the page sends no path). A track opens its own page (built: its Brief panel and its Takes panel; its board: the In the game block with Un-choose, Make N more takes, Stop, Drop, Choose, earlier-brief marks, and an amber box above the Takes panel when the track changed since its take was chosen).

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
`.audio-studio/music-takes/<track>/<hash>.<n>.wav` by a hash of its inputs (brief, kind,
seconds, bpm, key; the hash still begins with Balanced's recipe, so choosing a model never changes it) and a take number counted from 1 per hash, with `<hash>.<n>.json` beside it
(seed, length, waveform bars). The same seed does not make the same take again on the Mac, so the cache keeps the take
itself; the seed is kept with it, in the board and the lock, to say where it came from (absent from
a take whose model takes none, as ElevenLabs' will not, §8.6). The brief a
take is made from is the game's with the studio's changes over it. What is built is the Takes panel on a track's page: "Make N takes" (when there are none) queues N, 1 to 6 from the count menu (as-3ek),
made one at a time on the GPU queue, each a dashed card with a progress bar (about 3 minutes
expected, a guess) and its time left, then a card with play, its waveform (a loop's seam marked),
its length and, for a loop, **Hear the seam** (`GET …/takes/<file>?seam=1` is the last 4 seconds
followed by the first 4, one WAV). A take that fails is kept as "could not be made" with the
generator's reason and **Try again** (remakes that number); the other takes stay. A worker the
computer killed (exit code 137, most often memory running out) says so in plain words, never its
log: "The music generator was stopped by the computer, most likely because it ran out of memory.
Close other music jobs, then Try again." The making state is
in memory (a restart forgets a failure, not a take). The board for a track shows its
takes as cards: The count menu ("Number of new takes", between the model menu and the button) starts at 2 and goes back to 2 after every press; it is page state, never remembered. **Make N more takes** generates N more (two by default, about six minutes), made in the background, so
the page can be left meanwhile; **Drop** removes one (not the chosen one); **Choose** writes one at
once, without asking, since the take it replaces stays on the board to be chosen again. Takes made
from an earlier brief stay, marked "earlier brief". The board is kept in
`.audio-studio/music/<track>.json` (a track id is a safe file name): `{ next, takes: [{ n, hash, seed?,
seconds, peaks, inputs, model }] }` (`model` is the recipe of the music model that made the take, which Choose records in the lock; a board without it is read as Balanced, the only model there was), the take's WAV beside the others in `music-takes/<track>/`. Take
numbers are per track and never reused (`next` is reserved when takes are asked for), and a take
is on the board only once its WAV is written. The cache no longer keeps a sidecar file per take. A dropped take is just gone:
seeds don't come back, so nothing is ruled out.

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

**Choose** levels the take to −20 LUFS as narration is levelled (`level.py`'s commands; RetroQuest
levels its music to −20 today) and encodes it into the clips folder as `<track>.mp3`, stereo,
160 kbps, with ffmpeg's LAME encoder, which writes the header that tells a decoder how much
padding to drop. Chrome decoded such an MP3 to its exact length (80.000 s, no silence at either
end, against the WAV), so the game loops it without a gap through Web Audio; a looping `<audio>`
element is not relied on. Safari and Firefox are checked with the game (12.8). As for narration,
the encoder writes a hidden temporary file in the clips folder, renamed into place together with
the manifest and lock update (built, 12.6): the temporary file is renamed over the clip, the manifest written, the lock last, all in one turn per project. A failure of the encode, or of reading the manifest or lock, leaves everything as it was (Choose and Un-choose then say which of the two could not be read and that nothing was changed, the manifest first when both are broken, as-kvz); a write that fails after the rename (a full disk) leaves the new clip beside the old lock, and choosing again repairs it. A take is chosen and dropped in the track's board turn, so neither slips between the other's check and write, and a drop is refused while the lock cannot be read. **In the game** (as-7o1): what the game plays is shown on its own block between the Brief and Takes panels, and the Takes panel lists only the takes that are not chosen (a drop of the chosen one is still refused, 409). The block is one of three things, from the track row (`inTheGame` in `core/musicChoose.ts`; `TrackRow.gameFile` is the game's own file whether or not a take is chosen): the chosen take (green, "chosen", play, waveform, length, Hear the seam, **Un-choose**), the game's own file when none is chosen (green, "The game's own file" and its path, no Un-choose; amber and "The file is not there." when it is not on disk), or a dashed "Nothing plays here yet", also on a brand-new track. While the music lock cannot be read, what a track plays is not known (`CurrentMusic` `unknown`, as-77u): the block is amber, "The music lock could not be read", with no Un-choose (an Un-choose pressed before the lock broke is refused, 409, and its red "Take N could not be un-chosen: the music lock could not be read. Nothing was changed." stays under that amber block after the page re-reads, with focus on the block), and the list's Plays cell says "Not known", never the game's own file, since the lock is what says a take is chosen (as-x73): the same holds elsewhere: every track's Status chip says "not known" (amber) and the list's line says which are chosen is not known instead of counting; the Takes panel (`MusicTakesView.lockUnread`) lists every take, the chosen one among them, with Choose and Drop disabled and one amber line saying why once there is a take card. A chosen take whose clip is gone turns the block amber ("music file missing") with Un-choose and **Choose again**, which writes the file again. **Un-choose** asks first, since it deletes the take's music file from the game, then (`POST /api/music/tracks/:id/unchoose`, in the board's turn and the project's choice turn) deletes the manifest entry, the clip and, last, the lock entry, so a failure part-way can be pressed again; the take stays on the board, to be chosen or dropped, and the game goes back to its own file or plays nothing. The game's own file is never un-chosen, written or deleted. A track with no chosen take is refused (409). Clips are served only as plain files in the music clips folder (`GET /api/music/clips/<track>.mp3`: no folders, links, hidden files or the manifest).

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

**Lock** (`music.lock.json`, committed, one entry per line, `{ fp, model, seed?, list, take, inputs,
at }`): per track, the chosen take's model,
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
entry, then its briefs entry (which the next save of the briefs would drop anyway) (`POST /api/music/tracks/:id/remove`, 404 for a track that is not
an orphan; a manifest or lock that cannot be read deletes nothing). A list that is missing or
unreadable has no orphans, and one another list names is not one. The briefs and board of a track
never chosen that no list names are dropped at the next save of the briefs, and only when every
list is there (which list named a track never chosen is not known); while a list is missing,
nothing is dropped.

**Generator.** `MusicGenerator` (`services/music.ts`) generates one take as a WAV, from the brief,
kind, seconds, bpm, key and seed, so tests run with a fake. The real one is a Python worker
(`worker/music.py`, ACE-Step through uv, the models loaded on the first take and stopped with the
studio), the same JSON-lines protocol as the Whisper worker. Both workers run in the studio's own
`worker/` folder, not in the game's repository the studio runs from, so what they write beside
themselves (ACE-Step's `.cache/acestep/progress_estimates.json`) stays with the studio, ignored by
its git. Each request names the pair of models to make the take with (`dit` and `lm`, folders in the
checkpoints folder); the worker loads a pair on the first take that needs it and swaps it, freeing the
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
the recipe `stable-audio-open-1.0` or `-small`. The times per take (40 s and 10 s) are estimates
until measured on real takes. ACE-Step and Whisper share the one GPU
and never run at once: both workers stay loaded, and one queue (`services/gpu.ts`, a process-wide
`createSerial` key; Whisper's checks reach it through `onGpu`) runs a take or a Whisper check at a
time. In the spike, with both loaded and running together, 42 of the 48 GB were in use (20 GB of it
compressed), and Whisper ran 2.5 times slower. The setup checklist (§10) names ACE-Step's
environment and its model download, and, in its own optional row, Stable Audio's.

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
not use until it is measured) and never more than `quality.parallel` (`requestsAtOnce`). Speech is asked
for as `wav_24000` (every plan may ask for it; 44.1 kHz needs Pro), so lines join, are checked and
encoded as Fish's are. Music is asked for as `mp3_44100_128` (every plan; the default 192 kbps needs
Creator) and decoded with ffmpeg to 16-bit WAV before it is shaped; it is encoded at 160 kbps when
chosen, as every take is.

**Models, per provider.** Each provider's prices are a table of their own, in their own unit: Fish's
stay `core/prices.ts` (dollars per million bytes), ElevenLabs' speech models get a table beside it
(credits per character, `core/elevenSpeech.ts`, built in 14.7a), and Eleven Music's price per minute is on its music model
(14.5). A stage accepts only its own provider's models: `narration.models` (Fish's, as
today) and `narration.elevenlabs.models` (`audition`, `draft`, `final`; default `eleven_v3`) are
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

- **Settings** (saved from Setup since 14.9.2). ElevenLabs' voice settings, `narration.elevenlabs.tts`
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
  `narration.tts.speed`) is sent as `speed`; ElevenLabs takes 0.7–1.2, so a character with an
  ElevenLabs voice whose speed in use lies outside it has each of its lines refused when recorded,
  with the reason, and its page says why under its speed. Nothing is clamped.
- **Cues** (built in 14.8). Eleven v3 reads `[bracket]` tags as directions, as Fish does, so cues
  are sent as they are. Multilingual v2 and Flash would speak them (`readsCues`), so with those
  models cues are left out of the text and out of the fingerprint (`clipInputs` gives `cue` and
  `inside` empty), so editing a cue never re-records audio that would not change, and out of what a
  plan counts (`sentPieces`). The page still shows a line's cues (`cueInputs`), and from 14.9, when
  such a model can be chosen, the cue editor says they are not spoken. The text is chunked at
  `quality.chunkLimit` as for Fish.
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
  `narration.elevenlabs.models.audition` (chosen on Setup's ElevenLabs audition row, saved at
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
  given, about N takes left) with Add when they are used up, as the dollars' meter does. A resume
  asks for them again the same way.

**Spending** (built in 14.7d). The log (`.audio-studio/spending.json`) moves to version 2 when it
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
not cast. The studio remembers which voices it added (`.audio-studio/eleven-voices.json`: the
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

## 9. Server API

Built so far: `GET /api/project`, `GET /api/parts/:part` (with every line's status),
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
Takes are cached in `.audio-studio/takes/<key>.mp3`, the key a hash of the take's model (the audition model on the board, the free one for the cast voice's page take and tries, ElevenLabs' audition model for an ElevenLabs voice's, with its voice settings), voice,
spoken phrase and settings, so a take is recorded once. Auditions: `GET` and `DELETE
/api/auditions/:id`, and `POST /api/auditions/:id/` `start`, `move` (`{ voice, move: shortlist | unlist | drop }`),
`undo` (the last drop), `more` (`{ provider }`, `fish` unless `elevenlabs`; no body is Fish's), `add` and `cast` (`{ voice }`, a shortlisted one); `start` takes `{ spendUpTo }` on a paid audition model and `{ creditsUpTo }` for ElevenLabs voices' takes; `GET`, `POST` (`{ amount?, credits? }`, a fresh sitting) and `DELETE /api/auditions/:id/sitting` and `POST …/sitting/add` (`{ amount }` or `{ credits }`, the first credits giving a sitting its ElevenLabs half) are the audition's money, and `GET /api/elevenlabs/account` the plan's account and what is held of it, `GET /api/elevenlabs/voices/freeable` the voices the studio added that nothing uses and `POST /api/elevenlabs/voices/free` (`{ voices }`) removes them; a board take is `POST /api/characters/:id/takes` with `{ voice, board: true }`; sessions are kept in `.audio-studio/auditions/`. Ruled-out voices:
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
GET    /api/credit                               the Fish account's API credit (dollars)
GET    /api/setup                                what the machine and project lack (ffmpeg, uv, key, Fish, ACE-Step)
GET    /api/music/tracks/:id/takes               a track's takes, those being made, failures, and whether takes can be made
POST   /api/music/tracks/:id/takes               { count } or { retry } queue takes (409 and why if the generator is not ready)
POST   /api/music/tracks/:id/choose              { file } make a take the track's music: levelled, encoded, manifest and lock written (409 and why if it cannot)
POST   /api/music/tracks/:id/remove              remove an orphan's music: clip, manifest, lock, board, takes, brief changes (404 if it is not one)
GET    /api/music/clips/:file                    a music clip (a plain .mp3 in the music clips folder)
POST   /api/music/tracks/:id/stop                stop the takes: the one being made ends and is discarded, the waiting ones are cancelled
POST   /api/music/tracks/:id/move                { file, to } move a take to the track `to` of the same kind: `{ ok, n }` its new number (409 and why if it cannot)
DELETE /api/music/tracks/:id/takes/:file         Drop: take it off the board and delete its file (409 if it is not on the board)
GET    /api/music/making                         what is being made, by track ({ takes, left seconds }), for the lists' status
GET    /api/music/tracks/:id/takes/:file         a take's WAV (?seam=1: its seam)
PATCH  /api/fish-tier                            { tier } the Fish tier (or null) in the project file
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
POST   /api/parts/:part/refresh                  run refreshDialog (its result names the act's loops added and removed)
POST   /api/music/stingers/refresh               run music.refreshShared; the stingers added and removed
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
POST   /api/auditions/:id/start                  an audition from a fresh search
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
  ffmpeg, uv for Whisper (off when `quality.transcriber` is `none`; a problem off Apple silicon),
  the Fish key in the environment or the env file (read on every check; the keys Bun loads at start
  from the env files of the folder the studio is started in are forgotten, `forgetLoadedKeys`, so a
  key changed in the file is seen, while one exported with another value still wins), whether Fish
  answers (the server's credit
  lookup, only with a key), Requests at once (`quality.parallel` against the Fish account's limit
  from `quality.fishTier`: ready up to 5 with no tier, a problem above it until the tier is
  chosen, and above the chosen tier's limit; off without a key; saving the tier checks again,
  which asks Fish once more), the optional `refreshDialog` and, with a `music` section, the music
  generator (Apple silicon, uv, and the two model folders of the project's music model, Balanced's
  `acestep-v15-xl-turbo` and `acestep-5Hz-lm-4B` by default, in `$ACESTEP_CHECKPOINTS` or
  `~/.cache/ace-step/checkpoints`; downloaded outside the studio, about 28 GB for Balanced; when
  the project's model is a Stable Audio one, only the machine and uv) and, in a row of its own, the
  optional Stable Audio Open models in `~/.cache/stable-audio` ("Not set up" until they are there,
  "Needs attention" only when the project's music model is one that is missing, with three numbered
  steps: accept the licence, make a read token, download), and two optional ElevenLabs rows (§8.6):
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
  only then gives up, saying to lower `quality.parallel` or wait for other work on the key. The
  studio itself never has more than `quality.parallel` TTS requests in flight (one limiter for
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
      `quality.takes` takes per line until one is heard at `minHeard`, keeping the best: real
      word timings in the manifest, the heard share and takes in the lock. `quality.transcriber:
"none"` records one unchecked take, as before.
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
      `narration.quality.soundAlike`, refused if the file's groups changed since editing began.
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
   3. **The switch** (built, RetroQuest #508): in RetroQuest, one shared `tts/cast.json` from the four act casts (the
      grandmother's recast everywhere; the mother's Act III style as cues on her Act III lines),
      `audio-studio.json` for all four acts with the new extractor, every act's clips adopted,
      `.audio-studio/` ignored, `narrate.py`, `test_narrate.py` and `fish_tts.py` retired
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
      `.audio-studio/ruled-out/`, left out of every later search for it; listed on the character
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
       act's page, and on the Stingers page running `refreshShared` (CLAUDE.md's consumer rules
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
       `.audio-studio/music/<track>.json`; "making 2 takes · about 4 min" on the lists.
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
13. **Languages** (epic as-170), in small pull requests:
    1. **Show a part's lines in each declared language** (built): `narration.languages`,
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
