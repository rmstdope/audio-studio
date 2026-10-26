# as-1tg — retrospective

- **Implementer:** Bishop
- **Date:** 2026-10-26
- **PR:** #114

## A bug fix conflicted at merge with a feature that rebuilt the same button

**What happened.** as-1tg (the list row's play button always disabled) was fixed, reviewed and pushed. Before it could merge, as-nyx (#112, "Hear a track's current music from the Music list") landed and rebuilt the same button in `src/ui/features/music/MusicView.tsx` to its own agreed experience. The PR went `CONFLICTING DIRTY`. as-nyx's button met as-1tg's acceptance with different wording, so the fix was dropped. The PR became a regression test only, and it was reviewed again from scratch.
**Why.** Both beads were open on the same surface at once: as-1tg was filed by verification as a follow-up to as-qqi.5, and as-nyx was the agreed redesign of that row. Neither bead named the other, and nothing in `scripts/bugfix-candidates` tells the bugfixer that an in-flight bead touches the same code.
**Cost.** One implementation and one cold review thrown away, a second full review, and a rebase attempt.
**Prevent by.** When a bug bead is filed, or before `scripts/bugfix-candidates` hands one out, check for open or in-progress beads whose title or acceptance covers the same surface (here, "play" on the Music list), and link them with `bd dep` or a note, so the bug is closed by the feature or held until it lands.
**Seen before.** none found.
