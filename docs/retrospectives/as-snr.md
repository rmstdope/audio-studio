# as-snr — retrospective

## A CSS-only head went red in CI on two timing-sensitive tests

**What happened:** The second head of PR #302 added one CSS line and went red in CI. Two tests it
doesn't touch failed: `ffmpegSceneAudio > makes a second sound louder, and a level above 1 raises a
clip` (`src/services/sceneAudio.test.ts`) hit its 5 s timeout, and `createLineWorker > says what it
was told to, not its log, when the system kills it` got `EPIPE: broken pipe, write` instead of `The
system stopped it.` The first head had run green, and a bare re-run of the failed head passed.
Locally, under a load of 15–18, the ffmpeg test also failed alone and in the full gate, with a
different set of ffmpeg tests failing on each full run. Main's CI on bbd1c04 also failed.

**Why:** Not established. The ffmpeg test runs real ffmpeg under the default 5 s bun timeout, which
a loaded runner can exceed. The EPIPE looks like a race between the worker being killed and a
write to its stdin.

**Cost:** One of the bead's two bare re-runs, about 3 minutes of CI, and a local gate that couldn't
be read as green.

**Prevent by:** A testing bead for `src/services/sceneAudio.test.ts` (a timeout sized for real
ffmpeg, or the slow cases opt-in like the other live tests) and for the `createLineWorker`
kill-path test (it should accept or prevent the EPIPE race), filed by QA from this file.

**Seen before:** Not in `docs/retrospectives/` (grep for `sceneAudio`, `EPIPE`, `createLineWorker`).
