# as-dab0 — retrospective

- **Implementer:** Nightcrawler
- **Date:** 2026-11-12
- **PR:** #468

## The Chrome window would not resize, and stayed 606×701

**What happened.** `resize_window` to 1512×950 reported success twice. `innerWidth` stayed 606, and at that width the page uses its narrow layout. I measured in a 1512×860 same-origin `<iframe>` injected with `javascript_tool` instead.
**Why.** Not established.
**Cost.** A few minutes.
**Prevent by.** `.claude/skills/verify-content-studio/SKILL.md` could say to read `innerWidth` after every resize, and to fall back to an iframe of the page at the wanted size.
**Seen before.** as-g1g.

## The sample has no image with both a chosen take and named areas

**What happened.** To measure Named areas on the portrait cellar door, the image needed a chosen take and areas. The sample has neither. First I tried patching the iframe's `fetch` to fake them, but the app's queries did not refetch, so the page never changed. What worked was relaunching with `CONTENT_STUDIO_FAKE_IMAGES=1` on a scratch copy of the sample, adding `areas` to the cellar door in `tts/act1/images.json`, then Make and Choose.
**Why.** The sample declares areas only on the landscape Lantern hall. Fake image takes need the environment variable, and the verify skill does not mention it.
**Cost.** About fifteen minutes of trying before the working route.
**Prevent by.** Name `CONTENT_STUDIO_FAKE_IMAGES=1` in `.claude/skills/verify-content-studio/SKILL.md` as the way to get image takes in the sample. Or give the sample's portrait cellar door an `areas` list.
**Seen before.** none found.
