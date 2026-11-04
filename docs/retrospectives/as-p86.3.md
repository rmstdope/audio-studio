# as-p86.3: a leave guard that passed its tests and failed in Chrome

## What happened

The leave dialog (ask before leaving a scene with unsaved changes) passed every happy-dom test and was
verified failed in real Chrome. The rework took three attempts. A fix that put the guard's listener
in the capture phase was green in tests and still failed in Chrome: the router rendered the other
page (and, for a move to another page, unmounted the guard) before any `hashchange` listener of the
guard's ran. Only logging into one shared array from the render and the listener in Chrome showed it.
The cold review's first round also caught that the sidebar route was untested. happy-dom calls a
listener removed during dispatch, and batches `setRoute` inside `act`, so no happy-dom test of the
old guard-side listener could fail.

## Why

happy-dom's event dispatch and React's flushing do not match Chrome's (removed listeners still run,
`act` defers the router's render). A guard that races the router's listener cannot be tested there.

## Cost

About three build/verify rounds in Chrome and two review rounds on top of the first delivery.

## Prevent by

Do not race the router: anything that must decide before a route changes goes through the router
(`holdRoute` in `src/ui/route.ts`), pinned by `src/ui/routeHold.test.tsx`. When a UI behaviour
depends on listener order or on React's flush timing, verify it in Chrome before the PR, not only
in happy-dom.

## Seen before

Nothing like it yet. Also seen: `server, a track's takes > makes and stops takes for a whole list`
failed once in three full runs (takes 0, expected 4) with no related change; passed on rerun and in CI.
