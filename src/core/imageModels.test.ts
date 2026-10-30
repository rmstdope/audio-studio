import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_IMAGE_MODEL,
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

describe('imageModels', () => {
  it('knows the two models, klein by default', () => {
    expect([...IMAGE_MODEL_IDS]).toEqual(['klein', 'z-image-turbo'])
    expect(DEFAULT_IMAGE_MODEL).toBe('klein')
    expect(imageModel('klein').mflux).toBe('flux2-klein-4b')
    expect(imageModel('z-image-turbo').mflux).toBe('z-image-turbo')
    expect(imageModel('klein').seconds).toBe(8)
    expect(imageModel('z-image-turbo').seconds).toBe(60)
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

  it('words the time of a take and the menu entries', () => {
    expect(perTake('klein')).toBe('about 8 s a take')
    expect(perTake('z-image-turbo')).toBe('about 1 min a take')
    const entry = (
      id: 'klein' | 'z-image-turbo',
      download: 'whole' | 'partial' | 'absent',
      failed = false,
    ) => imageMenuEntry(id, { download, failed })
    expect(entry('klein', 'whole')).toBe('FLUX.2 klein 4B — about 8 s a take')
    expect(entry('z-image-turbo', 'absent')).toBe(
      'Z-Image-Turbo — about 1 min a take — not on this computer',
    )
    expect(entry('z-image-turbo', 'whole', true)).toBe(
      'Z-Image-Turbo — about 1 min a take — last take failed',
    )
    expect(entry('klein', 'partial')).toBe(
      'FLUX.2 klein 4B — about 8 s a take — download incomplete',
    )
    expect(entry('klein', 'partial', true)).toBe(
      'FLUX.2 klein 4B — about 8 s a take — download incomplete',
    )
    expect(imageShortEntry('klein')).toBe('FLUX.2 klein — about 8 s a take')
    expect(imageSaveFailureHeading('z-image-turbo')).toBe(
      'Z-Image-Turbo could not be saved as the image model.',
    )
  })

  it('finds a model by its mflux name', () => {
    expect(imageByMflux('flux2-klein-4b')).toBe('klein')
    expect(imageByMflux('z-image-turbo')).toBe('z-image-turbo')
    expect(imageByMflux('flux1-schnell')).toBeNull()
  })

  it('starts takes on the main model, else on the other that is whole and has not failed', () => {
    const ok = { download: 'whole', failed: false } as const
    const failed = { download: 'whole', failed: true } as const
    const partial = { download: 'partial', failed: false } as const
    const absent = { download: 'absent', failed: false } as const
    expect(defaultTakeModel('klein', { klein: ok, 'z-image-turbo': ok })).toBe('klein')
    expect(defaultTakeModel('z-image-turbo', { klein: ok, 'z-image-turbo': ok })).toBe(
      'z-image-turbo',
    )
    expect(defaultTakeModel('klein', { klein: absent, 'z-image-turbo': ok })).toBe('z-image-turbo')
    expect(defaultTakeModel('klein', { klein: partial, 'z-image-turbo': ok })).toBe('z-image-turbo')
    expect(defaultTakeModel('klein', { klein: failed, 'z-image-turbo': ok })).toBe('z-image-turbo')
    // The other is not in place: the main model stays, failed or not.
    expect(defaultTakeModel('klein', { klein: failed, 'z-image-turbo': partial })).toBe('klein')
    expect(defaultTakeModel('klein', { klein: failed, 'z-image-turbo': failed })).toBe('klein')
    expect(defaultTakeModel('klein', { klein: absent, 'z-image-turbo': absent })).toBe('klein')
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
