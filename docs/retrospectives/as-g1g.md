# as-g1g — Chrome would not narrow the window for a narrow-layout check

## What happened

To check the fix at 600×900, I called Claude in Chrome's `resize_window` with 600 and 900. It reported success, but the next screenshot was still 1280 px wide, and the page laid out at full width.

## Why

Not established. The window may have been maximised or in full screen, and the extension's resize may not apply then.

## Cost

A few minutes. I measured instead inside a 600×900 `<iframe>` of the same page, injected with `javascript_tool`. That gave exact element boxes, before and after the fix. A verifier who trusts the "Successfully resized" message would judge a narrow layout at full width, and could pass a bug that only shows when the window is narrow.

## Prevent by

- In `.claude/skills/verify-audio-studio`, for any width-dependent check, confirm the width after resizing (`innerWidth` through `javascript_tool`).
- If the width did not change, use an iframe of the page at the wanted size instead.

## Seen before

No: nothing under `docs/retrospectives/` mentions resizing.
