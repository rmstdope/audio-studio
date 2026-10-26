#!/bin/sh
# The sample game's refresh of the stingers. tools/stingers.json has one stinger fewer than the
# checked-in list, so a refresh shows "1 removed". It leaves tts/stingers.json changed: do not
# commit it after trying the button in `bun run dev`.
cp tools/stingers.json tts/stingers.json
