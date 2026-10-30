import { describe, expect, it } from 'bun:test'
import { DEFAULT_IMAGE_MODEL, IMAGE_MODEL_IDS, checkImageRequest, imageModel } from './imageModels'

const ok = { prompt: 'a room', width: 1024, height: 576, seed: 42 }

describe('imageModels', () => {
  it('knows the two models, klein by default', () => {
    expect([...IMAGE_MODEL_IDS]).toEqual(['klein', 'z-image-turbo'])
    expect(DEFAULT_IMAGE_MODEL).toBe('klein')
    expect(imageModel('klein').mflux).toBe('flux2-klein-4b')
    expect(imageModel('z-image-turbo').mflux).toBe('z-image-turbo')
    expect(imageModel('klein').seconds).toBe(30)
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
})
