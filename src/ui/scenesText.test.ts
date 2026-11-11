import { describe, expect, it } from 'bun:test'
import type { SceneRow } from '../core/scenes'
import {
  measureWhy,
  refreshWhy,
  saveWhy,
  changeWord,
  suggestionLine,
  limitLine,
  howItPlays,
  levelText,
  listCount,
  measuredLine,
  statesLine,
  trackProblemChip,
} from './scenesText'

describe('how an effect plays', () => {
  it('is written as the page words it', () => {
    expect(howItPlays({ mode: 'loop' })).toBe('Round and round')
    expect(howItPlays({ mode: 'random', everySeconds: [15, 30] })).toBe(
      'Now and then, every 15–30 s',
    )
    expect(howItPlays({ mode: 'once', afterSeconds: 1.5 })).toBe('Once, 1.5 s after entering')
    expect(howItPlays({ mode: 'trigger', trigger: 'door-opens' })).toBe('On a trigger: door-opens')
  })
})

describe('a level', () => {
  it('is a whole percent', () => {
    expect(levelText(1)).toBe('100%')
    expect(levelText(0.6)).toBe('60%')
    expect(levelText(0.625)).toBe('63%')
    expect(levelText(3)).toBe('300%')
    expect(levelText(0)).toBe('0%')
  })
})

describe('what a scene list row says', () => {
  const row = (over: Partial<SceneRow>, effects = 0) =>
    ({ gone: 0, silent: 0, unreadable: false, effects: new Array(effects), ...over }) as SceneRow

  it('counts effects, none when there are none', () => {
    expect(listCount(row({}, 2))).toEqual({ text: '2 effects', red: false })
    expect(listCount(row({}, 1))).toEqual({ text: '1 effect', red: false })
    expect(listCount(row({}, 0))).toEqual({ text: 'none', red: false })
  })

  it('counts what is gone before what is silent, in red', () => {
    expect(listCount(row({ gone: 1, silent: 1 }, 3))).toEqual({ text: '1 gone', red: true })
    expect(listCount(row({ silent: 2 }, 3))).toEqual({ text: '2 silent', red: true })
  })

  it('says a scene that cannot be read is unreadable, in red', () => {
    expect(listCount(row({ unreadable: true }))).toEqual({ text: 'unreadable', red: true })
  })
})

describe('the line under the scene’s name', () => {
  it('lists the states and the triggers', () => {
    expect(statesLine({ states: ['plain', 'cat-home'], triggers: ['door-opens'] })).toBe(
      'States: plain, cat-home · Triggers: door-opens',
    )
  })
  it('says none for what the scene has none of', () => {
    expect(statesLine({ states: [], triggers: [] })).toBe('No states · No triggers')
    expect(statesLine({ states: [], triggers: ['bell-tolls'] })).toBe(
      'States: none · Triggers: bell-tolls',
    )
    expect(statesLine({ states: ['plain'], triggers: [] })).toBe('States: plain · Triggers: none')
  })
})

describe('the chip beside a track that plays nothing', () => {
  it('is red and names the missing take', () => {
    expect(trackProblemChip('Village lane', { kind: 'take', take: 3 })).toEqual({
      text: 'file not there',
      title: 'Take 3 of Village lane is not there.',
      tone: 'danger',
    })
  })
  it('is red and names the missing game file', () => {
    expect(
      trackProblemChip('Village lane', { kind: 'file', file: 'music/village-lane.wav' }),
    ).toEqual({
      text: 'file not there',
      title: "The game's file village-lane.wav is not there.",
      tone: 'danger',
    })
  })
  it('is amber when there is nothing to play at all', () => {
    expect(trackProblemChip('Village lane', { kind: 'nothing' })).toEqual({
      text: 'no take chosen',
      title: undefined,
      tone: 'warn',
    })
  })
})

