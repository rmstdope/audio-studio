import { describe, expect, it } from 'bun:test'
import { SETTINGS_FILE, SettingsSchema } from './settings'

describe('SettingsSchema', () => {
  it('is kept in the cache, so it is never committed', () => {
    expect(SETTINGS_FILE).toBe('content-studio/cache/settings.json')
  })

  it('takes nothing, a Fish tier and a take fade', () => {
    expect(SettingsSchema.parse({})).toEqual({})
    expect(SettingsSchema.parse({ fishTier: '100', takeFade: 0.3 })).toEqual({
      fishTier: '100',
      takeFade: 0.3,
    })
  })

  it('refuses a tier the studio does not know and a fade below 0', () => {
    expect(SettingsSchema.safeParse({ fishTier: '50' }).success).toBe(false)
    expect(SettingsSchema.safeParse({ takeFade: -1 }).success).toBe(false)
  })
})
