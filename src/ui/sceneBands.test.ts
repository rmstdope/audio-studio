import { describe, expect, it } from 'bun:test'
import type { LineState, SceneState } from '../core/planner'
import {
  bandCount,
  bandsBefore,
  followersHint,
  sceneCueWithoutOwn,
  tableRows,
  warningText,
} from './sceneBands'

function line(key: string, scene: string | null): LineState {
  return {
    key,
    speaker: 'narrator',
    text: 'Hello.',
    english: null,
    cue: '',
    cueFrom: 'style',
    scene,
    followsScene: false,
    sourceCue: null,
    final: false,
    status: 'missing',
    reasons: [],
    heard: null,
    accepted: false,
    duration: null,
    file: null,
  }
}

const all = [
  line('a', 'Cave'),
  line('b', 'Cave'),
  line('c', null),
  line('d', 'Meadow'),
  line('e', 'Cave'),
]

/** The rows as `band:<title>` and the line keys. */
const shape = (rows: ReturnType<typeof tableRows>) =>
  rows.map((row) => (row.kind === 'band' ? `band:${row.title}` : row.line.key))

describe('tableRows', () => {
  it('puts a band before each run of a scene’s lines, in dialog order', () => {
    expect(shape(tableRows(all, all))).toEqual([
      'band:Cave',
      'a',
      'b',
      'band:No scene',
      'c',
      'band:Meadow',
      'd',
      'band:Cave, continued',
      'e',
    ])
  })

  it('has no bands at all when the dialog names no scenes', () => {
    const plain = [line('a', null), line('b', null)]
    expect(shape(tableRows(plain, plain))).toEqual(['a', 'b'])
  })

  it('keeps only bands with a line shown', () => {
    expect(shape(tableRows(all, [all[3]!, all[4]!]))).toEqual([
      'band:Meadow',
      'd',
      'band:Cave, continued',
      'e',
    ])
    expect(tableRows(all, [])).toEqual([])
  })

  it('counts a scene’s lines in all its runs, and the shown ones in the run', () => {
    const rows = tableRows(all, [all[0]!, all[3]!])
    const bands = rows.flatMap((row) => (row.kind === 'band' ? [row] : []))
    expect(bands.map((b) => [b.title, b.shown, b.total, b.scene])).toEqual([
      ['Cave', 1, 3, 'Cave'],
      ['Meadow', 1, 1, 'Meadow'],
    ])
  })
})

describe('bandCount', () => {
  it('says how many lines, or how many of them are shown', () => {
    expect(bandCount({ shown: 27, total: 27 }, false)).toBe('· 27 lines')
    expect(bandCount({ shown: 1, total: 1 }, false)).toBe('· 1 line')
    expect(bandCount({ shown: 1, total: 22 }, true)).toBe('· 1 of 22 lines shown')
  })

  it('says the whole count when a filter hides nothing of the band’s scene', () => {
    expect(bandCount({ shown: 3, total: 3 }, true)).toBe('· 3 lines')
  })
})

describe('warningText', () => {
  it('names how many recorded lines saving marks, and nothing when there are none', () => {
    expect(warningText(19)).toBe('Saving marks 19 recorded lines for re-recording.')
    expect(warningText(1)).toBe('Saving marks 1 recorded line for re-recording.')
    expect(warningText(0)).toBeNull()
  })
})

describe('followersHint', () => {
  it('names who follows the cue', () => {
    expect(followersHint(['narrator'])).toBe(
      "The narrator's lines follow this cue unless they have their own.",
    )
    expect(followersHint(['narrator', 'mira'])).toBe(
      'Lines by Narrator and Mira follow this cue unless they have their own.',
    )
    expect(followersHint(['narrator', 'mira', 'tilda'])).toBe(
      'Lines by Narrator, Mira and Tilda follow this cue unless they have their own.',
    )
    expect(followersHint(['mira'])).toBe(
      'Lines by Mira follow this cue unless they have their own.',
    )
    expect(followersHint([])).toBe('No speaker follows scene cues in this project.')
  })
})

describe('bandsBefore', () => {
  it('maps the first line shown of each run to its band', () => {
    const before = bandsBefore(tableRows(all, [all[1]!, all[2]!, all[4]!]))
    expect([...before].map(([key, band]) => [key, band.title])).toEqual([
      ['b', 'Cave'],
      ['c', 'No scene'],
      ['e', 'Cave, continued'],
    ])
  })
})

describe('sceneCueWithoutOwn', () => {
  const scene = (name: string, cue: string | null): SceneState => ({
    name,
    cue,
    cueFrom: cue === null ? null : 'own',
    sourceCue: null,
    lines: 1,
    following: 1,
    recordedFollowing: 0,
    firstFollowing: 'a',
  })
  const scenes = [scene('Cave', '[dark]'), scene('Meadow', null)]

  it('is the scene’s cue for a speaker that follows scene cues', () => {
    expect(sceneCueWithoutOwn(scenes, ['narrator'], { scene: 'Cave', speaker: 'narrator' })).toBe(
      '[dark]',
    )
  })

  it('is null for another speaker, a scene with no cue, or a line in no scene', () => {
    expect(sceneCueWithoutOwn(scenes, ['narrator'], { scene: 'Cave', speaker: 'mira' })).toBeNull()
    expect(
      sceneCueWithoutOwn(scenes, ['narrator'], { scene: 'Meadow', speaker: 'narrator' }),
    ).toBeNull()
    expect(
      sceneCueWithoutOwn(scenes, ['narrator'], { scene: null, speaker: 'narrator' }),
    ).toBeNull()
  })
})
