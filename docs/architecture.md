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
├── .audio-studio/               ← tool state: takes, auditions, ruled-out voices, what was heard
├── tts/cast.json                ← character resource, shared by all parts (read + written)
├── tts/act1/
│   ├── script.json              ← dialog resource (read)
│   ├── cues.json                ← per-line delivery cues (read + written)
│   └── narration.lock.json      ← per-clip fingerprints (written, committed)
└── web/public/audio/narration/act1/
    ├── *.mp3                    ← clips (written)
    └── manifest.json            ← key → file, speaker, duration, word timings (written)
```

1. `audio-studio` walks up from the current directory to find `audio-studio.json`. That directory
   becomes the **project root**; every path in the project file is relative to it.
2. It validates the project file and every resource it points to, then starts a Bun HTTP server on
   `127.0.0.1` (random free port, or `--port`) and opens the browser on it.
3. The UI talks to the server over a small JSON API, and gets live job progress over a WebSocket.
4. The studio writes only to paths the project file names, and every path goes through
   `resolveInRoot`, which refuses anything outside the project root. Clips are served only when
   they are plain files in the part's clips folder (no folders, no symbolic links). The one
   exception is **Refresh dialog**: it runs the project's own `refreshDialog` command (the game's
   code, named in its project file) in the project root, only when the user clicks it on the
   studio's page; what that command writes is the game's business, and the studio does not check
   it beyond reading the dialog again.
   Besides those paths, the studio writes the project file itself in one place only: the project's
   own words that sound the same (`narration.quality.soundAlike`), from the characters page (§8.3).
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
| Music generation (planned, §8.5)            | **ACE-Step 1.5** in a long-lived Python worker (`uv run`)        | Free and local; why, in §13 decision 4.                                                                                                                 |

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
│   │   ├── changes.ts           git status output parsed and grouped by part
│   │   ├── dialogDiff.ts        what a refreshed dialog added, removed and changed
│   │   ├── fingerprint.ts       hash of everything that affects a clip
│   │   ├── planner.ts           script × lock × disk → status per line, generation plan
│   │   ├── summary.ts           parts and characters as the UI shows them
│   │   ├── voiceSearch.ts       search terms from keywords; ranking of found voices
│   │   ├── castFormat.ts        the cast as text, in its own layout (one line per character)
│   │   ├── align.ts             Whisper words → word timings, heard ratio (narrate.py's, + names)
│   │   ├── audition.ts          the audition board: to hear, shortlist, drop and undo
│   │   ├── ruledOut.ts          voices ruled out per character (dropped, left out of searches)
│   │   ├── heard.ts             what Whisper heard of a part's lines below full, as saved
│   │   ├── soundAlike.ts        English words that sound the same, matched as one
│   │   └── wav.ts               read and join WAVs
│   ├── services/                I/O behind interfaces (fakes in tests)
│   │   ├── env.ts               the Fish API key, from the environment or the env file
│   │   ├── fish.ts              FishClient (listVoices, getVoice, tts, credit)
│   │   ├── voiceSearch.ts       searching Fish for every term, pooled and ranked
│   │   ├── auditions.ts         candidates and the cast voice of a character; cast changes, in turn
│   │   ├── sessions.ts          audition sessions in progress, saved in the tool's cache
│   │   ├── ruledOut.ts          ruled-out voices per character, saved in the tool's cache
│   │   ├── soundAlike.ts        the project's sound-alike groups, saved in the project file
│   │   ├── heard.ts             what Whisper heard of each take below full, saved in the cache
│   │   ├── takes.ts             audition takes: recorded once, cached by what they are made of
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
│       ├── player.ts            plays clips one at a time, or a list in turn
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

- `refreshDialog` is optional. When set, the UI offers **Refresh dialog**, which runs it in the
  project root and reloads the script. This is how the studio stays generic: the game owns how its
  dialog is extracted.
- `env` names the file holding `FISH_AUDIO_API_KEY`. The environment variable wins if set.
- `characters` is one file for the whole project, not a per-part path (see §6).
- `models` names the Fish model for each stage (see §8.4). `audition` must be the free model for
  now; `draft` and `final` may name any model whose price the studio knows. Anything else is
  rejected with a clear message.
- `quality.soundAlike` lists the game's own words that sound the same (words or phrases, a letter or
  digit in each word: "all right" and "alright"), a group each, added to the studio's built-in
  English ones (`core/soundAlike.ts`: "in" and "inn", "weekly" and "weakly", "there", "their" and
  "they're", …); see §8.2. Optional, empty by default; edited on the characters page (§8.3).

---

## 6. Resources

The formats are the ones RetroQuest uses today, so existing files work unchanged. The studio only
**adds** fields; the game ignores what it doesn't know.

**Dialog** (`script.json`, read only): `[{ key, speaker, text }]`. `key` is the game's stable id for
the line (RetroQuest: a hash of speaker and words, so new wording gets a new key).

**Characters** (`tts/cast.json`, read and written): one file for the whole project. A character is
keyed by its name; every part whose dialog has a speaker of that name uses that entry, so its voice,
style and audition keywords are the same in every part. To give a character a different voice in
another part, the game names the speaker differently (`narrator-act2`), and it becomes a character
of its own. The pronunciation table is project-wide too. Per-part differences in delivery go in the
part's cues.

```json
{
  "speakers": {
    "grandmother": {
      "voice": "e48a228e21a443d6a4302dc6238c8128",
      "voiceName": "Gentle Granny",
      "style": "[warm, gentle, a little worried]",
      "audition": { "keywords": ["elderly female", "warm", "storyteller"], "phrase": null }
    }
  },
  "pronounce": { "Act I:": "Act One:" }
}
```

New fields: `voiceName` (shown in the UI; the id alone is unreadable) and `audition` (the keywords,
plus an optional phrase that replaces the project's standard one). A speaker in the script with no
entry in `cast.json` shows as **Uncast**. The UI shows, for each character, which parts it appears
in and how many lines it has in each, because recasting it makes its lines stale in all of them.

Pronunciations apply in the order the file lists them, with one limit: JavaScript puts integer-like
keys (`"10"`) first when it reads the file, so the studio applies those first, where RetroQuest's
Python tooling keeps file order. The studio refuses to rewrite a cast where this would change the
order (an integer-like key among others); a longer key such as `"Act 10"` keeps its place.

RetroQuest today has `tts/act1/cast.json`; switching over moves it to `tts/cast.json` once (only Act I
is cast so far, so there is nothing to merge).

**Cues** (`cues.json`, read and written): `{ key: cue }`, replacing a character's style for one line.

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
takes, audition sessions in progress, the voices ruled out per character, and what Whisper heard
of each kept take heard below full (`.audio-studio/heard/<part>-<hash>.json`: per line, the lock
entry's time, the text it was checked against, Whisper's words and the shown words it missed). Deleting it loses nothing the game
needs; it forgets paused auditions, ruled-out voices and what was heard.

All JSON is written with stable key order and the same layout the file already has, through a
temporary file and a rename, so diffs stay small and a crash never leaves a half-written file.

---

## 7. Staleness: the fingerprint

A clip is up to date when its fingerprint matches the lock. The fingerprint is a SHA-256 of
everything that changes the audio:

```
fp = sha256(json([
  model,                      // the draft stage's model
  voiceId,
  cue,                        // the line's cue, else the character's style
  said,                       // the line with pronunciations applied and checklist bullets read as a list
  settings                    // temperature, topP, speed, chunkLimit, codec, bitrate, channels
]))[:16]
```

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
confirmation when generating), and cues whose key is gone as **orphaned cues**.

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
records by itself when missing), its lines per part, its delivery (the style cue) and casting
brief (search keywords and audition phrase), the voices ruled out for it, the audition in
progress, if there is one, and **Hear it in the game**: its recorded lines with their part, cue
and status, as the game plays them, one by one or all in turn (the first five shown until asked
for all; any other play stops the list; a clip that fails is skipped). An audition is started,
resumed and stopped from there; the page shows no candidates. The **audition page**
(`#/characters/<id>/audition`) shows the board, with the phrase and style the takes are recorded
with beside it and the keywords the audition started with; with no audition in progress, it
offers to start one.

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
  **Bring in a specific voice** adds one by its Fish id or URL.
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
- **Takes** use `models.audition` (for now the free model, so an audition costs nothing, and takes
  record by themselves for every voice shown, each once; one that fails is recorded again only
  when asked; a paid audition model will ask first). Each voice
  also offers Fish's own sample clip.
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
      inside a word) only a known name: a one-word character id of the cast ("aren", not "ancient
      tree spirit") or pronunciation. Lowercase words, short ones, numbers and other
      sentence-initial words must match exactly. A title-case word mid-sentence ("The Call") is
      taken for a name;
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

- Edit a character's style cue or keywords, a line's cue, or the pronunciation table (built):
  saved at once, and affected lines show as stale.
- Edit the project's own words that sound the same (built: the Words that sound the same panel on
  the characters page, under Pronunciations): one group a row, words separated by commas, saved
  as a whole in the project file's `narration.quality.soundAlike`, refused if the file's groups
  changed since editing began. The project file is otherwise only read; the save keeps the rest of
  it, in its own indentation (a hand-compacted object is written out). Takes already recorded keep
  their heard share; the groups count from the next take on.
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
- Refresh dialog (runs `refreshDialog`; built).
- **Changes** panel (built): `git status` for the project's paths, so the user sees what to
  commit.

