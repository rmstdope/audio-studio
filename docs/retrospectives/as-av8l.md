# as-av8l: a bug was filed against a build that main had already moved past

**What happened:** Psylocke filed as-av8l while verifying as-pd2v at 03cb5eb: after a choose and then Z in Fine-tune, the banner still read "Take 6 is in the game now." PR #469 (as-kw3x.4, f673519) fixed that same behaviour. It merged after 03cb5eb and before this pass started, and its own title is "Undo no longer leaves a stale 'is in the game now' banner". I first found the bug gone on main. The reproduction test failed only when 03cb5eb's `FineTunePanel.tsx` was put back. The pass delivered a regression test and no fix.

**Why:** the bug was verified on the build being checked (03cb5eb), and nobody checked whether a bead already in flight changed the same behaviour. as-kw3x.4 was open, and its title named the symptom.

**Cost:** a whole bugfix pass for a test-only change. It was cheap only because #469's commit subject gave it away at once.

**Prevent by:** in `verify-content-studio`, before filing a follow-up bug, look on `origin/main` past the verified sha (`git log <sha>..origin/main --oneline -- <the files involved>`) and in the open beads for the same symptom. If something matches, note it on the existing bead instead, or file the bug with "check on main first".

**Seen before:** no.