describe('what a scene list row says of its loudness', () => {
  const target = { target: -20, tolerance: 2 }
  const measure = (lufs: (number | null)[], error: string | null = null) => ({
    measuredAt: '2026-11-05T14:02:00.000Z',
    entry: null,
    clips: {},
    states: lufs.map((l, i) => ({ state: `s${i}`, lufs: l })),
    without: [],
    error,
  })
  const row = (over: Partial<SceneRow>, effects = 1) =>
    ({
      gone: 0,
      silent: 0,
      unreadable: false,
      effects: new Array(effects),
      loudness: { saved: null, draft: null },
      ...over,
    }) as SceneRow

  it('says too loud, too quiet or off target in amber, in place of the count', () => {
    const saved = (l: (number | null)[]) => row({ loudness: { saved: measure(l), draft: null } })
    expect(listCount(saved([-15]), target)).toEqual({ text: 'too loud', red: false, warn: true })
    expect(listCount(saved([-25]), target)).toEqual({ text: 'too quiet', red: false, warn: true })
    expect(listCount(saved([-25, -15]), target)).toEqual({
      text: 'off target',
      red: false,
      warn: true,
    })
  })

  it('leaves the count when on target, with nothing playing, or never measured', () => {
    const plain = { text: '1 effect', red: false }
    expect(listCount(row({ loudness: { saved: measure([-19]), draft: null } }), target)).toEqual(
      plain,
    )
    expect(listCount(row({ loudness: { saved: measure([null]), draft: null } }), target)).toEqual(
      plain,
    )
    expect(listCount(row({}), target)).toEqual(plain)
  })

  it('lets a red problem win the column', () => {
    const loud = { saved: measure([-10]), draft: null }
    expect(listCount(row({ silent: 1, loudness: loud }), target)).toEqual({
      text: '1 silent',
      red: true,
    })
  })

  it('flags nothing without a target', () => {
    const loud = { saved: measure([-10]), draft: null }
    expect(listCount(row({ loudness: loud }), null)).toEqual({ text: '1 effect', red: false })
  })

  it('falls back to the draft measure when the scene was never measured saved', () => {
    expect(listCount(row({ loudness: { saved: null, draft: measure([-10]) } }), target).text).toBe(
      'too loud',
    )
  })
})

describe('when a scene was measured', () => {
  const now = new Date(2026, 10, 5, 15, 30)
  it('says today and yesterday with the time, an older day with its date', () => {
    expect(measuredLine(new Date(2026, 10, 5, 14, 2).toISOString(), now)).toBe(
      'Measured today 14:02',
    )
    expect(measuredLine(new Date(2026, 10, 4, 16, 40).toISOString(), now)).toBe(
      'Measured yesterday 16:40',
    )
    expect(measuredLine(new Date(2026, 10, 3, 9, 5).toISOString(), now)).toBe(
      'Measured 3 Nov 09:05',
    )
  })
})

describe('the loudness suggestion line', () => {
  const full = (l: ReturnType<typeof suggestionLine>) => l.before + l.strong + l.after
  it('words a change, with one decimal', () => {
    expect(changeWord(4)).toBe('4.0 dB louder')
    expect(changeWord(-3.4)).toBe('3.4 dB quieter')
  })
  it('words the plain change for both states, one state and more', () => {
    const base = { kind: 'change', db: 4, closest: null, ceiling: null } as const
    expect(full(suggestionLine({ ...base, states: 2 }, 2))).toBe(
      'Make the whole scene 4.0 dB louder — music and every effect by the same amount — to bring both states within the target.',
    )
    expect(suggestionLine({ ...base, states: 1 }, 2).after).toContain('to bring it within')
    expect(suggestionLine({ ...base, states: 3 }, 2).after).toContain('to bring every state within')
    expect(suggestionLine({ ...base, states: 2 }, 2).button).toBe('Make 4.0 dB louder')
  })
  it('words the closest change, the ceiling and the change that helps nothing', () => {
    expect(
      full(
        suggestionLine(
          {
            kind: 'change',
            db: 1.6,
            states: 2,
            closest: { apart: 4.4, leaving: 0.2 },
            ceiling: null,
          },
          2,
        ),
      ),
    ).toBe(
      'No single change brings both states within ± 2 dB: they are 4.4 dB apart. 1.6 dB louder comes closest, leaving each 0.2 dB off.',
    )
    expect(
      full(
        suggestionLine(
          {
            kind: 'change',
            db: 1.2,
            states: 2,
            closest: null,
            ceiling: {
              sound: 'cat-purr',
              still: [
                { name: 'plain', db: 2.2 },
                { name: 'cat-home', db: 3.4 },
              ],
            },
          },
          2,
        ),
      ),
    ).toBe(
      'Make the whole scene 1.2 dB louder — as far as it goes before cat-purr passes 300%. plain would still be 2.2 dB and cat-home 3.4 dB too quiet; turn cat-purr down or the others up by hand to go further.',
    )
    const words = (still: { name: string; db: number }[]) =>
      full(
        suggestionLine(
          {
            kind: 'change',
            db: 1.2,
            states: still.length,
            closest: null,
            ceiling: { sound: 'cat-purr', still },
          },
          2,
        ),
      )
    expect(words([{ name: 'The scene', db: 13.6 }])).toContain(
      'cat-purr passes 300%. The scene would still be 13.6 dB too quiet; turn',
    )
    expect(words([{ name: 'cat-home', db: 2.2 }])).toContain(
      '300%. cat-home would still be 2.2 dB too quiet; turn',
    )
    expect(
      words([
        { name: 'plain', db: 1 },
        { name: 'rain', db: 2.2 },
        { name: 'night', db: 3.4 },
      ]),
    ).toContain('300%. plain would still be 1.0 dB, rain 2.2 dB and night 3.4 dB too quiet; turn')
    const none = suggestionLine({ kind: 'none', loud: ['plain'], quiet: ['cat-home'] }, 2)
    expect(none.before).toBe(
      'No single change helps: plain is too loud and cat-home too quiet. Bring them closer in the scene’s levels.',
    )
    expect(none.button).toBeNull()
  })
})