### 8.4 Model stages and final generation

There are three model stages in the project file: `audition` (candidate takes), `draft` (everyday
generation while the script and cast still change) and `final` (the recording that ships).

- **Now:** `audition` is the free model only. `draft` and `final` may name any model whose price
  the studio knows (`core/prices.ts`). A paid recording, a job or one line, starts only when the user
  has confirmed the most it can cost (every line needing every take, priced when asked), and the
  account's credit covers it: the server works the ceiling out itself and refuses a request without
  a confirmation at least that high (answering with the ceiling to confirm), or when the credit is
  short or unknown. The confirmed dollars become the recording's budget: charged before every
  request to Fish, at that moment's price, it refuses another model than the one confirmed and
  anything beyond what is left, so nothing changed meanwhile (the project's model, a cue, the
  takes, a promotion ending) spends more than was agreed; without a budget only the free model
  can be used. All that running recordings were given is held back from the credit until they
  end (Fish may bill a request after it was charged); a recording refused after it was admitted,
  and a job when it ends, give theirs back. There is no
  separate step for auditions yet: they are always free.
- **Final recording** (built): when `final` names another model than `draft`, the Generate panel
  offers **Draft** and **Final**. The final plan records every cast line whose clip was not made
  with the final model yet (missing, stale, drafted, untracked), with the final model, priced and
  confirmed like any paid job. A clip is up to date if its lock matches the inputs with either
  model; one made with the final model is marked `final` in the line table, and draft plans
  leave it alone. A final clip whose inputs change (a cue, the text) matches neither and goes
  stale like any other, and the draft plan records it again with the draft model (so a paid clip
  edited afterwards becomes a draft one until the next final recording). A weak final clip is
  retaken only with the final model: from its row, or by the final plan when asked. With one
  model for both, there is no final step: a final plan or recording is a draft one. A paid
  `audition` model is still to come, with its cost per take.

