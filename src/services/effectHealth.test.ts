import { describe, expect, it } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { createEffectHealth } from './effectHealth'

const failure = { error: 'RuntimeError: out of memory' }

describe('the effect models health', () => {
  it('knows no failure before one is recorded', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson() })
    expect(await createEffectHealth().read(join(root, 'content-studio.json'))).toEqual({})
  })

  it('records a failure, replaces it, and clears it', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson() })
    const file = join(root, 'content-studio.json')
    const health = createEffectHealth({ now: () => new Date('2026-11-03T10:00:00Z') })
    await health.record(file, 'small-sfx', failure)
    await health.record(file, 'small-sfx', { error: 'second' })
    expect((await health.read(file))['small-sfx']).toEqual({
      error: 'second',
      at: '2026-11-03T10:00:00.000Z',
    })
    await health.clear(file, 'small-sfx')
    expect(await health.read(file)).toEqual({})
  })

  it('is remembered by a new store on the same project (a restart)', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson() })
    const file = join(root, 'content-studio.json')
    await createEffectHealth().record(file, 'small-sfx', failure)
    expect((await createEffectHealth().read(file))['small-sfx']?.error).toBe(failure.error)
    expect(existsSync(join(root, 'content-studio/cache/effect-model-health.json'))).toBe(true)
  })

  it('writes nothing when there is nothing to clear, and reads a broken file as no failures', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson() })
    const file = join(root, 'content-studio.json')
    const health = createEffectHealth()
    await health.clear(file, 'small-sfx')
    expect(existsSync(join(root, 'content-studio/cache/effect-model-health.json'))).toBe(false)
    await health.record(file, 'small-sfx', failure)
    writeFileSync(join(root, 'content-studio/cache/effect-model-health.json'), '{nope')
    expect(await health.read(file)).toEqual({})
  })
})
