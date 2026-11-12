# as-4ywm — arrowing onto a dimmed language tab hid its tip

## A unit test of the switch could not reproduce the bug

**What happened:** The first reproduction test (LanguageSwitch and WhyTip in happy-dom, focus Svenska,
ArrowRight) passed on the unfixed code. The bug needed a real browser. Chrome fires `pointerover` on
whatever element a page change moves under a resting mouse, and only that hid the tip. It was found
by logging the capture-phase events in Chrome through the browser tools.

**Why:** happy-dom fires no pointer events on layout changes. It also treats every `.focus()` as
`:focus-visible`, so a test cannot tell keyboard focus from mouse focus.

**Cost:** One wrong first test, about twenty minutes of live tracing, and one fix half (mouse focus
keeps no tip) that only a manual Chrome check proves.

**Prevent by:** In a WhyTip or focus bug, log `focusin`/`focusout`/`pointerover`/`hashchange` in the
capture phase in Chrome before writing the test. Simulate a page change under a resting mouse with a
`pointerover` on `document.body`. Do not rely on happy-dom for `:focus-visible` differences.

**Seen before:** No.