### 8.5 Music (planned)

The music workspace makes the game's **tracks**: looping background music, one per room or region
as the game chooses, and short **stingers** (victory, game over). A track is made like a voice is
cast: a brief, several generated takes to listen to, and one take chosen. The steps are in §12,
step 11. What the spike (11.1) has not confirmed yet is marked _to confirm_: the model's name and
sizes, its shortest take, its licence for the weights, and how it runs on Apple Silicon.

**Project file.** An optional `music` section beside `narration`. Only the paths are settled; the
model, the number of takes and the output settings are fixed in the code until a project needs
another value:

```json
"music": {
  "tracks": "music/tracks.json",
  "paths": {
    "lock": "music/music.lock.json",
    "clips": "web/public/audio/music/generated",
    "manifest": "web/public/audio/music/generated/manifest.json"
  }
}
```

The clips folder is the studio's own: tracks that are not the studio's (RetroQuest's freetouse.com
files) stay where they are, untouched. The music files join the Changes panel (§8.3).

**Track list** (`music/tracks.json`, read and written by the studio, edited on the Music page):

```json
{
  "tracks": {
    "willowbrook-village": {
      "title": "Willowbrook village",
      "kind": "loop",
      "brief": "gentle medieval village, lute and recorder, warm, unhurried, 84 bpm, D major",
      "seconds": 90
    },
    "victory": {
      "title": "Victory",
      "kind": "stinger",
      "brief": "short triumphant brass fanfare",
      "seconds": 5
    }
  }
}
```

