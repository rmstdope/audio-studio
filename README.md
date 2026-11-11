# Content Studio

Narration, music, images, sound effects and scenes for games. Run it from inside a game
repository: it reads the repository's `content-studio.json` and writes the game's files in place.
Committing them is up to you; the studio never commits.

- [docs/architecture.md](docs/architecture.md) is the design.
- [docs/project-files.md](docs/project-files.md) describes the files the studio reads and writes in
  a game.

## What it does

- **Narration.** Casts a voice for each character by audition: from Fish Audio's or ElevenLabs'
  library, your own voices, a cloned voice or a designed one. Then it records every line of dialog
  with the cast voice, in each language the game declares. Each take is checked with Whisper and
  made again until enough of its words are heard, and the manifest gets real word timings. Only
  what is missing or out of date is recorded again. Paid models are held to a spending ceiling
  you set, and what they cost is logged.
- **Music.** Loops and stingers made locally with ACE-Step or Stable Audio Open, or with Eleven
  Music. You choose between takes, then trim and fade them.
- **Images.** Each image the game lists is made locally with FLUX.2 klein, Z-Image-Turbo or
  Qwen-Image through mflux, in the act's style. Patches paint a change into a chosen picture, and
  named areas are marked for the game.
- **Sound effects.** One-shots and loops made locally with Stable Audio, chosen from takes.
- **Scenes.** How each scene's music, effects and narration sound together, with loudness
  measured against the project's target.
- **Changes** lists what git sees of the studio's files, so you know what to commit. **Refresh**
  runs the game's own command to rewrite its lists from the game's code.

**Setup**, in the studio, checks every tool and key a model needs and says how to install what is
missing. In short:

- [ffmpeg](https://ffmpeg.org) (`brew install ffmpeg`)
- [uv](https://docs.astral.sh/uv/) and an Apple silicon Mac for the local models (Whisper, music,
  images, sound effects)
- `FISH_AUDIO_API_KEY` and, to use ElevenLabs, `ELEVENLABS_API_KEY`, in the environment or in the
  project's env file (`.env` unless the project file names another)

The studio keeps its own files in `content-studio/` beside the project file. Its working state on
your machine (takes, your Fish tier and take fade, the spend log) is in `content-studio/cache/`,
which `content-studio/.gitignore` keeps out of git. The studio writes that `.gitignore` when it
starts.

## Install

Needs [Bun](https://bun.sh) 1.4 or later.

```sh
bun install
bun link          # puts `content-studio` in ~/.bun/bin
```

`~/.bun/bin` must be on your `PATH`. Bun's own installer adds it; a Homebrew-installed Bun does
not, so add it to `~/.zshrc` yourself:

```sh
export PATH="$HOME/.bun/bin:$PATH"
```

There is no need to run `bun link content-studio` in the game repository: the studio is not a
dependency of the game.

## Use

```sh
cd ~/repos/retroquest   # any repository with a content-studio.json
content-studio          # opens the studio in your browser
```

Options: `--project <file>` to use a specific project file, `--port <n>`, `--no-open`, `--dev`,
`-h`/`--help`.

## Develop

`content-studio --dev` reloads on every change to the studio's own code. Server changes are picked
up in place (same port, no restart), and UI changes are pushed to the open page. Use it in a game
repository while working on the studio.

```sh
bun run dev          # the studio on test/fixtures/sample, with reloading
bun test
bun run typecheck
bun run format       # prettier
bun run check        # format:check, typecheck and tests, as CI runs them
bun run schema       # writes schema/content-studio.schema.json from the project file's schema
```

Live tests that call real models or services are opt-in: see §11 of the architecture.
