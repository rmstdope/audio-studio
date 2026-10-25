# Paid Fish Audio account: what is not built yet

What the studio already does for a paid account: it prices every current model (`core/prices.ts`),
shows the account's API credit, asks for a spending ceiling before a paid recording and holds it
to that budget (`core/spend.ts`), offers a final recording with the final model (§8.4 of
`architecture.md`), and asks Fish again after a 429 (§10).

The items below are not built. Each is small enough for one pull request, unless it says
otherwise. Facts about Fish come from its docs as checked on 2026-10-25; check them again before
building. Read `architecture.md` and `CLAUDE.md` first.

## Paid auditions

Takes are always recorded with the free model: `models.audition` accepts only `s2.1-pro-free`
(`auditionModel` in `core/project.ts`). Hearing candidates on the model you will ship with needs a
priced audition stage. Takes record by themselves today, which is fine only because they are
free: a paid audition model must ask to confirm the cost first (§8.1 says "a paid audition model
will ask first"), and the take cache key already includes the model, so takes on two models do not
mix.

## The `s1` retirement

Fish retires `s1` on 31 December 2026; after that, requests for it are served and billed as
`s2.1-pro` at the same price. `core/prices.ts` lists `s1` with no end date. The studio should warn
when the project file names `s1` for `draft` or `final`, and offer to switch it. The project file
is changed in one place only today (`narration.quality.soundAlike`, see `CLAUDE.md`), so changing
`models` there is a new rule for the consumer repository and needs agreeing first.

## Your own voices in casting

Search covers Fish's public library only (`listVoices` in `services/fish.ts`). Voices on your own
account, cloned or kept private, are not offered. Fish lists them with `GET /model?self=true`; on
2026-10-25 the account behind RetroQuest's key had none. They should appear on the audition board,
marked as your own, and be castable like any other.

## Voice cloning

Creating a private voice from 10 to 30 seconds of clean audio: `POST /model` with
`multipart/form-data`, fields `type=tts`, `title`, `visibility=private`, `train_mode=fast` and the
audio as `voices`. Fish's pricing page lists no price for it. It belongs on the character page as a
third way to find a voice, beside search and bringing in a voice by id. Not verified: whether
speech with a private voice works on the free model. Test that with a real key before building, as
it decides whether this needs a paid account at all.

## Voice design

Making a voice from a text description (`voice-design-1`): $0.01 per successful request, so it
needs credit. Like a paid audition, it must ask to confirm before it spends.

## Rate tier in the UI

The 429 backoff is built (§10). What is missing is showing the account's concurrency limit next to
`quality.parallel`, so a 429 is explained before it happens. Fish sets the limit by total prepaid
spend: 5 requests at a time under $100, 15 from $100, 50 from $1,000. Fish does not report the tier
directly as far as its docs say; it may have to be inferred, or entered by the user.

## Spend log

Paid recordings are held to a budget but nothing records what they cost. A history per part (when,
which model, how many lines, the dollars charged), kept in `.audio-studio/` since it is the
studio's state, not the game's, would answer "what did Act III cost" without Fish's dashboard. The
budget already knows what it charged (`core/spend.ts`), so the figure is at hand when a job ends.

## Not on this list

Fish's `pronunciation_dictionary` request field works on the free model (tested 2026-10-25), so it
is a free-tier item, not a paid one.
