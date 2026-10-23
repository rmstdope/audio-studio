# audio-studio

Audio tool for narratives and music used in games. Run it from inside a game repository: it reads
the repository's `audio-studio.json`, and writes voice files and their metadata in place. Committing
them is up to you.

See [docs/architecture.md](docs/architecture.md) for the design.

## Status

Steps 1, 2, 3.1 and 3.2 of the delivery plan (`docs/architecture.md` §12): the studio validates
the project, shows each part's characters and the state of every line's clip, adopts clips
recorded before it, searches Fish Audio's library for voices for a character by keywords, and
records each candidate saying the audition phrase in the character's style. Rounds, casting and
generation come next.

Audition takes are cached in `.audio-studio/` in the game repository; add it to that repository's
`.gitignore`.

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
