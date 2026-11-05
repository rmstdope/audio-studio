# Content Studio's files

This is the reference for the files Content Studio reads and writes in a game's repository: what
each one is for, who writes it, and every field it holds. It is written for the people who set a
game up for the studio and for the game's own code that reads what the studio makes.

The examples are the studio's sample project (`test/fixtures/sample`), a tiny game with three acts
in English, Swedish and German.

> **Status.** This is version 2 of the format, which the studio is moving to one section at a time
> (epic as-6u9). Until a section has moved, the studio reads that section's files as
> `docs/architecture.md` §5 and §6 describe them, and this document is the plan for it.

## The four kinds of file

Every file belongs to one of four kinds, and the format follows that split:

| Kind                    | Written by     | Read by    | Where                                |
| ----------------------- | -------------- | ---------- | ------------------------------------ |
| **The project file**    | you, and Setup | the studio | `content-studio.json`                |
| **The game's lists**    | the game       | the studio | wherever the game keeps them         |
| **The studio's own**    | the studio     | the studio | the studio folder, `content-studio/` |
| **What the game plays** | the studio     | the game   | wherever the game wants them         |

- **The game's lists** say what there is to make: the lines of dialog, the music tracks, the
  images, the sound effects and the scenes. The game writes them, usually with an extractor that
  its project file names under `refresh`, and the studio never changes them.
- **The studio's own files** hold what a person decided in the studio (_edits_) and what was made
  from what (_locks_). They live in one folder with a fixed layout, and are committed with the game.
  Only the cache in it is not.
- **What the game plays** is the clips, each folder's manifest, and the scenes' mixes. Their paths
  are the game's choice, so the project file names them.

The project file names the game's paths only. Everything the studio owns is found by convention
inside the studio folder, so every game's studio folder looks the same.

## Words used throughout

- A **part** is a chapter of the game: RetroQuest calls them acts. Path templates use `{part}` for
  the part's id.
- A **language** is one the game is narrated in, by its code (`en`, `sv`). The first one listed is
  the **source language**; the others are translations of it. Narration paths use `{language}`.
- An **item** is one thing in a game's list: a line, a track, an image, an effect or a scene. Every
  item has an `id`, unique in its kind, that names it in every file.
- A **take** is one attempt at making an item. The take the game plays is the _chosen_ one.

## The project file: `content-studio.json`

The file in the game's root that tells the studio where everything is. The studio finds it by
walking up from the folder it is started in.

```json
{
  "$schema": "https://raw.githubusercontent.com/rmstdope/audio-studio/main/schema/content-studio.schema.json",
  "version": 2,
  "name": "Sample Quest",
  "description": "A tiny project for working on the studio.",
  "env": ".env",
  "studio": "content-studio",
  "partLabel": "Act",
  "parts": [
    { "id": "act1", "title": "Act I: The Lantern" },
    { "id": "act2", "title": "Act II: The Road" },
    { "id": "act3", "title": "Act III: The Crown" }
  ],
  "languages": ["en", "sv", "de"],
  "refresh": {
    "part": "sh tools/refresh.sh {part}",
    "shared": "sh tools/refresh-stingers.sh"
  },
  "narration": {
    "from": { "part": "tts/{part}/{language}/script.json" },
    "models": {
      "fish": { "audition": "s2.1-pro-free", "draft": "s2.1-pro-free", "final": "s2.1-pro-free" },
      "elevenlabs": { "audition": "eleven_v3", "draft": "eleven_v3", "final": "eleven_v3" }
    },
    "output": { "codec": "mp3", "bitrate": "64k", "channels": 1, "lufs": -16 },
    "generate": {
      "fish": { "temperature": 0.7, "topP": 0.7, "speed": 1 },
      "elevenlabs": { "stability": 0.5, "similarityBoost": 0.75, "style": 0 },
      "minHeard": 0.9,
      "takes": 3,
      "chunkLimit": 400,
      "parallel": 4,
      "transcriber": "mlx-whisper",
      "whisperModel": "mlx-community/whisper-large-v3-turbo",
      "soundAlike": { "en": [["Lyria", "Liria"]] },
      "sceneCueSpeakers": ["narrator"]
    },
    "audition": {
      "phrase": {
        "en": "Come in out of the rain, child. Sit by the fire, and I will tell you how it all began."
      },
      "candidatesPerRound": 5
    },
    "clips": "audio/narration/{part}/{language}",
    "manifest": "audio/narration/{part}/{language}/manifest.json"
  },
  "music": {
    "from": { "part": "tts/{part}/music.json", "shared": "tts/stingers.json" },
    "model": "balanced",
    "clips": "audio/music",
    "manifest": "audio/music/manifest.json"
  },
  "images": {
    "from": { "part": "tts/{part}/images.json" },
    "model": "klein",
    "clips": "web/public/images/generated",
    "manifest": "web/public/images/generated/manifest.json"
  },
  "effects": {
    "from": { "shared": "tts/effects.json" },
    "model": "small-sfx",
    "clips": "audio/effects",
    "manifest": "audio/effects/manifest.json"
  },
  "scenes": {
    "from": { "part": "tts/{part}/scenes.json" },
    "output": { "lufs": -20, "tolerance": 2 },
    "mix": "web/scenes/{part}.mix.json"
  }
}
```

