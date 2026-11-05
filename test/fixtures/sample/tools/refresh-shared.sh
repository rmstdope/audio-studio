#!/bin/sh
# The sample game's shared refresh (`refresh.shared`), run from the Stingers and the Sound effects
# pages alike. It writes the stingers only: the sample's effects list is checked in, not written here.
# tools/stingers.json has one stinger fewer than the checked-in list, so a refresh shows "1 removed". It leaves tts/stingers.json changed: do not
# commit it after trying the button in `bun run dev`.
cp tools/stingers.json tts/stingers.json
