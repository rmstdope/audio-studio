import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_MUSIC_MODEL,
  MUSIC_MODELS,
  eachWords,
  MUSIC_GROUPS,
  canMake,
  lengthReason,
  longestFor,
  menuEntry,
  missingOnTrack,
  shortMenuLabel,
  setupShortLine,
  tooLongOnTrack,
  saveFailureHeading,
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
    expect(MUSIC_MODELS.map((m) => m.id)).toEqual([
      'balanced',
      'quick',
      'quickest',
      'careful',
      'short',
      'shortest',
    ])
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

describe('the Stable Audio models', () => {
  test('are named Short and Shortest, with their own recipes and folders', () => {
    expect(modelLine('stable-audio-open-1.0')).toBe('Short · Stable Audio Open 1.0')
    expect(modelLine('stable-audio-open-small')).toBe('Shortest · Stable Audio Open Small')
    expect(musicModel('short').folders).toEqual(['stable-audio-open-1.0'])
    expect(musicModel('shortest').folders).toEqual(['stable-audio-open-small'])
  })
  test('the menus have two groups under headings', () => {
    expect(MUSIC_GROUPS).toEqual([
      { heading: 'ACE-Step · any length', ids: ['balanced', 'quick', 'quickest', 'careful'] },
      { heading: 'Stable Audio · short music only', ids: ['short', 'shortest'] },
    ])
  })
  test('the longest loop is the longest piece less what a loop is made longer by', () => {
    expect(longestFor('short', 'loop')).toBe(27)
    expect(longestFor('shortest', 'loop')).toBe(0)
    expect(longestFor('short', 'stinger')).toBeNull()
    expect(longestFor('balanced', 'loop')).toBeNull()
  })
  test('every stinger can be made by every model', () => {
    for (const { id } of MUSIC_MODELS) expect(canMake(id, 'stinger', 10)).toBe(true)
  })
  test('a loop too long is refused, with the reason in the agreed words', () => {
    expect(canMake('short', 'loop', 27)).toBe(true)
    expect(canMake('short', 'loop', 28)).toBe(false)
    expect(lengthReason('short', 'loop', 90)).toBe('makes loops up to 27 s · this one is 1:30')
    expect(lengthReason('shortest', 'loop', 90)).toBe('makes no loops · this one is 1:30')
    expect(lengthReason('short', 'loop', 20)).toBeNull()
    expect(lengthReason('balanced', 'loop', 130)).toBeNull()
  })
  test('the entry shows the reason in place of the time, and the reason wins over missing', () => {
    const track = { kind: 'loop', seconds: 90 } as const
    expect(menuEntry('short', true)).toBe('Short · Stable Audio Open 1.0 — about 40 s a take')
    expect(menuEntry('shortest', true)).toBe(
      'Shortest · Stable Audio Open Small — about 10 s a take',
    )
    expect(menuEntry('short', true, track)).toBe(
      'Short · Stable Audio Open 1.0 — makes loops up to 27 s · this one is 1:30',
    )
    expect(menuEntry('short', false, track)).toBe(
      'Short · Stable Audio Open 1.0 — makes loops up to 27 s · this one is 1:30',
    )
    expect(menuEntry('short', false, { kind: 'stinger', seconds: 5 })).toBe(
      'Short · Stable Audio Open 1.0 — about 40 s a take — not on this computer',
    )
  })
  test('under a track’s menu, what the picked model cannot do', () => {
    expect(tooLongOnTrack('short', 'loop', 90)).toBe(
      'Short makes loops up to 27 s, and this one is 1:30. Pick another model for these takes.',
    )
    expect(tooLongOnTrack('shortest', 'loop', 90)).toBe(
      'Shortest makes no loops, and this one is 1:30. Pick another model for these takes.',
    )
    expect(tooLongOnTrack('short', 'loop', 20)).toBeNull()
  })
  test('each take takes about this many seconds', () => {
    expect(eachWords('short')).toBe('about 40 seconds each')
  })
  test('Setup says what a short default means, and how many loops it leaves out', () => {
    const loops = [20, 90, 100, 130]
    expect(setupShortLine('short', loops)).toBe(
      'Short makes stingers, and loops up to 27 s. 3 loops are longer: their takes will need another model, picked on their page.',
    )
    expect(setupShortLine('short', [20, 30])).toBe(
      'Short makes stingers, and loops up to 27 s. 1 loop is longer: its takes will need another model, picked on their page.',
    )
    expect(setupShortLine('short', [20])).toBe('Short makes stingers, and loops up to 27 s.')
    expect(setupShortLine('shortest', [20, 90])).toBe(
      'Shortest makes stingers, and no loops. 2 loops will need another model, picked on their page.',
    )
    expect(setupShortLine('shortest', [5])).toBe(
      'Shortest makes stingers, and no loops. 1 loop will need another model, picked on their page.',
    )
    expect(setupShortLine('shortest', [])).toBe('Shortest makes stingers, and no loops.')
    expect(setupShortLine('balanced', loops)).toBeNull()
  })
})

describe('the words around the menus', () => {
  test('how long each take takes, for the empty state', () => {
    expect(eachWords('balanced')).toBe('about 3 minutes each')
    expect(eachWords('quick')).toBe('about 1¼ minutes each')
    expect(eachWords('quickest')).toBe('about 1 minute each')
  })
  test('a model missing here, under a track’s menu', () => {
    expect(missingOnTrack('careful')).toBe(
      "Careful isn't on this computer. Pick another model for these takes, or see Setup for how to download it.",
    )
  })
  test('a failed save names the model picked', () => {
    expect(saveFailureHeading('quick')).toBe('Quick could not be saved as the music model.')
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
  test('accepts the Stable Audio models', () => {
    for (const model of ['short', 'shortest']) {
      expect(ProjectSchema.safeParse(projectJson({ music: { ...music, model } })).success).toBe(
        true,
      )
    }
  })
  test('refuses an unknown one, naming where', () => {
    const result = ProjectSchema.safeParse(projectJson({ music: { ...music, model: 'huge' } }))
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['music', 'model'])
  })
})

describe('the closed menu’s short label', () => {
  const loop90 = { kind: 'loop', seconds: 90 } as const
  test('the plain name and the time', () => {
    expect(shortMenuLabel('balanced', true)).toBe('Balanced — about 3 min a take')
    expect(shortMenuLabel('careful', true)).toBe('Careful — about 7 min a take')
    expect(shortMenuLabel('quick', true)).toBe('Quick — about 1¼ min a take')
    expect(shortMenuLabel('short', true)).toBe('Short — about 40 s a take')
  })
  test('a missing model says so in place of the time', () => {
    expect(shortMenuLabel('careful', false)).toBe('Careful — not on this computer')
  })
  test('a model too short for the track says what it makes, without the length, and wins', () => {
    expect(shortMenuLabel('short', true, loop90)).toBe('Short — makes loops up to 27 s')
    expect(shortMenuLabel('short', false, loop90)).toBe('Short — makes loops up to 27 s')
    expect(shortMenuLabel('shortest', true, loop90)).toBe('Shortest — makes no loops')
    expect(shortMenuLabel('short', true, { kind: 'stinger', seconds: 5 })).toBe(
      'Short — about 40 s a take',
    )
  })
})
