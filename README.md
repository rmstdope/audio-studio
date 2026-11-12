# Content Studio

Narration, music and images for games. Run it from inside a game repository: it reads
the repository's `content-studio.json`, and writes voice files and their metadata in place. Committing
them is up to you.

See [docs/architecture.md](docs/architecture.md) for the design. The files the studio reads and writes in a
game are described in [docs/project-files.md](docs/project-files.md).

## Status

The studio validates the project, shows each part's characters and the state of every line's clip, adopts clips recorded before it,
and casts voices by audition: it searches Fish Audio's library by keywords, records each candidate
saying the audition phrase in the character's style, and runs keep/drop rounds until one voice is
left, which it writes to the cast. It records narration: line by line, or a whole part (or one
character) as a job with a plan, progress and Cancel, removing orphaned clips when asked.
Each take is checked with Whisper, and recorded again (up to three times) until enough of its
words are heard; the manifest gets real word timings. A line never heard well enough shows as
weak: retake it from its row, or from Generate when asked. Clips recorded before the studio (or
unchecked) can be measured with Whisper without new audio. A character's style is edited on its
audition page, a line's own cue by clicking it in the lines table, and the pronunciation table on
All characters. **Changes** lists what git sees of the studio's files, so
you know what to commit; the studio itself never commits. **Refresh dialog** runs the
project's `refresh.part` command for a part and shows what changed; cues left without a line are
listed on the part's overview, to give to the reworded line or remove.

Recording needs [ffmpeg](https://ffmpeg.org) to encode clips (`brew install ffmpeg`; with
`"output": { "lufs": -16 }` each clip is also levelled to that loudness, as RetroQuest's `level.py`
does), and checking
takes needs [uv](https://docs.astral.sh/uv/) on Apple silicon (mlx-whisper; the first take loads
the model). Without them, set `"generate": { "transcriber": "none" }` in the project file's `narration` section.

The studio keeps its own files in `content-studio/` beside the project file. Its working state on
your machine (audition takes and sessions, your Fish tier and take fade) is in
`content-studio/cache/`, which the studio keeps out of git with `content-studio/.gitignore`, written
when it starts. The project file's format, version 2, is described in
[docs/project-files.md](docs/project-files.md).

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

Options: `--project <file>` to use a specific project file, `--port <n>`, `--no-open`, `--help`.

## Develop

`content-studio --dev` reloads on every change to the studio's own code: server changes are picked
up in place (same port, no restart) and UI changes are pushed to the open page. Use it in a game
repository while working on the studio.

```sh
bun run dev          # the studio on test/fixtures/sample, with reloading
bun test
bun run typecheck
bun run format       # prettier
bun run check        # format:check, typecheck and tests, as CI runs them
```
