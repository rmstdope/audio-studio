# as-uae — retrospective

- **Implementer:** Bishop
- **Date:** 2026-11-04
- **PR:** #273

## happy-dom's session history hides history bugs, so the leave guard's dead Back shipped green

**What happened.** The leave guard (as-p86.3) put the address back with `history.replaceState`, which
left two entries for one scene; every happy-dom test passed and the navigator found the dead Back
by hand. Reproducing it in a test first needed a fake history (`test/fakeHistory.ts`), because a
probe showed happy-dom differs from a browser in three ways: a hash push keeps the previous entry's
`history.state` instead of `null`; `replaceState` that changes the hash fires `hashchange`; and the
old tests faked a move with `replaceState` plus a hand-dispatched `hashchange`, which creates no
entry at all, so a test could never see an entry duplicated or overwritten. A fourth showed up in
review: the fake's first version resolved `history.go` targets at call time, where a browser
queues traversals.

**Why.** happy-dom 21's `History` is not a model of the session history; tests that move the
address through it test the router, not the history.

**Cost.** About twenty minutes of probing and a second fix round after review, on a bug that had
already cost a verification pass and a bead.

**Prevent by.** UI tests that depend on Back, Forward or how many entries a move makes install
`fakeHistory` from `test/fakeHistory.ts` instead of `replaceState` + `HashChangeEvent`; a line to
that effect in CLAUDE.md's _Test-driven_ list.

**Seen before.** as-p86.3 (happy-dom's event dispatch and React flushing do not match Chrome's).
