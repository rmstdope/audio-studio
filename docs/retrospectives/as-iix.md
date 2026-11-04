# as-iix — a navigator question asked from widths measured against the panel's border box

## What happened

To decide how the Scenes sound effects table could fit at 1300 px, I measured the table against
`.scene-effects`' `clientWidth` (758 px) and asked the navigator to choose a fix. `clientWidth`
includes the panel's padding, so the table really had 714 px. The option the navigator chose fitted
in 758 but not in 714 while a scene played, so I had to go back with corrected numbers and a second
question. The navigator then chose a different option.

A second, smaller trap: after editing `styles.css`, the studio started with
`bun bin/content-studio.ts … --no-open` kept serving the old bundle until restarted. A restart
alone was not enough either: Chrome kept the old page and its old chunk until the URL carried a
cache-busting query (`/?v=N#…`). For a while I measured stale CSS and thought my rule was wrong.

## Why

Measuring a table's fit, I read the container's `clientWidth` instead of its content box (or the
table's own `offsetWidth` at `width: 100%`, which equals the content box when it fits). The studio
without `--dev` builds the bundle once at start, and the HTML names a hashed chunk the browser
caches.

## Cost

One wrong question to the navigator, and a second one to correct it. About 15 minutes measuring
stale CSS.

## Prevent by

- In `skills/verify-audio-studio` (and anywhere a session measures layout in the studio), measure
  "fits" as the table's `offsetWidth` against the container's content box (`clientWidth` minus
  padding), never `clientWidth` alone.
- Run the studio with `--dev` while changing CSS, or restart it and load `/?v=<n>#…` before every
  measurement.

## Seen before

Nothing like it in docs/retrospectives/.
