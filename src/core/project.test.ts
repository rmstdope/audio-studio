import { describe, expect, it } from 'bun:test'
import { projectJson } from '../../test/helpers'
import { ProjectSchema, partPathFor, problemsFrom } from './project'

function parse(value: unknown) {
  return ProjectSchema.safeParse(value)
}

function problems(value: unknown) {
  const result = parse(value)
  if (result.success) throw new Error('expected the project to be invalid')
  return problemsFrom('audio-studio.json', result.error)
}

describe('ProjectSchema', () => {
  it('fills in defaults for everything optional', () => {
    const result = parse(projectJson())
    expect(result.success).toBe(true)
    const project = result.data!
    expect(project.env).toBe('.env')
    expect(project.narration.models).toEqual({
      audition: 's2.1-pro-free',
      draft: 's2.1-pro-free',
      final: 's2.1-pro-free',
    })
    expect(project.narration.quality.minHeard).toBe(0.9)
    expect(project.narration.output).toEqual({ codec: 'mp3', bitrate: '64k', channels: 1 })
    expect(project.narration.audition.candidatesPerRound).toBe(5)
  })

  it('rejects a paid model, naming the stage', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const found = problems({ ...base, narration: { ...narration, models: { final: 'drama-3' } } })
    expect(found).toEqual([
      {
        file: 'audio-studio.json',
        path: 'narration.models.final',
        message: '"drama-3" is not available yet: only s2.1-pro-free can be used for now',
      },
    ])
  })

  it('refuses a standard audition phrase too long for one take', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const found = problems({
      ...base,
      narration: { ...narration, audition: { phrase: 'x'.repeat(401) } },
    })
    expect(found.map((p) => [p.path, p.message])).toEqual([
      [
        'narration.audition.phrase',
        'is 401 characters; a take is one piece of at most 400 (quality.chunkLimit)',
      ],
    ])
  })

  it('never refuses a project for the built-in phrase, whatever chunk limit it allows', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    expect(
      parse({ ...base, narration: { ...narration, quality: { chunkLimit: 100 } } }).success,
    ).toBe(true)
  })

  it('reports only the chunk limit when the limit itself is wrong', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const found = problems({ ...base, narration: { ...narration, quality: { chunkLimit: 10 } } })
    expect(found.map((p) => p.path)).toEqual(['narration.quality.chunkLimit'])
  })

  it('requires {part} in part paths', () => {
    const base = projectJson()
    const narration = base.narration as { paths: Record<string, string> }
    const found = problems({
      ...base,
      narration: { ...narration, paths: { ...narration.paths, clips: 'audio' } },
    })
    expect(found.map((p) => p.path)).toEqual(['narration.paths.clips'])
  })

  it('rejects duplicate part ids', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const parts = [
      { id: 'act1', title: 'A' },
      { id: 'act1', title: 'B' },
    ]
    expect(problems({ ...base, narration: { ...narration, parts } })[0]!.message).toBe(
      'part ids must be unique',
    )
  })

  it('writes array indexes in problem paths', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const parts = [{ id: 'act 1', title: 'A' }]
    expect(problems({ ...base, narration: { ...narration, parts } })[0]!.path).toBe(
      'narration.parts[0].id',
    )
  })
})

describe('partPathFor', () => {
  it('replaces every {part}', () => {
    expect(partPathFor('tts/{part}/x-{part}.json', 'act2')).toBe('tts/act2/x-act2.json')
  })
})
