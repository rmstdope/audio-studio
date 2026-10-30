import { describe, expect, it } from 'bun:test'
import { createFakeImages, fakePng } from './imagesFake'

describe('the stand-in image generator', () => {
  it('writes a PNG of the size asked, whose colour follows the seed', () => {
    const png = fakePng(8, 4, 3)
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(new DataView(png.buffer, png.byteOffset).getUint32(16)).toBe(8)
    expect(new DataView(png.buffer, png.byteOffset).getUint32(20)).toBe(4)
    expect(fakePng(8, 4, 4)).not.toEqual(png)
  })
  it('fails for a prompt that says fail', async () => {
    const generator = createFakeImages(0)
    const request = { prompt: 'a room', width: 64, height: 32, seed: 1, model: 'klein' as const }
    expect((await generator.generate(request)).seed).toBe(1)
    await expect(generator.generate({ ...request, prompt: 'fail' })).rejects.toThrow('memory')
  })
})
