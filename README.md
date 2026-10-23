# audio-studio

Audio tool for narratives and music used in games. Run it from inside a game repository: it reads
the repository's `audio-studio.json`, and writes voice files and their metadata in place. Committing
them is up to you.

See [docs/architecture.md](docs/architecture.md) for the design.

## Status

Steps 1 to 3 of the delivery plan (`docs/architecture.md` §12): the studio validates the project,
shows each part's characters and the state of every line's clip, adopts clips recorded before it,
and casts voices by audition: it searches Fish Audio's library by keywords, records each candidate
saying the audition phrase in the character's style, and runs keep/drop rounds until one voice is
left, which it writes to the cast. It records narration: line by line, or a whole part (or one
character) as a job with a plan, progress and Cancel, removing orphaned clips when asked (step 4).
Each take is checked with Whisper, and recorded again (up to three times) until enough of its
words are heard; the manifest gets real word timings. A line never heard well enough shows as weak; retake it from its row or from Generate. Clips
recorded before the studio (or unchecked) can be measured with Whisper without new audio.

Recording needs [ffmpeg](https://ffmpeg.org) to encode clips (`brew install ffmpeg`), and checking
takes needs [uv](https://docs.astral.sh/uv/) on Apple silicon (mlx-whisper; the first take loads
the model). Without them, set `"quality": { "transcriber": "none" }` in the project file.

Audition takes and sessions are kept in `.audio-studio/` in the game repository; add it to that
repository's `.gitignore`.

## Install

Needs [Bun](https://bun.sh) 1.4 or later.

```sh
bun install
bun link          # puts `audio-studio` in ~/.bun/bin
```

`~/.bun/bin` must be on your `PATH`. Bun's own installer adds it; a Homebrew-installed Bun does
not, so add it to `~/.zshrc` yourself:

```sh
export PATH="$HOME/.bun/bin:$PATH"
```

There is no need to run `bun link audio-studio` in the game repository: the studio is not a
dependency of the game.

## Use

```sh
cd ~/repos/retroquest   # any repository with an audio-studio.json
audio-studio            # opens the studio in your browser
```

Options: `--project <file>` to use a specific project file, `--port <n>`, `--no-open`, `--help`.

## Develop

`audio-studio --dev` reloads on every change to the studio's own code: server changes are picked
up in place (same port, no restart) and UI changes are pushed to the open page. Use it in a game
repository while working on the studio.

```sh
bun run dev          # the studio on test/fixtures/sample, with reloading
bun test
bun run typecheck
bun run format       # prettier
bun run check        # format:check, typecheck and tests, as CI runs them
```
