import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODEL_IDS,
  checkImageRequest,
  defaultTakeModel,
  imageByMflux,
  imageMenuEntry,
  imageModel,
  imageSaveFailureHeading,
  imageShortEntry,
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
    expect(imageMenuEntry('klein', true)).toBe('FLUX.2 klein 4B — about 8 s a take')
    expect(imageMenuEntry('z-image-turbo', false)).toBe(
      'Z-Image-Turbo — about 1 min a take — not on this computer',
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

  it('starts takes on the main model, else on the other one that is here', () => {
    const both = { klein: true, 'z-image-turbo': true }
    expect(defaultTakeModel('klein', both)).toBe('klein')
    expect(defaultTakeModel('z-image-turbo', both)).toBe('z-image-turbo')
    expect(defaultTakeModel('klein', { klein: false, 'z-image-turbo': true })).toBe('z-image-turbo')
    expect(defaultTakeModel('z-image-turbo', { klein: true, 'z-image-turbo': false })).toBe('klein')
    expect(defaultTakeModel('klein', { klein: false, 'z-image-turbo': false })).toBe('klein')
  })
})
