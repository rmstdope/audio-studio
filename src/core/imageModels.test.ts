import { figuresOf } from './takeTimes'
import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_EDIT_MODEL,
  EDIT_MODEL_IDS,
  editFailureReason,
  editMenuEntry,
  editModel,
  editPerTake,
  editShortEntry,
  startEditModel,
  IMAGE_MODEL_IDS,
  checkImageRequest,
  defaultTakeModel,
  imageByMflux,
  imageFailureReason,
  imageMenuEntry,
  imageModel,
  imageSaveFailureHeading,
  imageShortEntry,
  imageSwitchedLine,
  perTake,
} from './imageModels'

const ok = { prompt: 'a room', width: 1024, height: 576, seed: 42 }

type ModelState = { download: 'whole' | 'partial' | 'absent'; failed: boolean }

describe('imageModels', () => {
  it('knows the three models in menu order, klein by default', () => {
    expect([...IMAGE_MODEL_IDS]).toEqual(['klein', 'z-image-turbo', 'qwen-image'])
    expect(imageModel('qwen-image').name).toBe('Qwen-Image')
    expect(imageModel('qwen-image').short).toBe('Qwen-Image')
    expect(imageModel('qwen-image').command).toBe('mflux-generate-qwen')
    expect(DEFAULT_IMAGE_MODEL).toBe('klein')
    expect(imageModel('klein').mflux).toBe('flux2-klein-4b')
    expect(imageModel('z-image-turbo').mflux).toBe('z-image-turbo')
  })

  it('accepts a prompt, dimensions in steps of 16 and a seed', () => {
    expect(checkImageRequest(ok)).toBeNull()
  })

  it('refuses what mflux cannot make', () => {
    expect(checkImageRequest({ ...ok, prompt: '  ' })).toMatch(/prompt/)
    expect(checkImageRequest({ ...ok, width: 1000 })).toMatch(/width/)
    expect(checkImageRequest({ ...ok, height: 0 })).toMatch(/height/)
    expect(checkImageRequest({ ...ok, width: 4096 })).toMatch(/width/)
    expect(checkImageRequest({ ...ok, seed: -1 })).toMatch(/seed/)
    expect(checkImageRequest({ ...ok, seed: 1.5 })).toMatch(/seed/)
  })

  it('words the time of a take and the menu entries, a guess until timed', () => {
    const guesses = figuresOf({})
    const timed = figuresOf({ klein: [23] })
    expect(perTake('klein', guesses)).toBe('a guess: about 20 s a take')
    expect(perTake('z-image-turbo', guesses)).toBe('a guess: about 1 min a take')
    expect(perTake('klein', timed)).toBe('about 25 s a take')
    const entry = (
      id: 'klein' | 'z-image-turbo',
      download: 'whole' | 'partial' | 'absent',
      failed = false,
      figures = timed,
    ) => imageMenuEntry(id, { download, failed }, figures)
    expect(entry('klein', 'whole')).toBe('FLUX.2 klein 4B — about 25 s a take')
    expect(entry('klein', 'whole', false, guesses)).toBe(
      'FLUX.2 klein 4B — a guess: about 20 s a take',
    )
    expect(entry('z-image-turbo', 'absent')).toBe(
      'Z-Image-Turbo — a guess: about 1 min a take — not on this computer',
    )
    expect(entry('z-image-turbo', 'whole', true)).toBe(
      'Z-Image-Turbo — a guess: about 1 min a take — last take failed',
    )
    expect(entry('klein', 'partial', true)).toBe(
      'FLUX.2 klein 4B — about 25 s a take — download incomplete',
    )
    expect(imageShortEntry('klein', guesses)).toBe('FLUX.2 klein — a guess: about 20 s a take')
    expect(imageShortEntry('klein', timed)).toBe('FLUX.2 klein — about 25 s a take')
    expect(imageSaveFailureHeading('z-image-turbo')).toBe(
      'Z-Image-Turbo could not be saved as the image model.',
    )
  })

  it('finds a model by its mflux name', () => {
    expect(imageByMflux('flux2-klein-4b')).toBe('klein')
    expect(imageByMflux('z-image-turbo')).toBe('z-image-turbo')
    expect(imageByMflux('flux1-schnell')).toBeNull()
  })

  it('starts takes on the main model, else the first model in menu order that is whole and has not failed', () => {
    const ok = { download: 'whole', failed: false } as const
    const failed = { download: 'whole', failed: true } as const
    const partial = { download: 'partial', failed: false } as const
    const absent = { download: 'absent', failed: false } as const
    const all = (klein: ModelState, z: ModelState, qwen: ModelState) => ({
      klein,
      'z-image-turbo': z,
      'qwen-image': qwen,
    })
    expect(defaultTakeModel('klein', all(ok, ok, ok))).toBe('klein')
    expect(defaultTakeModel('qwen-image', all(ok, ok, ok))).toBe('qwen-image')
    expect(defaultTakeModel('klein', all(absent, ok, ok))).toBe('z-image-turbo')
    expect(defaultTakeModel('klein', all(partial, ok, ok))).toBe('z-image-turbo')
    expect(defaultTakeModel('klein', all(failed, ok, ok))).toBe('z-image-turbo')
    expect(defaultTakeModel('qwen-image', all(ok, ok, absent))).toBe('klein')
    expect(defaultTakeModel('qwen-image', all(absent, ok, partial))).toBe('z-image-turbo')
    expect(defaultTakeModel('qwen-image', all(absent, absent, failed))).toBe('qwen-image')
    expect(defaultTakeModel('klein', all(absent, absent, ok))).toBe('qwen-image')
    // Nothing else in place: a whole model even if its last take failed, else the main model.
    expect(defaultTakeModel('klein', all(failed, partial, absent))).toBe('klein')
    expect(defaultTakeModel('klein', all(failed, failed, failed))).toBe('klein')
    expect(defaultTakeModel('klein', all(absent, absent, absent))).toBe('klein')
    expect(defaultTakeModel('klein', all(partial, absent, failed))).toBe('qwen-image')
  })

  it('words the faint line of an image whose main model failed', () => {
    expect(imageSwitchedLine('klein', 'z-image-turbo')).toBe(
      "FLUX.2 klein, the project's image model, failed on its last take, so these takes use Z-Image-Turbo. Setup says what went wrong.",
    )
  })
})

