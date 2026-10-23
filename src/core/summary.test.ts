import { describe, expect, it } from 'bun:test'
import { projectJson } from '../../test/helpers'
import { ProjectSchema } from './project'
import type { Line } from './resources'
import { displayName, summarize, type SummaryInput } from './summary'

const project = ProjectSchema.parse(projectJson())

function lines(...speakers: string[]): Line[] {
  return speakers.map((speaker, i) => ({ key: `k${i}`, speaker, text: `line ${i}` }))
}

function input(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return { project, root: '/repo', dialogs: {}, cast: null, problems: [], ...overrides }
}

describe('summarize', () => {
  it('counts each part’s lines per character, most lines first', () => {
    const summary = summarize(
      input({ dialogs: { act1: { status: 'ok', lines: lines('mira', 'narrator', 'narrator') } } }),
    )
    const act1 = summary.parts[0]!
    expect(act1.dialog).toBe('ok')
    expect(act1.lineCount).toBe(3)
    expect(act1.dialogPath).toBe('tts/act1/script.json')
    expect(act1.characters).toEqual([
      { id: 'narrator', lines: 2 },
      { id: 'mira', lines: 1 },
    ])
  })

  it('reports a part without a dialog file as missing, with no lines', () => {
    const act2 = summarize(input()).parts[1]!
    expect(act2).toMatchObject({ id: 'act2', dialog: 'missing', lineCount: 0, characters: [] })
  })

  it('treats the same name in different parts as one character', () => {
    const summary = summarize(
      input({
        dialogs: {
          act1: { status: 'ok', lines: lines('narrator', 'narrator') },
          act2: { status: 'ok', lines: lines('narrator') },
        },
        cast: { speakers: { narrator: { voice: 'v1', style: '[warm]' } }, pronounce: {} },
      }),
    )
    expect(summary.characters).toEqual([
      {
        id: 'narrator',
        name: 'Narrator',
        voice: 'v1',
        voiceName: null,
        style: '[warm]',
        keywords: [],
        appearances: [
          { part: 'act1', lines: 2 },
          { part: 'act2', lines: 1 },
        ],
        totalLines: 3,
      },
    ])
  })

  it('lists speakers missing from the cast without a voice, and cast entries that never speak', () => {
    const summary = summarize(
      input({
        dialogs: { act1: { status: 'ok', lines: lines('tilda') } },
        cast: {
          speakers: { hermit: { voice: 'v2', audition: { keywords: ['old', 'raspy'] } } },
          pronounce: {},
        },
      }),
    )
    expect(summary.characters.map((c) => [c.id, c.voice, c.totalLines, c.keywords])).toEqual([
      ['tilda', null, 1, []],
      ['hermit', 'v2', 0, ['old', 'raspy']],
    ])
  })

  it('carries the project’s labels and problems', () => {
    const problem = { file: 'tts/cast.json', path: 'speakers', message: 'bad' }
    const summary = summarize(input({ problems: [problem] }))
    expect(summary).toMatchObject({
      name: 'Test Game',
      partLabel: 'Act',
      charactersPath: 'tts/cast.json',
      root: '/repo',
      problems: [problem],
    })
  })
})

describe('displayName', () => {
  it('upper-cases the first letter only', () => {
    expect(displayName('narrator-act2')).toBe('Narrator-act2')
  })
})
