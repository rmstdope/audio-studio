import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { CreditResult } from './fish'
import { checkSetup, type Machine } from './setup'

const credit = async (): Promise<CreditResult> => ({ ok: true, credit: 3 })
const mac: Machine = { which: () => true, platform: 'darwin', arch: 'arm64' }
const byId = (checks: { id: string; state: string }[]) =>
  Object.fromEntries(checks.map((c) => [c.id, c.state]))

describe('checkSetup', () => {
  it('finds the tools, the key in the env file, and asks Fish', async () => {
    const root = tempRepo({ 'audio-studio.json': projectJson(), '.env': 'FISH_AUDIO_API_KEY=k\n' })
    const result = await checkSetup(join(root, 'audio-studio.json'), credit, mac, {})
    if (!result.ok) throw new Error('expected checks')
    expect(result.checks.find((c) => c.id === 'fish')).toMatchObject({ credit: 3 })
    expect(byId(result.checks)).toEqual({
      ffmpeg: 'ok',
      whisper: 'ok',
      key: 'ok',
      fish: 'ok',
      requests: 'ok',
      refresh: 'off',
    })
  })

  it('asks the machine for each tool, and Fish not at all without a key', async () => {
    const root = tempRepo({ 'audio-studio.json': projectJson() })
    let asked = 0
    const machine: Machine = { which: (c) => c === 'uv', platform: 'linux', arch: 'x64' }
    const result = await checkSetup(
      join(root, 'audio-studio.json'),
      async () => {
        asked++
        return { ok: true, credit: 3 }
      },
      machine,
      {},
    )
    if (!result.ok) throw new Error('expected checks')
    expect(byId(result.checks)).toEqual({
      ffmpeg: 'problem',
      whisper: 'problem',
      key: 'problem',
      fish: 'off',
      requests: 'off',
      refresh: 'off',
    })
    expect(asked).toBe(0)
  })

  it('takes the key from the environment too, and reports Fish not answering', async () => {
    const root = tempRepo({ 'audio-studio.json': projectJson() })
    const silent = async (): Promise<CreditResult> => ({
      ok: false,
      reason: 'fish',
      message: 'Fish Audio answered 401',
    })
    const result = await checkSetup(join(root, 'audio-studio.json'), silent, mac, {
      FISH_AUDIO_API_KEY: 'k',
    })
    if (!result.ok) throw new Error('expected checks')
    expect(result.checks.find((c) => c.id === 'fish')).toMatchObject({
      state: 'problem',
      detail: expect.stringContaining('401'),
    })
  })

  it('says when the project file cannot be read', async () => {
    const root = tempRepo({ 'audio-studio.json': { name: 3 } })
    const result = await checkSetup(join(root, 'audio-studio.json'), credit, mac, {})
    expect(result.ok).toBe(false)
  })
})
