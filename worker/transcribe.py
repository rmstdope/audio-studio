# /// script
# requires-python = ">=3.10"
# dependencies = ["mlx-whisper==0.4.3"]
# ///
"""Audio Studio's Whisper worker: transcribes clips with mlx-whisper, the model loaded once.

Reads one JSON request per line on stdin: {"id": "...", "path": "clip.wav", "model": "...", "language": "sv"}; the language is optional.
Writes one JSON answer per line on stdout: {"id": "...", "segments": [{start, end, words:
[{word, start, end}]}]} or {"id": "...", "error": "..."}. Anything the libraries print goes to
stderr, so stdout carries only answers. Same Whisper as RetroQuest's narrate.py.
"""

import json
import os
import sys

# Answers go to a copy of the real stdout; file descriptor 1 itself now points at stderr, so
# nothing the libraries print, Python or native, can get mixed into the answers.
answers = os.fdopen(os.dup(1), "w")
os.dup2(2, 1)
sys.stdout = sys.stderr

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
            request["path"],
            path_or_hf_repo=request["model"],
            word_timestamps=True,
            verbose=None,
            # The language spoken when the studio knows it; else Whisper recognises it itself.
            **({"language": request["language"]} if request.get("language") else {}),
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
