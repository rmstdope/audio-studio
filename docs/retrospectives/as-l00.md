# as-l00

## A test green locally and red in CI: a take that finished before it was looked at

**What happened:** `imageTakes.test.ts` "times a finished take…, and the next take is expected to take that long" released the generator's gate, then made a second take and read its `expected` from `view()`. Locally the take was still "making" when read; in CI it had already finished, so `view.making` was empty (`undefined … making[0].expected`).

**Why:** the gate was already open for the second take, so its finishing raced the read; a test must hold a take to look at it.

**Cost:** one red CI run (about 3 min) and one fix push.

**Prevent by:** in `src/services/imageTakes.test.ts`, look at a "making" take only behind a gate that never opens; seed any earlier state (here `take-times.json`) on disk instead of producing it with a first take.

**Seen before:** nothing like it yet.
