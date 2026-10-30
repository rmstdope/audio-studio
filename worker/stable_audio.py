# /// script
# requires-python = ">=3.10,<3.11"
# dependencies = ["stable-audio-tools==0.0.20", "pytorch-lightning==2.5.5", "numpy<2", "soundfile"]
# [tool.uv]
# exclude-newer = "2026-10-27T00:00:00Z"
# ///
"""Content Studio's Stable Audio Open worker: makes one take of a track, the model loaded once.

Reads one JSON request per line on stdin: {"id": "...", "brief": "...", "kind": "loop|stinger",
"seconds": 20, "bpm": 84 | null, "key": "D major" | null, "seed": 123,
"model_dir": "~/.cache/stable-audio/stable-audio-open-1.0", "small": false, "out": "take.wav"}.
Writes one JSON answer per line on stdout: {"id": "...", "seed": 123} after writing the take to
`out` as a 16-bit WAV, or {"id": "...", "error": "..."}. Anything the libraries print goes to
stderr, so stdout carries only answers. The model a request names (`model_dir`, a folder holding
model_config.json and model.safetensors, downloaded outside the studio) is loaded on the first
request that needs it and swapped when a request names another. No token is read: the one thing
fetched is the public t5-base text encoder both models load, on the first take. Always instrumental.
"""

import json
import os
import sys

# Answers go to a copy of the real stdout; file descriptor 1 itself now points at stderr, so
# nothing the libraries print, Python or native, can get mixed into the answers.
answers = os.fdopen(os.dup(1), "w")
os.dup2(2, 1)
sys.stdout = sys.stderr

loaded = None
model = None
config = None


def answer(payload: dict) -> None:
    answers.write(json.dumps(payload) + "\n")
    answers.flush()


def load(model_dir: str):
    """The model in this folder, read on first use and again when another is asked for."""
    global loaded, model, config
    if loaded != model_dir:
        model = None  # let go of the old model before the new one is read
        loaded = None
        import gc

        gc.collect()
        import torch
        from stable_audio_tools.models.factory import create_model_from_config
        from stable_audio_tools.models.utils import load_ckpt_state_dict

        try:
            torch.mps.empty_cache()
        except Exception:
            pass
        with open(os.path.join(model_dir, "model_config.json")) as file:
            config = json.load(file)
        net = create_model_from_config(config)
        net.load_state_dict(load_ckpt_state_dict(os.path.join(model_dir, "model.safetensors")))
        model = net.to("mps").eval().requires_grad_(False)
        loaded = model_dir
    return model, config


def make(request: dict) -> int:
    """Generates one take into request["out"]; returns the seed it was made from."""
    import soundfile
    import torch
    from einops import rearrange
    from stable_audio_tools.inference.generation import generate_diffusion_cond

    net, cfg = load(os.path.expanduser(request["model_dir"]))
    rate = cfg["sample_rate"]
    size = cfg["sample_size"]
    seconds = min(float(request["seconds"]), size / rate)
    prompt = request["brief"]
    if request.get("bpm"):
        prompt += f", {request['bpm']} BPM"
    if request.get("key"):
        prompt += f", {request['key']}"
    conditioning = [{"prompt": prompt + ", instrumental", "seconds_start": 0, "seconds_total": seconds}]
    # Open 1.0 is a 100-step diffusion model; Small is distilled to a handful of steps.
    small = bool(request.get("small"))
    audio = generate_diffusion_cond(
        net,
        conditioning=conditioning,
        sample_size=size,
        steps=8 if small else 100,
        cfg_scale=1.0 if small else 7.0,
        sampler_type="pingpong" if small else "dpmpp-3m-sde",
        # 0.0.20 guides with APG by default, which needs float64, and MPS has none: plain guidance,
        # as the models were released with.
        apg_scale=0.0,
        device="mps",
        seed=request["seed"],
    )
    audio = rearrange(audio, "b d n -> d (b n)")
    audio = audio[:, : int(seconds * rate)]
    peak = torch.max(torch.abs(audio))
    if peak > 0:
        audio = audio / peak * 0.89  # about -1 dBFS, as ACE-Step's takes are
    soundfile.write(request["out"], audio.to(torch.float32).cpu().T.numpy(), rate, subtype="PCM_16")
    return int(request["seed"])


for line in sys.stdin:
    if not line.strip():
        continue
    request = json.loads(line)
    try:
        answer({"id": request["id"], "seed": make(request)})
    except Exception as error:  # report it to the studio, keep serving
        answer({"id": request["id"], "error": str(error) or type(error).__name__})
