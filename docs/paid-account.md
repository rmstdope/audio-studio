# Paid Fish Audio account: what is not built yet

What the studio already does for a paid account: it prices every current model (`core/prices.ts`),
shows the account's API credit, asks for a spending ceiling before a paid recording and holds it
to that budget (`core/spend.ts`), offers a final recording with the final model (§8.4 of
`architecture.md`), and asks Fish again after a 429 (§10).

The items below are not built. Each is small enough for one pull request, unless it says
otherwise. Facts about Fish come from its docs as checked on 2026-10-25; check them again before
building. Read `architecture.md` and `CLAUDE.md` first.

## Paid auditions

Takes are always recorded with the free model: `narration.models.audition` accepts only
`s2.1-pro-free` (`auditionModel` in `core/project.ts`). Hearing candidates on the model you will
ship with needs a priced audition stage, in more than one pull request:

- Takes record by themselves today, which is fine only because they are free. A paid audition
  model must ask to confirm the cost first (§8.1 says "a paid audition model will ask first").
- Audition takes call `fish.tts` directly (`speak` in `services/takes.ts`), with no budget. A paid
  model needs that path charged through `core/spend.ts` and held against the credit, as recordings
  are.
- Cue tries (**Hear it**, `tryLine` in the same file) also record with the audition model, so a
  paid audition model would make every try paid too. Decide whether tries follow the audition
  model or stay free.

The take cache key already includes the model (`takeKey` in `core/takes.ts`), so takes on two
models do not mix.

## Paid extra takes of a line

Extra takes (**Takes** on a line's row) use the draft model, free only: `takeLine` in
`services/lineTakes.ts` refuses them when the draft model is paid, and §8.3 says so. With a paid
draft model, an extra take would need the same confirm-and-budget flow as recording a line from
its row.

## The `s1` retirement

Fish retires `s1` on 31 December 2026; after that, requests for it are served and billed as
`s2.1-pro` at the same price. `core/prices.ts` lists `s1` with no end date. The studio should warn
when the project file names `s1` for `draft` or `final`, and offer to switch it. The project file
is changed in one place only today (`narration.quality.soundAlike`, see `CLAUDE.md`), so changing
`models` there is a new rule for the consumer repository and needs agreeing first.

## Your own voices in casting

Search covers Fish's public library only (`listVoices` in `services/fish.ts` never asks for your
own). Fish lists the account's own voices with `GET /model?self=true`; on 2026-10-25 the account
behind RetroQuest's key had none. They should appear on the audition board, marked as your own,
and be castable like any other. Bringing a voice in by its id (`getVoice`, an authenticated
`GET /model/{id}`) probably already works for a private voice you own, but that is not verified.

## Voice cloning

Creating a private voice from recorded speech: `POST /model` with `multipart/form-data`, fields
`type=tts`, `title`, `visibility=private`, `train_mode=fast` and the audio as `voices` (1 to 20
files). Fish asks for at least 10 seconds a clip and suggests a minute or two for fidelity. Its
pricing page lists no price for cloning. It belongs on the character page as a third way to find a
voice, beside search and bringing in a voice by id. Not verified: whether speech with a private
voice works on the free model. Test that with a real key before building, as it decides whether
this needs a paid account at all.

## Voice design

Making a voice from a text description (`voice-design-1`, `POST /v1/voice-design`): $0.01 per
successful request, so it needs credit. Like a paid audition, it must ask to confirm and be charged
to a budget before it spends.

## Rate tier in the UI

The 429 backoff is built (§10). What is missing is showing the account's concurrency limit next to
`quality.parallel`, so a 429 is explained before it happens. Fish sets the limit by total prepaid
spend: 5 requests at a time under $100, 15 from $100, 50 from $1,000. Fish's docs name no way to
ask for the tier, so it may have to be inferred, or entered by the user.

## Spend log

Paid recordings are held to a budget but nothing records what they cost. A history per part (when,
which model, how many lines, the dollars charged), kept in `.audio-studio/` since it is the
studio's state, not the game's, would answer "what did Act III cost" without Fish's dashboard.

The budget (`core/spend.ts`) knows what it charged, but only as an estimate at list price, made
before each request; it is not what Fish billed, and Fish may bill a request after it was charged
(§8.4). A one-line recording from its row has a budget as well as a job. The server drops a budget
when its recording ends (`budgets` in `server/index.ts`), so the figure must be read before that.
For Fish's own figure, compare the credit before and after.

## Not on this list

Fish's `pronunciation_dictionary` request field works on the free model (a live request on
2026-10-25 was accepted), so it is a free-tier item, not a paid one.