A track's id names its file, so it is a slug (`^[a-z0-9]+(-[a-z0-9]+)*$`); `kind` is `loop` or
`stinger`. Tracks are always instrumental (no lyrics). Tempo and key are written in the brief for
now; they become fields of their own if the spike shows ACE-Step follows them better that way.
The file is validated like every resource (problems with file and JSON path) and written through
`writeAtomic` in stable key order.

**Takes.** A take is the brief generated with a new seed, and shaped at once, so what is heard on
the board is what the game will play:

- a **loop** is generated a few seconds longer than `seconds`, and that tail is crossfaded over its
  start, so the end runs into the beginning without a seam. The board plays a loop take around its
  seam (its last seconds, then its first) as well as from the start;
- a **stinger** is cut to `seconds` with a short fade-out (ACE-Step makes at least 10 seconds, _to
  confirm_).

A take is cached in `.audio-studio/music-takes/` by a hash of the model, brief, kind, seconds and
seed. The seed is kept to say where a take came from; whether the same seed makes the same take
again on the Mac is for the spike. The board for a track lists its takes: **More takes** generates
four more, **Drop** removes one, **Choose** writes one. The board is kept in
`.audio-studio/music/<track>.json` (a track id is a safe file name). A dropped take is just gone: seeds don't come back, so
nothing is ruled out.

**Choose** levels the take to −20 LUFS as narration is levelled (`level.py`'s commands; RetroQuest
levels its music to −20 today) and encodes it into the clips folder as `<track>.<ext>`, the codec
settled by the spike (MP3 adds a little silence at both ends, so a looping `<audio>` element can
click at the seam; the spike checks whether the game must loop through Web Audio, or whether
another codec loops cleanly in the browsers the game supports). As for narration, the encoder
writes a hidden temporary file in the clips folder, renamed into place together with the manifest
and lock update. Clips are served only as plain files in the music clips folder.

**Manifest** (`manifest.json` in the clips folder, what the game reads): `{ track: { file,
duration } }`, its layout fixed once written. The game decides where a track plays, so the kind is
not in it.

**Lock** (`music.lock.json`, committed, one entry per line): per track, the chosen take's model,
seed, a hash of what went into it (model, brief, kind, seconds; not the output settings, as
narration leaves the loudness out), and when it was chosen. Changing the model in the code marks
every track `changed`, as a new model makes new music. A track is `missing` (nothing chosen,
or its clip is gone from disk), `ok`, or `changed` (its brief, kind or length changed since its
take was chosen: the old one keeps playing in the game until another is chosen). A manifest entry
without a lock entry is reported as a problem. Nothing is generated again by itself: a new brief
means new takes. A track removed from the list leaves its clip as an orphan, removed after
confirmation as narration's are.

**Generator.** `MusicGenerator` (`services/music.ts`) generates one take as a WAV, from the brief,
seconds and seed, so tests run with a fake. The real one is a Python worker (`worker/music.py`,
ACE-Step through uv, the model loaded on the first take and stopped with the studio), the same
JSON-lines protocol as the Whisper worker. Generation and Whisper share the one GPU: ACE-Step and Whisper never run at
once, unless the spike shows both fit and run well side by side. The setup checklist (§10) names ACE-Step's environment and its model
download.

---

## 9. Server API

