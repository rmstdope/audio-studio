# /// script
# requires-python = ">=3.10,<3.14"
# dependencies = ["stable-audio-3 @ git+https://github.com/Stability-AI/stable-audio-3@790793b", "soundfile"]
# [tool.uv]
# exclude-newer = "2026-10-27T00:00:00Z"
# ///
"""Content Studio's sound-effects worker: makes one take of an effect, the model loaded once.

Runs Stable Audio 3 Small SFX on the CPU, so an effect never waits behind music, images or
Whisper on the GPU. It has its own libraries (torch 2.7.1, numpy 2), apart from the Stable Audio
Open worker's.

Reads one JSON request per line on stdin: {"id": "...", "prompt": "a door creak", "seconds": 3,
"seed": 123, "out": "take.wav"}. Writes one JSON answer per line on stdout: {"id": "...",
"seed": 123} after writing the take to `out` as a 16-bit WAV (44.1 kHz stereo; it often ends
before `seconds`, in silence the studio trims), or {"id": "...", "error": "..."}. Anything the
libraries print goes to stderr, so stdout carries only answers. The weights are read from the
Hugging Face cache (downloaded once by the user with their token); the worker reads no token.
"""

import json
import os
import sys

# Answers go to a copy of the real stdout; file descriptor 1 itself now points at stderr, so
# nothing the libraries print, Python or native, can get mixed into the answers.
answers = os.fdopen(os.dup(1), "w")
os.dup2(2, 1)
sys.stdout = sys.stderr

model = None


def answer(payload: dict) -> None:
    answers.write(json.dumps(payload) + "\n")
    answers.flush()


def load():
    """Small SFX on the CPU, read on the first request."""
    global model
    if model is None:
        from stable_audio_3 import StableAudioModel

        model = StableAudioModel.from_pretrained("small-sfx", device="cpu")
    return model


def make(request: dict) -> int:
    """Generates one take into request["out"]; returns the seed it was made from."""
    import soundfile
    import torch

    net = load()
    seed = int(request["seed"])
    audio = net.generate(prompt=request["prompt"], duration=float(request["seconds"]), seed=seed)
    audio = audio[0].to(torch.float32).cpu()  # channels x samples
    peak = torch.max(torch.abs(audio))
    if peak > 1:
        audio = audio / peak
    soundfile.write(
        request["out"], audio.T.numpy(), net.model.sample_rate, subtype="PCM_16"
    )
    return seed


for line in sys.stdin:
    if not line.strip():
        continue
    request = json.loads(line)
    try:
        answer({"id": request["id"], "seed": make(request)})
    except Exception as error:  # report it to the studio, keep serving
        answer({"id": request["id"], "error": str(error) or type(error).__name__})
