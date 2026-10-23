# /// script
# requires-python = ">=3.10"
# dependencies = ["mlx-whisper==0.4.3"]
# ///
"""Audio Studio's Whisper worker: transcribes clips with mlx-whisper, the model loaded once.

Reads one JSON request per line on stdin: {"id": "...", "path": "clip.wav", "model": "..."}.
Writes one JSON answer per line on stdout: {"id": "...", "segments": [{start, end, words:
[{word, start, end}]}]} or {"id": "...", "error": "..."}. Anything the libraries print goes to
stderr, so stdout carries only answers. Same Whisper as RetroQuest's narrate.py.
"""

import json
import sys

answers = sys.stdout
sys.stdout = sys.stderr  # keep library output off the answer channel

import mlx_whisper  # noqa: E402  (after the redirect)


def answer(payload: dict) -> None:
    answers.write(json.dumps(payload) + "\n")
    answers.flush()


for line in sys.stdin:
    if not line.strip():
        continue
    request = json.loads(line)
    try:
        result = mlx_whisper.transcribe(
            request["path"], path_or_hf_repo=request["model"], word_timestamps=True, verbose=None
        )
        segments = [
            {
                "start": segment["start"],
                "end": segment["end"],
                "words": [
                    {"word": word["word"], "start": word["start"], "end": word["end"]}
                    for word in segment.get("words", [])
                ],
            }
            for segment in result["segments"]
        ]
        answer({"id": request["id"], "segments": segments})
    except Exception as error:  # report it to the studio, keep serving
        answer({"id": request["id"], "error": f"{type(error).__name__}: {error}"})