describe('imageFailureReason', () => {
  const traceback = [
    'Traceback (most recent call last):',
    '  File "/Users/x/mflux/weight_loader.py", line 341, in _load_mlx_native',
    '    raise FileNotFoundError(f"No safetensors found in {path}")',
    'FileNotFoundError: No safetensors found in /Users/x/.cache/huggingface/hub',
  ].join('\n')

  it('names the model and the missing weights, without the traceback', () => {
    const reason = imageFailureReason('klein', 1, traceback)
    expect(reason).toBe(
      'FLUX.2 klein 4B could not load its weights: they are missing or incomplete on this computer; download them again with uvx --from huggingface_hub hf download black-forest-labs/FLUX.2-klein-4B, then Try again.',
    )
  })

  it('names the model and a command the installed mflux does not know', () => {
    const stderr =
      "usage: mflux-generate [-h] ...\nmflux-generate: error: argument --model: invalid choice: 'z-image-turbo'"
    expect(imageFailureReason('z-image-turbo', 2, stderr)).toBe(
      'The installed mflux cannot make Z-Image-Turbo images; update it with uv tool install --upgrade mflux, then Try again.',
    )
    expect(
      imageFailureReason('klein', 2, 'mflux-generate: error: unrecognized arguments: --seed 4'),
    ).toBe(
      'The installed mflux cannot make FLUX.2 klein 4B images; update it with uv tool install --upgrade mflux, then Try again.',
    )
  })

  it('does not blame the weights for a missing file that is not one of them', () => {
    const stderr = [
      'Traceback (most recent call last):',
      '  File "/Users/x/.local/share/uv/tools/mflux/lib/python3.12/site-packages/mflux/x.py", line 3',
      "FileNotFoundError: [Errno 2] No such file or directory: '/Users/x/.local/share/uv/python/bin/python3.12'",
    ].join('\n')
    expect(imageFailureReason('klein', 1, stderr)).toBe(
      "FLUX.2 klein 4B could not make the image (mflux stopped with exit code 1); the details are in the studio's log.",
    )
  })

  it('says only the model and the exit code for anything else, pointing at the log', () => {
    const reason = imageFailureReason('klein', 1, 'Traceback ...\nValueError: something odd')
    expect(reason).toBe(
      "FLUX.2 klein 4B could not make the image (mflux stopped with exit code 1); the details are in the studio's log.",
    )
  })
})

