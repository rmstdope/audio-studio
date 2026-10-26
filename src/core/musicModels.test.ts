import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_MUSIC_MODEL,
  MUSIC_MODELS,
  menuEntry,
  modelLine,
  modelOfRecipe,
  musicModel,
} from './musicModels'
import { ProjectSchema } from './project'
import { projectJson } from '../../test/helpers'

describe('the music models', () => {
  test('Balanced is the default and the recipe used before models were chosen', () => {
    expect(DEFAULT_MUSIC_MODEL).toBe('balanced')
    expect(musicModel('balanced').recipe).toBe('acestep-v15-xl-turbo+lm-4B')
  })

  test('every model has its own recipe and folders', () => {
    expect(new Set(MUSIC_MODELS.map((m) => m.recipe)).size).toBe(MUSIC_MODELS.length)
    expect(MUSIC_MODELS.map((m) => m.id)).toEqual(['balanced', 'quick', 'quickest', 'careful'])
    expect(musicModel('careful').folders).toEqual(['acestep-v15-xl-sft', 'acestep-5Hz-lm-4B'])
    expect(musicModel('quickest').folders).toEqual(['acestep-v15-turbo', 'acestep-5Hz-lm-1.7B'])
  })

  test('a take with no model, or with the first recipe, was made by Balanced', () => {
    expect(modelOfRecipe(undefined)?.id).toBe('balanced')
    expect(modelOfRecipe('acestep-v15-xl-sft+lm-4B')?.id).toBe('careful')
    expect(modelOfRecipe('something-else')).toBeNull()
  })

  test('a take names its model plainly, then the generator', () => {
    expect(modelLine(undefined)).toBe('Balanced · XL turbo · 4B')
    expect(modelLine('acestep-v15-turbo+lm-1.7B')).toBe('Quickest · Turbo · 1.7B')
    expect(modelLine('something-else')).toBe('something-else')
  })

  test('a menu entry says how long a take takes, and when the files are missing', () => {
    expect(menuEntry('balanced', true)).toBe('Balanced · XL turbo · 4B — about 3 min a take')
    expect(menuEntry('quick', true)).toBe('Quick · XL turbo · 1.7B — about 1¼ min a take')
    expect(menuEntry('quickest', true)).toBe('Quickest · Turbo · 1.7B — about 1 min a take')
    expect(menuEntry('careful', false)).toBe(
      'Careful · XL sft · 4B — about 7 min a take — not on this computer',
    )
  })
})

describe('music.model in the project file', () => {
  const music = {
    paths: {
      loops: 'l/{part}.json',
      stingers: 's.json',
      briefs: 'b.json',
      lock: 'k.json',
      clips: 'c',
      manifest: 'm.json',
    },
  }
  test('accepts a known model, and none', () => {
    const known = projectJson({ music: { ...music, model: 'careful' } })
    expect(ProjectSchema.safeParse(known).success).toBe(true)
    expect(ProjectSchema.safeParse(projectJson({ music })).success).toBe(true)
  })
  test('refuses an unknown one, naming where', () => {
    const result = ProjectSchema.safeParse(projectJson({ music: { ...music, model: 'huge' } }))
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['music', 'model'])
  })
})
