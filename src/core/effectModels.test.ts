import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_EFFECT_MODEL,
  EFFECT_MODEL_IDS,
  defaultEffectModel,
  effectMenuEntry,
  effectModel,
  effectSaveFailureHeading,
  effectSwitchedLine,
  effectWarning,
  type EffectModelState,
} from './effectModels'
import { EffectHealthSchema } from './effectHealth'

describe('the sound-effect models', () => {
  it('has Stable Audio 3 Small SFX, downloaded from its gated repository', () => {
    expect(EFFECT_MODEL_IDS).toEqual(['small-sfx', 'open-1'])
    expect(effectModel('small-sfx')).toMatchObject({
      name: 'Stable Audio 3 Small SFX',
      repo: 'stabilityai/stable-audio-3-small-sfx',
      gigabytes: 6.5,
    })
  })
})

describe('both models', () => {
  const whole: EffectModelState = { download: 'whole', failed: false }
  const states = (small: EffectModelState, open: EffectModelState) => ({
    'small-sfx': small,
    'open-1': open,
  })

  it('has Stable Audio Open 1.0, found in the Stable Audio folder', () => {
    expect(DEFAULT_EFFECT_MODEL).toBe('small-sfx')
    expect(effectModel('open-1')).toMatchObject({
      name: 'Stable Audio Open 1.0',
      seconds: 100,
      source: { kind: 'folder', folder: 'stable-audio-open-1.0' },
    })
    expect(effectModel('small-sfx').source).toEqual({ kind: 'hub' })
  })

  it('writes a menu entry with the time and what is wrong', () => {
    expect(effectMenuEntry('small-sfx', whole)).toBe('Stable Audio 3 Small SFX — about 2 s a take')
    expect(effectMenuEntry('open-1', whole)).toBe('Stable Audio Open 1.0 — about 100 s a take')
    expect(effectMenuEntry('open-1', { download: 'absent', failed: false })).toBe(
      'Stable Audio Open 1.0 — about 100 s a take — not on this computer',
    )
    expect(effectMenuEntry('small-sfx', { download: 'partial', failed: false })).toBe(
      'Stable Audio 3 Small SFX — about 2 s a take — download incomplete',
    )
    expect(effectMenuEntry('small-sfx', { download: 'whole', failed: true })).toBe(
      'Stable Audio 3 Small SFX — about 2 s a take — last effect failed',
    )
    expect(effectWarning(whole)).toBeNull()
    expect(effectWarning({ download: 'absent', failed: true })).toBe('not on this computer')
  })

  it('starts takes on the project model, else on the other that can run, else a failed one', () => {
    const absent: EffectModelState = { download: 'absent', failed: false }
    const failed: EffectModelState = { download: 'whole', failed: true }
    expect(defaultEffectModel('small-sfx', states(whole, whole), true)).toBe('small-sfx')
    expect(defaultEffectModel('open-1', states(whole, whole), true)).toBe('open-1')
    expect(defaultEffectModel('small-sfx', states(absent, whole), true)).toBe('open-1')
    expect(defaultEffectModel('small-sfx', states(failed, whole), true)).toBe('open-1')
    expect(defaultEffectModel('small-sfx', states(failed, absent), true)).toBe('small-sfx')
    expect(defaultEffectModel('small-sfx', states(failed, failed), true)).toBe('small-sfx')
    expect(defaultEffectModel('open-1', states(absent, absent), true)).toBe('open-1')
    expect(defaultEffectModel('small-sfx', states(absent, whole), false)).toBe('small-sfx')
  })

  it('says why takes start on the other model', () => {
    expect(effectSwitchedLine('small-sfx', 'open-1', 'absent')).toBe(
      "Stable Audio 3 Small SFX, the project's sound-effects model, isn't on this computer, so these takes use Stable Audio Open 1.0. Setup says how to download it.",
    )
    expect(effectSwitchedLine('small-sfx', 'open-1', 'partial')).toBe(
      "Stable Audio 3 Small SFX, the project's sound-effects model, is only partly downloaded, so these takes use Stable Audio Open 1.0. Setup says how to finish it.",
    )
    expect(effectSwitchedLine('open-1', 'small-sfx', 'failed')).toBe(
      "Stable Audio Open 1.0, the project's sound-effects model, failed on its last effect, so these takes use Stable Audio 3 Small SFX. Setup says what went wrong.",
    )
  })

  it('words a failed save', () => {
    expect(effectSaveFailureHeading('open-1')).toBe(
      'Stable Audio Open 1.0 could not be saved as the sound-effects model.',
    )
  })
})

describe('the effect health file', () => {
  it('holds a failed last effect per model, and nothing by default', () => {
    expect(EffectHealthSchema.parse({}).models).toEqual({})
    const failed = { error: 'RuntimeError: x', at: '2026-11-03T10:00:00.000Z' }
    expect(
      EffectHealthSchema.parse({ models: { 'small-sfx': failed } }).models['small-sfx'],
    ).toEqual(failed)
    expect(EffectHealthSchema.safeParse({ models: { other: failed } }).success).toBe(false)
  })
})