### The top level

| Field                                               | What it is                                                                                   | Default            |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------ |
| `$schema`                                           | The JSON Schema of this file, so an editor completes fields and flags mistakes.              | none               |
| `version`                                           | The format's version. This document describes `2`. The studio refuses any other, or none.    | required           |
| `name`                                              | The game's name, shown in the studio.                                                        | required           |
| `description`                                       | What the game is, in a sentence or two. Shown on Setup.                                      | `""`               |
| `env`                                               | The file holding the API keys (`FISH_AUDIO_API_KEY`, `ELEVENLABS_API_KEY`). Never committed. | `".env"`           |
| `studio`                                            | The studio folder, relative to the root.                                                     | `"content-studio"` |
| `partLabel`                                         | What the game calls a part, in the studio's words ("Act", "Chapter").                        | `"Part"`           |
| `parts`                                             | The parts in play order: `{ id, title }` each. The id is letters, digits, `-` and `_`.       | required           |
| `languages`                                         | The languages the game is narrated in. The first is the source language.                     | `["en"]`           |
| `refresh`                                           | The game's commands that write its lists (below).                                            | none               |
| `narration`, `music`, `images`, `effects`, `scenes` | The sections, one per kind of content. Each is optional.                                     | none               |

`refresh.part` writes one part's lists; `{part}` in it is replaced by the part's id. `refresh.shared`
writes the lists that belong to no part. The studio runs one of them, in the project root, only
when you press **Refresh** on a page that shows a list it writes, and never otherwise.

### The sections

Every section has the same skeleton. A field a kind of content has no use for is simply absent.

| Field              | What it is                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `from`             | The game's lists: `part`, a path with `{part}` for a list per part; `shared`, a path for one list for the whole game. Either or both. |
| `models` / `model` | The models takes are made with. Narration has a model per provider and stage; the other kinds have one.                               |
| `output`           | What the made file must be: format, loudness, size.                                                                                   |
| `generate`         | How takes are made and checked.                                                                                                       |
| `clips`            | The folder the chosen takes are written to, for the game to play.                                                                     |
| `manifest`         | The manifest in that folder, which the game reads.                                                                                    |

Paths are relative to the project root and may not leave it. A path that differs per part contains
`{part}`; with more than one language, every narration path contains `{language}`. Music, images,
effects and scenes are the same in every language, so their paths never do.

### `narration`

