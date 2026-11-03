import { describe, expect, it } from 'bun:test'
import { EFFECT_MODEL_IDS, effectModel } from './effectModels'
import { EffectHealthSchema } from './effectHealth'

describe('the sound-effect models', () => {
  it('has Stable Audio 3 Small SFX, downloaded from its gated repository', () => {
    expect(EFFECT_MODEL_IDS).toEqual(['small-sfx'])
    expect(effectModel('small-sfx')).toMatchObject({
      name: 'Stable Audio 3 Small SFX',
      repo: 'stabilityai/stable-audio-3-small-sfx',
      gigabytes: 6.5,
    })
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