describe('edit models', () => {
  it('knows klein and qwen-edit, klein first', () => {
    expect([...EDIT_MODEL_IDS]).toEqual(['klein', 'qwen-edit'])
    expect(editModel('qwen-edit').repo).toBe('Qwen/Qwen-Image-Edit')
    expect(editModel('klein').command).toBe('mflux-generate-flux2-edit')
  })

  it('reads the time and the menu entries, klein patches timed apart from klein takes', () => {
    const whole = { download: 'whole', failed: false } as const
    const guesses = figuresOf({})
    const timed = figuresOf({ klein: [90], 'klein-edit': [23] })
    expect(editPerTake('qwen-edit', guesses)).toBe('a guess: about 8 min a take')
    expect(editPerTake('klein', guesses)).toBe('a guess: about 20 s a take')
    expect(editPerTake('klein', timed)).toBe('about 25 s a take')
    expect(editShortEntry('klein', guesses)).toBe('FLUX.2 klein — a guess: about 20 s a take')
    expect(editMenuEntry('klein', whole, timed)).toBe('FLUX.2 klein 4B — about 25 s a take')
    expect(editMenuEntry('qwen-edit', { download: 'absent', failed: false }, guesses)).toBe(
      'Qwen Image Edit — a guess: about 8 min a take — not on this computer',
    )
    expect(editMenuEntry('qwen-edit', { download: 'partial', failed: true }, guesses)).toBe(
      'Qwen Image Edit — a guess: about 8 min a take — download incomplete',
    )
    expect(editMenuEntry('qwen-edit', { download: 'whole', failed: true }, guesses)).toBe(
      'Qwen Image Edit — a guess: about 8 min a take — last take failed',
    )
  })

  it('starts patches on klein, or on qwen when only qwen is whole', () => {
    expect(DEFAULT_EDIT_MODEL).toBe('klein')
    expect(startEditModel({ klein: 'whole', 'qwen-edit': 'whole' })).toBe('klein')
    expect(startEditModel({ klein: 'whole', 'qwen-edit': 'absent' })).toBe('klein')
    expect(startEditModel({ klein: 'absent', 'qwen-edit': 'absent' })).toBe('klein')
    expect(startEditModel({ klein: 'partial', 'qwen-edit': 'whole' })).toBe('qwen-edit')
    expect(startEditModel({ klein: 'absent', 'qwen-edit': 'whole' })).toBe('qwen-edit')
  })

  it('says why a take failed, naming the model', () => {
    expect(editFailureReason('qwen-edit', 143, 'killed')).toBe(
      "Qwen Image Edit could not make the take (mflux stopped with exit code 143); the details are in the studio's log.",
    )
    expect(
      editFailureReason('qwen-edit', 1, 'FileNotFoundError: x/snapshots/y/model.safetensors'),
    ).toBe(
      'Qwen Image Edit could not load its weights: they are missing or incomplete on this computer; download them again with uvx --from huggingface_hub hf download Qwen/Qwen-Image-Edit, then try again.',
    )
    expect(editFailureReason('klein', 1, 'error: unrecognized arguments: x')).toMatch(
      /update it with uv tool install --upgrade mflux/,
    )
  })
})