| Field                                            | What it is                                                                                                                                                                                            | Default                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `from.part`                                      | Each part's dialog, per language.                                                                                                                                                                     | required                               |
| `models.fish.audition` / `draft` / `final`       | The Fish model of each stage. Any whose price the studio knows.                                                                                                                                       | `s2.1-pro-free`                        |
| `models.elevenlabs.audition` / `draft` / `final` | The ElevenLabs model of each stage, for characters cast with an ElevenLabs voice.                                                                                                                     | `eleven_v3`                            |
| `output.codec`                                   | `mp3`.                                                                                                                                                                                                | `mp3`                                  |
| `output.bitrate`                                 | The MP3 bitrate.                                                                                                                                                                                      | `64k`                                  |
| `output.channels`                                | `1` or `2`.                                                                                                                                                                                           | `1`                                    |
| `output.lufs`                                    | The loudness each clip is levelled to, in integrated LUFS; `null` leaves it as made.                                                                                                                  | `null`                                 |
| `generate.fish`                                  | Fish's voice settings: `temperature` and `topP` (0 to 1), `speed` (0.5 to 2).                                                                                                                         | 0.7, 0.7, 1                            |
| `generate.elevenlabs`                            | ElevenLabs' voice settings: `stability` (0, 0.5 or 1), `similarityBoost` and `style` (0 to 1).                                                                                                        | 0.5, 0.75, 0                           |
| `generate.minHeard`                              | The share of a line's words Whisper must hear for a take to pass.                                                                                                                                     | `0.9`                                  |
| `generate.takes`                                 | How many takes of a line are tried before the best is kept.                                                                                                                                           | `3`                                    |
| `generate.chunkLimit`                            | The longest piece sent in one request, in characters; 100 or more.                                                                                                                                    | `400`                                  |
| `generate.parallel`                              | How many requests run at once.                                                                                                                                                                        | `4`                                    |
| `generate.transcriber`                           | `mlx-whisper` checks each take; `none` makes one unchecked take.                                                                                                                                      | `mlx-whisper`                          |
| `generate.whisperModel`                          | The Whisper model.                                                                                                                                                                                    | `mlx-community/whisper-large-v3-turbo` |
| `generate.soundAlike`                            | The game's own words that sound the same, by language: groups of two or more words or phrases. Whisper writing one for another still counts as heard. Saved from the Words that sound the same panel. | `{}`                                   |
| `generate.sceneCueSpeakers`                      | The speakers whose lines follow their scene's cue.                                                                                                                                                    | `["narrator"]`                         |
| `audition.phrase`                                | The standard audition phrase, by language. A language without one borrows a character's longest line. Each must fit in one piece (`chunkLimit`).                                                      | the English phrase above               |
| `audition.candidatesPerRound`                    | How many voices an audition round brings in.                                                                                                                                                          | `5`                                    |
| `clips`                                          | The folder of a part's clips, per language.                                                                                                                                                           | required                               |
| `manifest`                                       | That folder's manifest.                                                                                                                                                                               | required                               |

### `music`

| Field               | What it is                                                                                                            | Default    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------- |
| `from.part`         | Each part's loops.                                                                                                    | none       |
| `from.shared`       | The stingers: short pieces for the whole game, at most 10 seconds each.                                               | none       |
| `model`             | The music model takes are made with (`balanced`, `quick`, `quickest`, `careful`, …); a take can be made with another. | `balanced` |
| `clips`, `manifest` | Where the chosen takes go.                                                                                            | required   |

### `images`

| Field               | What it is                                                                                          | Default  |
| ------------------- | --------------------------------------------------------------------------------------------------- | -------- |
| `from.part`         | Each part's images. An image several parts list is one image.                                       | required |
| `model`             | The image model takes are made with: `klein` or `z-image-turbo`; a take can be made with the other. | `klein`  |
| `clips`, `manifest` | Where the chosen pictures go, one `<id>.png` each.                                                  | required |

The look every image shares is the studio's own, in the images edits (below).

### `effects`

| Field               | What it is                                                                                         | Default     |
| ------------------- | -------------------------------------------------------------------------------------------------- | ----------- |
| `from.shared`       | The game's one list of sound effects.                                                              | required    |
| `model`             | The effects model takes are made with: `small-sfx` or `open-1`; a take can be made with the other. | `small-sfx` |
| `clips`, `manifest` | Where the chosen takes go.                                                                         | required    |

### `scenes`

| Field              | What it is                                                                                       | Default  |
| ------------------ | ------------------------------------------------------------------------------------------------ | -------- |
| `from.part`        | Each part's scenes, with their states and triggers.                                              | required |
| `output.lufs`      | The loudness a scene should sit at, in integrated LUFS. Without it nothing is flagged.           | none     |
| `output.tolerance` | How far a scene may be off it, in dB.                                                            | none     |
| `mix`              | Each part's mix: what plays in each scene and how loud. Written by the studio, read by the game. | required |

## The game's lists

Every list is a JSON array of items, in the game's order. All lists share three fields:

