import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { createImageHealth } from './imageHealth'

const failure = { image: 'inn', take: 3, error: 'FileNotFoundError: x.safetensors' }

describe('the image models health', () => {
  it('knows no failure before one is recorded', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson() })
    expect(await createImageHealth().read(join(root, 'content-studio.json'))).toEqual({})
  })

  it('records a failure per model, replaces it, and clears it', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson() })
    const file = join(root, 'content-studio.json')
    const health = createImageHealth({ now: () => new Date('2026-10-31T10:00:00Z') })
    await health.record(file, 'klein', failure)
    await health.record(file, 'z-image-turbo', { ...failure, take: 1 })
    await health.record(file, 'klein', { ...failure, take: 4 })
    const read = await health.read(file)
    expect(read.klein).toEqual({ ...failure, take: 4, at: '2026-10-31T10:00:00.000Z' })
    expect(read['z-image-turbo']?.take).toBe(1)
    await health.clear(file, 'klein')
    expect(Object.keys(await health.read(file))).toEqual(['z-image-turbo'])
  })

  it('is remembered by a new store on the same project (a restart)', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson() })
    const file = join(root, 'content-studio.json')
    await createImageHealth().record(file, 'klein', failure)
    expect((await createImageHealth().read(file)).klein?.error).toBe(failure.error)
    expect(existsSync(join(root, '.content-studio/image-model-health.json'))).toBe(true)
  })

  it('writes nothing when there is nothing to clear, and reads a broken file as no failures', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson() })
    const file = join(root, 'content-studio.json')
    const health = createImageHealth()
    await health.clear(file, 'klein')
    expect(existsSync(join(root, '.content-studio/image-model-health.json'))).toBe(false)
    await health.record(file, 'klein', failure)
    writeFileSync(join(root, '.content-studio/image-model-health.json'), '{nope')
    expect(await health.read(file)).toEqual({})
    // A broken file is replaced by the next record, not kept.
    await health.record(file, 'klein', failure)
    expect(
      JSON.parse(readFileSync(join(root, '.content-studio/image-model-health.json'), 'utf8')).models
        .klein.take,
    ).toBe(3)
  })
})
