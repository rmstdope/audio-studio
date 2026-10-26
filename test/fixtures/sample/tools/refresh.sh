#!/bin/sh
# The sample game's refresh: lists the act's loops from tools/loops, and succeeds only for an act
# that has a dialog (the studio reads it again afterwards).
part="$1"
[ -f "tools/loops/$part.json" ] && cp "tools/loops/$part.json" "tts/$part/music.json"
[ -f "tts/$part/en/script.json" ] || { echo "no dialog for $part" >&2; exit 1; }
exit 0