| Field   | What it is                                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`    | The item's id, unique in its kind. It names the item's clip, so it is a safe file name: lower-case letters, digits and `-` (a line's id may also hold upper case and `_`). |
| `title` | What the studio calls the item. Optional where the id says enough (lines, effects).                                                                                        |
| `text`  | The game's own words the item is made from: what a line says, what a track, image or effect is.                                                                            |

Fields only one kind has sit beside them. A list that is there and empty means the game asks for
none; a list that is missing means the game has not written it yet.

**A line** (`narration.from.part`):

```json
[
  {
    "id": "a1-001",
    "speaker": "narrator",
    "text": "The lantern still burns.",
    "scene": "lantern-hall"
  }
]
```

`speaker` names the character as the cast does. `scene` is the scene the line belongs to, if any.
Between languages, lines are matched by `id`.

**A track** (`music.from.part`, `music.from.shared`):

```json
[
  {
    "id": "village-lane",
    "title": "Village lane",
    "text": "gentle recorder and fiddle, a walk in the morning, unhurried and bright",
    "seconds": 90,
    "bpm": 84,
    "key": "D major",
    "plays": "The lane through the village",
    "file": "audio/game-music/village-lane.wav"
  }
]
```

`seconds` is how long a take is. `bpm` and `key` are optional. `plays` says where the game plays it.
`file` is the music the game plays now, when it is not one the studio made.

**An image** (`images.from.part`):

```json
[
  {
    "id": "silver-stag-inn",
    "title": "The Silver Stag Inn",
    "text": "A low timber inn at dusk, lantern light in every window, a silver stag on the sign.",
    "width": 320,
    "height": 200
  }
]
```

`width` and `height` are the picture the game shows, in pixels. `file` is optional, as for tracks.

**A sound effect** (`effects.from.shared`):

```json
[
  {
    "id": "rain",
    "title": "Rain",
    "text": "Steady rain on a tin roof",
    "seconds": 8,
    "loops": true
  }
]
```

`seconds` is its length. `loops` is true for an effect that plays round and round; absent, it plays
once.

**A scene** (`scenes.from.part`):

```json
[
  {
    "id": "lantern-hall",
    "title": "Lantern hall",
    "states": ["plain", "rainy"],
    "triggers": ["door-opens"]
  }
]
```

`states` are the scene's states, the first being the default; `triggers` the moments the game can
fire. Both are lists of ids.

## The studio folder: `content-studio/`

Everything the studio owns, in a layout that is the same in every game:

```
content-studio/
  .gitignore              written by the studio: keeps cache/ out of git
  narration/
    cast.json             the characters and pronunciations
    act1.edits.json       a part's cues, in the source language
    act1.sv.edits.json    … and in another language
    act1.lock.json        what each of a part's clips was made from
    act1.sv.lock.json
  music/
    edits.json            the studio's changes to the tracks
    lock.json             the chosen take of each track
  images/
    edits.json            the look, and the studio's changes to the images
    lock.json             the chosen take of each image
  effects/
    edits.json            the studio's changes to the effects
    lock.json             the chosen take of each effect
  scenes/
    act1.lock.json        each scene's measured loudness
  cache/                  not committed
