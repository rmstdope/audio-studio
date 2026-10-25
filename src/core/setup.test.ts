import { describe, expect, it } from 'bun:test'
import { setupChecks, type SetupFacts } from './setup'

const ready: SetupFacts = {
  ffmpeg: true,
  uv: true,
  appleSilicon: true,
  transcriber: 'mlx-whisper',
  whisperModel: 'mlx-community/whisper-large-v3-turbo',
  envPath: '.env',
  key: true,
  fish: { ok: true, credit: 12.5 },
  refreshDialog: true,
}

const byId = (facts: SetupFacts) => Object.fromEntries(setupChecks(facts).map((c) => [c.id, c]))

describe('setupChecks', () => {
  it('finds everything in place on a ready machine', () => {
    const checks = setupChecks(ready)
    expect(checks.map((c) => c.id)).toEqual(['ffmpeg', 'whisper', 'key', 'fish', 'refresh'])
    expect(checks.every((c) => c.state === 'ok')).toBe(true)
    expect(byId(ready).fish!.detail).toContain('$12.50')
  })

  it('names what is missing, and how to put it right', () => {
    const checks = byId({ ...ready, ffmpeg: false, uv: false, key: false })
    expect(checks.ffmpeg).toMatchObject({
      state: 'problem',
      fix: expect.stringContaining('brew install ffmpeg'),
    })
    expect(checks.whisper).toMatchObject({
      state: 'problem',
      fix: expect.stringContaining('brew install uv'),
    })
    // One matcher: a matcher used on a property replaces it in the object under bun test.
    expect(checks.key).toMatchObject({
      state: 'problem',
      fix: expect.stringMatching(/FISH_AUDIO_API_KEY=.*\.env/),
    })
  })

  it('says Whisper needs Apple silicon, or that checking is off', () => {
    expect(byId({ ...ready, appleSilicon: false }).whisper).toMatchObject({
      state: 'problem',
      fix: expect.stringContaining('"none"'),
    })
    expect(byId({ ...ready, transcriber: 'none', uv: false }).whisper).toMatchObject({
      state: 'off',
    })
  })

  it('reports Fish not answering, and does not ask Fish without a key', () => {
    const silent = byId({
      ...ready,
      fish: { ok: false, reason: 'fish', message: 'Fish Audio answered 401: bad key' },
    })
    expect(silent.fish).toMatchObject({ state: 'problem', detail: expect.stringContaining('401') })
    const noKey = byId({
      ...ready,
      key: false,
      fish: { ok: false, reason: 'no-key', message: 'x' },
    })
    expect(noKey.fish!.state).toBe('off')
  })

  it('treats refreshDialog as optional', () => {
    expect(byId({ ...ready, refreshDialog: false }).refresh!.state).toBe('off')
  })
})