describe('limitLine', () => {
  const head = 'No change can make the whole scene louder: '
  const say = (sounds: { name: string; level: number }[], every = false) =>
    limitLine({ kind: 'limit', sounds, every })
  const plain = (l: ReturnType<typeof limitLine>) => l.map((p) => p.text).join('')
  const bold = (l: ReturnType<typeof limitLine>) => l.filter((p) => p.strong).map((p) => p.text)

  it('words one sound, with its real level', () => {
    const l = say([{ name: 'door-creak', level: 299 }])
    expect(plain(l)).toBe(
      head +
        'door-creak is at 299%, as loud as it goes. Turn door-creak down or the others up by hand.',
    )
    expect(bold(l)).toEqual(['door-creak'])
  })
  it('words several sounds at the same level', () => {
    const l = say([
      { name: 'door-creak', level: 300 },
      { name: 'rain', level: 300 },
      { name: 'wind-howl', level: 300 },
    ])
    expect(plain(l)).toBe(
      head +
        'door-creak, rain and wind-howl are at 300%, as loud as they go. Turn them down or the others up by hand.',
    )
    expect(bold(l)).toEqual(['door-creak', 'rain', 'wind-howl'])
  })
  it('gives each sound its level when they differ', () => {
    expect(
      plain(
        say([
          { name: 'door-creak', level: 299 },
          { name: 'rain', level: 300 },
        ]),
      ),
    ).toBe(
      head +
        'door-creak (299%) and rain (300%) are as loud as they go. Turn them down or the others up by hand.',
    )
  })
  it('words the music', () => {
    expect(plain(say([{ name: 'the music', level: 300 }]))).toBe(
      head +
        'the music is at 300%, as loud as it goes. Turn the music down or the others up by hand.',
    )
  })
  it('words a scene where every sound is at the limit', () => {
    expect(
      plain(
        say(
          [
            { name: 'a', level: 300 },
            { name: 'b', level: 300 },
          ],
          true,
        ),
      ),
    ).toBe(
      head +
        'every sound in it is at 300%, as loud as it goes. The sounds themselves are too quiet for the target.',
    )
  })
})

describe('the reasons a scene control is greyed', () => {
  it('Save names the thing to fix before the thing to wait for, and nothing to save last of the page’s own', () => {
    expect(saveWhy({ dirty: true, red: true, saving: true })).toContain('needs fixing')
    expect(saveWhy({ dirty: true, red: false, saving: true })).toBe(
      'The scene is being saved. Wait for it to finish.',
    )
    expect(saveWhy({ dirty: false, red: false, saving: false })).toContain('nothing to save')
    expect(saveWhy({ dirty: true, red: false, saving: false })).toBe(false)
  })

  it('Refresh from the game and the loudness buttons name what to wait for', () => {
    expect(refreshWhy(true)).toBe('Wait for the refresh from the game to finish.')
    expect(refreshWhy(false)).toBe(false)
    expect(measureWhy(true)).toBe('Loudness is being measured. Wait for it to finish.')
    expect(measureWhy(false)).toBe(false)
  })
})