```

A file of a language besides the source has the language's code before `.edits` or `.lock`; the
source language's has none, so adding a language never renames a file. There is one lock beside
each manifest or mix the game reads: per part (and language) for narration and scenes, one for the
whole game for music, images and effects.

### Edits

What a person decided. An edit never repeats what the game's list already says: it holds only what
differs, by item id.

**A rewording** is the studio's own words for an item, over the game's, kept with the game's words
it was written over:

```json
{ "text": "Rain hammering on a tin roof, heavy and close", "gameWas": "Steady rain on a tin roof" }
```

When the game's words change, `gameWas` no longer matches, and the studio shows both so you can
keep yours or take the game's. Every kind's rewording has this shape.

**`narration/cast.json`**: every character, keyed by the name the dialog's `speaker` uses, and how
words are said.

```json
{
  "characters": {
    "narrator": {
      "voice": "7d805071401d4b738334f332a8c320c2",
      "voiceName": "Old man bible storytelling",
      "style": "[warm, gentle storyteller]",
      "speed": 0.9,
      "audition": { "keywords": ["old", "male", "warm"], "phrase": "Sit by the fire." },
      "languages": {
        "sv": {
          "voice": "e48a…",
          "voiceName": "Berättaren",
          "speed": 1,
          "phrase": "Sitt vid elden."
        }
      }
    }
  },
  "pronounce": {
    "en": { "Act I:": "Act One:", "Lyria": "LEER-ee-a" }
  }
}
```

| Field               | What it is                                                                             |
| ------------------- | -------------------------------------------------------------------------------------- |
| `voice`             | The voice's id at its provider; absent while uncast.                                   |
| `voiceName`         | The voice's name, shown in the studio.                                                 |
| `style`             | How the character speaks, as a cue: what each line gets unless it has its own.         |
| `speed`             | The character's own speaking speed (0.5 to 2), in place of the project's.              |
| `audition.keywords` | What a voice search for the character looks for.                                       |
| `audition.phrase`   | The character's own audition phrase, in place of the project's.                        |
| `languages`         | The casting in a language besides the source: `voice`, `voiceName`, `speed`, `phrase`. |
| `pronounce`         | By language: written words → how they are spoken, applied in the order listed.         |

A character is the same in every part. To give one a different voice in a part, the game names the
speaker differently (`narrator-act2`).

**`narration/<part>.edits.json`**: a part's cues.

```json
{
  "cues": {
    "a1-001": "[hushed, the words almost breathed]",
    "a1-007": "[ashamed] I did it. [resolute] I will fix it."
  },
  "scenes": {
    "lantern-hall": "[slow, like opening an old storybook]"
  }
}
```

`cues` replaces the character's style for one line, by line id: a cue alone, or the line's words
with cues placed between them. `scenes` gives a scene's lines a cue, for the speakers in
`generate.sceneCueSpeakers`; a line's own cue wins. In a language besides the source, a line
follows the source language's cue until its own file gives it one.

**`music/edits.json`**: the studio's changes to tracks, by track id.

```json
{
  "village-lane": {
    "text": "recorder and fiddle, a bright morning walk",
    "gameWas": "gentle recorder and fiddle, a walk in the morning, unhurried and bright",
    "seconds": 60,
    "bpm": 90,
    "key": "G major"
  }
}
```

Each field is optional: `text` and `gameWas` together, `seconds`, `bpm` (30 to 300, `null` for none),
and `key` (`null` for none).

**`images/edits.json`**: the look of every image, and the studio's changes to images.

```json
{
  "style": {
    "look": "Flat 16-colour pixel art, hard edges, a limited warm palette.",
    "keepOut": "text, letters, modern objects, gradients",
    "palette": ["#0d0d1a", "#1f1f3d"],
    "colourDepth": "16-bit",
    "dithering": "patterned",
    "parts": { "act1": "Warm late-day light" }
  },
  "images": {
    "cellar-door": {
      "text": "A heavy iron-banded door at the foot of a worn stair.",
      "gameWas": "A heavy iron-banded door at the foot of a stair.",
      "partStyle": "act2"
    }
  }
}
```

| Field                         | What it is                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `style.look`                  | What every image looks like.                                                                               |
| `style.keepOut`               | What no image may hold.                                                                                    |
| `style.palette`               | The only colours a picture may use, as `#rrggbb`; empty for any.                                           |
| `style.colourDepth`           | `full`, `16-bit` or `8-bit`, when no palette is listed.                                                    |
| `style.dithering`             | `flat`, `patterned` or `scattered`: how in-between shades are made when colours are reduced.               |
| `style.parts`                 | A part's addition to the look, by part id.                                                                 |
| `images.<id>.text`, `gameWas` | A rewording.                                                                                               |
| `images.<id>.partStyle`       | Which part's addition the image uses: a part id, or `null` for none. Absent: the first part that lists it. |

**`effects/edits.json`**: the studio's changes to effects, by effect id: a rewording.

```json
{ "rain": { "text": "Rain hammering on a tin roof", "gameWas": "Steady rain on a tin roof" } }
```

### Locks

What each chosen take was made from, so the studio can say when an item has changed since. Every
lock is an object keyed by item id, written one entry per line in id order, so choosing a take is a
one-line change in a diff:

