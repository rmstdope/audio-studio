# /// script
# requires-python = ">=3.11"
# dependencies = ["ace-step @ git+https://github.com/ace-step/ACE-Step-1.5.git"]
# ///
"""Audio Studio's music worker: makes one take of a track with ACE-Step 1.5, the models loaded once.

Reads one JSON request per line on stdin: {"id": "...", "brief": "...", "kind": "loop|stinger",
"seconds": 100, "bpm": 84 | null, "key": "D major" | null, "seed": 123, "out": "take.wav"}.
Writes one JSON answer per line on stdout: {"id": "...", "seed": 123} after writing the take to
`out` as a 16-bit WAV, or {"id": "...", "error": "..."}. Anything the libraries print goes to
stderr, so stdout carries only answers. The models (XL turbo and the 4B language model) are read
from $ACESTEP_CHECKPOINTS and loaded on the first request. Always instrumental.
"""

import json
import os
import sys
import tempfile

# Answers go to a copy of the real stdout; file descriptor 1 itself now points at stderr, so
# nothing the libraries print, Python or native, can get mixed into the answers.
answers = os.fdopen(os.dup(1), "w")
os.dup2(2, 1)
sys.stdout = sys.stderr

CHECKPOINTS = os.environ["ACESTEP_CHECKPOINTS"]
DIT_MODEL = "acestep-v15-xl-turbo"
LM_MODEL = "acestep-5Hz-lm-4B"

handlers = None


def answer(payload: dict) -> None:
    answers.write(json.dumps(payload) + "\n")
    answers.flush()


def load():
    """The two handlers, made on first use."""
    global handlers
    if handlers is None:
        from acestep.handler import AceStepHandler  # noqa: E402  (after the redirect)
        from acestep.llm_inference import LLMHandler  # noqa: E402

        # ACE-Step looks for its models in <project_root>/checkpoints: a folder that has one,
        # linking to wherever the models really are.
        root = tempfile.mkdtemp(prefix="audio-studio-ace-")
        os.symlink(CHECKPOINTS, os.path.join(root, "checkpoints"))
        dit = AceStepHandler()
        dit.initialize_service(project_root=root, config_path=DIT_MODEL, device="mps")
        lm = LLMHandler()
        lm.initialize(checkpoint_dir=CHECKPOINTS, lm_model_path=LM_MODEL, backend="mlx", device="mps")
        handlers = (dit, lm)
    return handlers


def make(request: dict) -> int:
    """Generates one take into request["out"]; returns the seed it was made from."""
    from acestep.inference import GenerationConfig, GenerationParams, generate_music

    dit, lm = load()
    params = GenerationParams(
        caption=request["brief"],
        lyrics="[Instrumental]",
        instrumental=True,
        bpm=request.get("bpm"),
        keyscale=request.get("key") or "",
        duration=request["seconds"],
        seed=request["seed"],
        inference_steps=8,
        thinking=True,
    )
    config = GenerationConfig(batch_size=1, use_random_seed=False, audio_format="wav")
    with tempfile.TemporaryDirectory() as folder:
        result = generate_music(dit, lm, params, config, save_dir=folder)
        if not result.success:
            raise RuntimeError(result.error or result.status_message)
        take = result.audios[0]
        # ACE-Step writes 48 kHz stereo; the studio reads 16-bit PCM.
        import soundfile

        soundfile.write(request["out"], take["tensor"].cpu().T.numpy(), take["sample_rate"], subtype="PCM_16")
        return int(take["params"].get("seed", request["seed"]))


for line in sys.stdin:
    if not line.strip():
        continue
    request = json.loads(line)
    try:
        answer({"id": request["id"], "seed": make(request)})
    except Exception as error:  # report it to the studio, keep serving
        answer({"id": request["id"], "error": str(error) or type(error).__name__})