Built so far: `GET /api/project`, `GET /api/parts/:part` (with every line's status),
`POST /api/parts/:part/adopt`, `GET /api/parts/:part/clips/:file`,
`GET /api/characters/:id/voice` (its cast voice as Fish knows it, its take and the audition
phrase; one lookup, no search), `PATCH /api/characters/:id`
(keywords or phrase), `POST /api/characters/:id/takes` (record a take), `GET /api/takes/:file`
`POST /api/parts/:part/lines/:key/record` (record one line into the clips, manifest and lock;
`{ confirmedCost }` on a paid model, else 409 with the ceiling to confirm),
`GET /api/parts/:part/plan?speaker=&weak=1` (what generating would do, weak lines included if
asked), `POST /api/parts/:part/jobs` (`{ kind: record | measure | check, speaker, keys, orphans,
retakeWeak }`: start a generation, a measuring or a checking again, the server planning it afresh), `GET /api/parts/:part/jobs/latest`, and
`GET`/`DELETE /api/jobs/:id` (progress, cancel).
Takes are cached in `.audio-studio/takes/<key>.mp3`, the key a hash of the audition model, voice,
spoken phrase and settings, so a take is recorded once. Auditions: `GET` and `DELETE
/api/auditions/:id`, and `POST /api/auditions/:id/` `start`, `move` (`{ voice, move: shortlist | unlist | drop }`),
`undo` (the last drop), `more`, `add` and `cast` (`{ voice }`, a shortlisted one); sessions are kept in `.audio-studio/auditions/`. Ruled-out voices:
`GET`/`DELETE /api/characters/:id/ruled-out` (list, forget all) and
`DELETE /api/characters/:id/ruled-out/:voice` (allow one again). The rest is the plan:

```
GET    /api/project                              project, parts
GET    /api/credit                               the Fish account's API credit (dollars)
GET    /api/parts/:part                          the part, every line with its status and reason
GET    /api/parts/:part/clips/:file              a clip from the part's clips folder
GET    /api/parts/:part/lines/:key/heard         what Whisper heard of the line's take, if kept
POST   /api/parts/:part/lines/:key/accept        accept a weak line's clip as it is (lock `accepted`)
POST   /api/parts/:part/lines/:key/check         check a weak line's clip again with Whisper (no new audio)
POST   /api/parts/:part/refresh                  run refreshDialog
POST   /api/parts/:part/adopt                    write lock from existing clips
PATCH  /api/parts/:part/cues/:key                line cue ({ cue }; empty: the style again)
POST   /api/parts/:part/cues/:key/move           an orphaned cue to a line ({ to }; null: remove)
GET    /api/parts/:part/plan?speaker=&weak=1&stage=final   scope → plan (no side effects)
GET    /api/characters                           all characters, with the parts and line counts of each
PATCH  /api/characters/:id                       style, keywords, phrase
PATCH  /api/pronounce                            pronunciation table ({ table, was }: whole)
PATCH  /api/sound-alike                          the project's sound-alike groups ({ groups, was })
GET    /api/characters/:id/voice                 the cast voice from Fish, its take, the phrase
GET    /api/characters/:id/ruled-out             voices ruled out for it, the latest first
DELETE /api/characters/:id/ruled-out             forget them all
DELETE /api/characters/:id/ruled-out/:voice      allow one again
GET    /api/auditions/:id                        the audition in progress, with phrase and takes
DELETE /api/auditions/:id                        stop it without casting
POST   /api/auditions/:id/start                  an audition from a fresh search
POST   /api/auditions/:id/move                   shortlist, unlist or drop a voice
POST   /api/auditions/:id/undo                   undo the last drop
POST   /api/auditions/:id/more                   more candidates to hear
POST   /api/auditions/:id/add                    a voice by its Fish id
POST   /api/auditions/:id/cast                   write a shortlisted voice to cast.json
POST   /api/parts/:part/jobs                     run a plan ({ stage: draft | final }; one job per
                                                 part at a time); a paid
                                                 one with { confirmedCost }, else 409 with
                                                 { reason: confirm | credit | price, ceiling }
GET    /api/parts/:part/jobs/latest              the part's latest job
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
- Missing tools (`ffmpeg`, `uv`) and a missing API key are checked at start and shown as a setup
  checklist. So far: the CLI warns when ffmpeg is missing, and recording says so; the checklist in
  the UI comes later.
- Writes outside the project root throw. Deleting clips (orphans) always needs confirmation.
- Fish errors (no credit, voice removed) mark the line as failed with the reason; the rest of the
  job carries on. Too many requests at once (429: Fish allows 5 at a time until $100 has been
  paid in, 15 until $1,000, then 50; it sends no `Retry-After`) is not an error: the client asks
  again after 1 s, then 2, 4, 8, 16 and 32 s, and only then gives up. `quality.parallel` counts
  lines, and audition takes record beside them, so the limit can be met even below it.
- The studio never runs `git add`, `commit` or `push`.

---

## 11. Testing

- `core/` is covered by `bun test` unit tests: fingerprint stability, planner statuses and reasons,
  spoken-text building, chunking, alignment (ported from `test_narrate.py`), audition state
  transitions.
- `services/` are tested against fakes (a fake `FishClient` and `Transcriber`), plus a few opt-in
  live tests behind an env flag.
- The server API is tested with an in-memory project fixture (a small consumer repo in
  `test/fixtures/`).
- UI: component tests for the audition and line table; one Playwright smoke test over the fixture.

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
         cue is not offered over.
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
8. **Paid models**, in three pull requests:
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
10. **What was heard**, in two pull requests:
    1. **Kept and compared** (built): what Whisper heard of a take below full kept in the cache
       when it is checked; the lines page shows it beside the text, missed words marked.
    2. **Listen again**: a line checked before that has Whisper hear its clip again, from the
       comparison, keeping what it heard.
11. **Music** (§8.5), in small pull requests:
    1. **Spike** (outside the studio's code; the findings written into §8.5 and §13): ACE-Step 1.5
       on the M5 Pro, run from Python through uv. Its models, sizes and licence of the weights;
       time and memory for a 90-second take with the larger and smaller model, also with Whisper
       loaded; quality of instrumental loops and stingers in RetroQuest's style; whether tempo
       and key in the brief come through; whether a take runs on to its end or closes as a song
       does (which the loop's crossfade needs to know); whether the same seed makes the same
       take; whether the crossfaded seam is heard; and how a loop plays without a click in the
       game's browsers (MP3 in `<audio>`, another codec, or Web Audio).
    2. **Track list**: the project file's `music` section and `tracks.json` (schemas, problems with
       file and path), and a Music page listing the tracks, read only.
    3. **Editing tracks**: a track's brief, kind and length edited and saved; tracks added and
       removed.
    4. **Takes**: the ACE-Step worker behind `MusicGenerator` (and in the setup checklist), a take
       generated, shaped and cached per click on a track's page, and played, loops around their
       seam too.
    5. **Board**: a track's takes listed, More takes, Drop; the board saved.
    6. **Choose**: the chosen take levelled, encoded and written with the manifest and lock; each
       track's status on the Music page; the music files in the Changes panel.
    7. **Orphans**: a removed track's clip removed after confirmation.
    8. **RetroQuest** (in the game's repository, not the studio's): the game reads the music
       manifest and plays a track per room or region, and the stingers.

---

## 13. Decisions

1. **Characters are shared by name across parts.** The same name in two parts is one character
   with one voice. Different voices need different names (`narrator-act1`, `narrator-act2`).
   Hence one project-wide `cast.json`.
2. **UI framework: React.**
3. **Models: free only, for now.** The project file already has `audition`, `draft` and `final`
   model stages, but all must be the free model. Paid models, mainly for a final generation step and
   optionally for auditions and drafts, come later (§8.4).
4. **Music is generated locally with ACE-Step 1.5.** No hosted music API has a lasting free tier
   with rights to use the result (ElevenLabs Music's free plan is non-commercial; others give
   signup credits only). Of the open models, MusicGen's weights are non-commercial (CC-BY-NC) and
   Stable Audio Open is limited to 47 seconds and stronger at effects than at melody; ACE-Step's
   code is MIT-licensed (its weights' licence _to confirm_), makes full instrumental tracks, and
   runs on Apple Silicon. Tracks are chosen from takes, since every generation differs.