```json
{
  "rain": {
    "fp": "8c67d33efba8d9af",
    "model": "small-sfx",
    "seed": 29507973,
    "take": 2,
    "inputs": { "text": "Steady rain on a tin roof", "seconds": 8, "loops": true },
    "at": "2026-11-04T09:56:41.790Z"
  },
  "wind-howl": {
    "fp": "b6b1e1b80690ed14",
    "model": "small-sfx",
    "seed": 2067760593,
    "take": 1,
    "inputs": { "text": "Wind howls through a stone gap", "seconds": 10 },
    "at": "2026-11-04T10:05:31.480Z"
  }
}
```

Every entry has the same fields:

| Field    | What it is                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------ |
| `fp`     | A fingerprint of everything the take was made from.                                              |
| `model`  | The model that made it.                                                                          |
| `seed`   | The seed it was made from, where the model takes one.                                            |
| `take`   | Its number among the item's takes.                                                               |
| `inputs` | What it was made from, in the clear. Accepting a change since (Accept) puts the new values here. |
| `at`     | When it was made or chosen.                                                                      |

What `inputs` holds is each kind's own:

- **Music**: `text`, `kind` (`loop` or `stinger`), `seconds`, `bpm`, `key`.
- **Images**: `text`, `width`, `height`, `style` (`{ look, keepOut, part }`, the words the take was
  made with) and `look` (`{ palette, colourDepth, dithering }`, what the picture was brought to).
- **Effects**: `text`, `seconds`, `loops`.
- **Narration** keeps short hashes, not the words, which would copy the whole script into the lock:
  `hashes: { cue, text, said, settings }` in place of `inputs`, with the `voice`. It also records
  `heard` (the share of the words Whisper heard), `takes` (how many were tried), `accepted` (true
  when a weak clip was accepted as it is) and `adopted` (true for a clip made before the studio).
- **Scenes** record the loudness each scene was measured at: `measuredAt`, the mix `entry`
  measured, the `clips` each sound came from, `states` (`{ state, lufs }` each), what was left
  `without`, an `error` when it could not be measured, and `moved` after a suggested change; under
  `saved` for the mix as saved and `draft` for unsaved changes.

### The cache

`cache/` holds the studio's working state on this machine: audition takes and sessions in progress,
the voices ruled out, every take not chosen, notes on lines, what Whisper heard, and your own
settings (`cache/settings.json`: how much you have paid Fish, which sets how many requests it takes
at once, and how long takes fade when played in the studio). None of it is the game's. Deleting the
cache loses unfinished work and these settings, never what the game plays. Its layout is the
studio's own and may change.

## What the game plays

The studio writes the chosen takes into the folders the project file names, with a manifest beside
them, and writes nothing else there. The game reads the manifests, keyed by item id:

| Manifest  | An entry                                                                       |
| --------- | ------------------------------------------------------------------------------ |
| Narration | `{ file, speaker, duration, words: [{ word, start, end }] }`, times in seconds |
| Music     | `{ file, duration }`                                                           |
| Images    | `{ file, width, height }`                                                      |
| Effects   | `{ file, duration }`                                                           |

**A part's mix** (`scenes.mix`) says what plays in each of a part's scenes, by scene id:

```json
{
  "scenes": {
    "lantern-hall": {
      "music": { "track": "lantern-hall", "level": 0.8 },
      "effects": [
        { "id": "rain", "play": { "mode": "loop" }, "state": "rainy", "level": 0.6 },
        { "id": "door-creak", "play": { "mode": "trigger", "trigger": "door-opens" }, "level": 1 }
      ]
    }
  }
}
```

`music.track` is a track id, or `null` for silence; absent, the scene plays the track with its own
id at level 1. A `level` is 0 to 3, 1 being the clip as made. An effect's `play` is one of
`{ "mode": "loop" }`, `{ "mode": "random", "everySeconds": [min, max] }`,
`{ "mode": "once", "afterSeconds": n }` or `{ "mode": "trigger", "trigger": id }`; `state` limits it
to one of the scene's states.

## How the studio writes

- Every file is written whole, through a temporary file and a rename, so a crash never leaves half
  of one.
- Keys are written in a stable order and the layout a file already has is kept, so a change is a
  small diff. Locks are one entry per line.
- The studio writes only the files above, inside the project root. It never runs git, and it runs
  the game's commands only from a **Refresh** you press.
- It never deletes a clip without asking you first.
