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
    expect(project.narration.quality.soundAlike).toEqual([])
    expect(project.narration.output).toEqual({
      codec: 'mp3',
      bitrate: '64k',
      channels: 1,
      lufs: null,
    })
    expect(project.narration.audition.candidatesPerRound).toBe(5)
  })

  it('rejects a paid audition model, naming the stage', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const found = problems({
      ...base,
      narration: { ...narration, models: { audition: 'drama-3' } },
    })
    expect(found).toEqual([
      {
        file: 'audio-studio.json',
        path: 'narration.models.audition',
        message: '"drama-3" cannot be used for auditions yet: only s2.1-pro-free can',
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

  it('takes a standard audition phrase per declared language, each short enough for one take', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const withPhrases = (phrases: Record<string, string>) => ({
      ...base,
      narration: {
        ...narration,
        languages: ['en', 'sv'],
        paths: {
          dialog: 'tts/{part}/{language}/script.json',
          cues: 'tts/{part}/{language}/cues.json',
          lock: 'tts/{part}/{language}/narration.lock.json',
          clips: 'audio/{part}/{language}',
          manifest: 'audio/{part}/{language}/manifest.json',
        },
        audition: { phrases },
      },
    })
    const ok = parse(withPhrases({ sv: 'Kom in.' }))
    expect(ok.data?.narration.audition.phrases).toEqual({ sv: 'Kom in.' })
    expect(problems(withPhrases({ de: 'Komm herein.' })).map((p) => [p.path, p.message])).toEqual([
      ['narration.audition.phrases.de', '"de" is not one of the project’s languages'],
    ])
    expect(problems(withPhrases({ sv: 'x'.repeat(401) }))[0]?.path).toBe(
      'narration.audition.phrases.sv',
    )
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

  it('takes groups of two words or more that sound the same', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const alike = (soundAlike: unknown) => ({
      ...base,
      narration: { ...narration, quality: { soundAlike } },
    })
    expect(parse(alike([['Lyria', 'Leer-ia']])).success).toBe(true)
    expect(problems(alike([['alone']])).map((p) => p.path)).toEqual([
      'narration.quality.soundAlike[0]',
    ])
    // Words or phrases, each word with a letter or digit: punctuation alone could never match.
    expect(parse(alike([['all right', 'alright']])).success).toBe(true)
    expect(problems(alike([['Lyria', 'Leer !!']])).map((p) => p.path)).toEqual([
      'narration.quality.soundAlike[0][1]',
    ])
    expect(problems(alike([['Lyria', '!!']])).map((p) => p.path)).toEqual([
      'narration.quality.soundAlike[0][1]',
    ])
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

describe('ProjectSchema, loudness', () => {
  it('levels nothing unless the project names a target loudness', () => {
    expect(ProjectSchema.parse(projectJson()).narration.output.lufs).toBeNull()
    const levelled = projectJson({
      narration: { ...(projectJson().narration as object), output: { lufs: -16 } },
    })
    expect(ProjectSchema.parse(levelled).narration.output.lufs).toBe(-16)
  })
})

describe('ProjectSchema, paid models', () => {
  const withModels = (models: Record<string, string>) =>
    ProjectSchema.safeParse(
      projectJson({ narration: { ...(projectJson().narration as object), models } }),
    )

  it('takes a priced model for drafts and the final recording', () => {
    const parsed = withModels({ draft: 's2-pro', final: 'drama-3' })
    expect(parsed.success && parsed.data.narration.models).toEqual({
      audition: 's2.1-pro-free',
      draft: 's2-pro',
      final: 'drama-3',
    })
  })

  it('refuses a model without a known price, and a paid audition for now', () => {
    expect(withModels({ draft: 'brand-new' }).success).toBe(false)
    expect(withModels({ audition: 's2-pro' }).success).toBe(false)
  })
})

describe('narration.languages', () => {
  function withLanguages(languages: unknown, paths: Record<string, string> = {}) {
    const base = projectJson()
    const narration = base.narration as { paths: Record<string, string> }
    return {
      ...base,
      narration: { ...narration, languages, paths: { ...narration.paths, ...paths } },
    }
  }
  const everyPath = {
    dialog: 'tts/{part}/{language}/script.json',
    cues: 'tts/{part}/{language}/cues.json',
    lock: 'tts/{part}/{language}/narration.lock.json',
    clips: 'audio/{part}/{language}',
    manifest: 'audio/{part}/{language}/manifest.json',
  }

  it('is English alone by default', () => {
    expect(parse(projectJson()).data!.narration.languages).toEqual(['en'])
  })

  it('takes several languages when every path has {language}', () => {
    const result = parse(withLanguages(['en', 'sv', 'de'], everyPath))
    expect(result.data!.narration.languages).toEqual(['en', 'sv', 'de'])
  })

  it('accepts {language} with one language', () => {
    expect(parse(withLanguages(['en'], everyPath)).success).toBe(true)
  })

  it('names each path that would be shared between languages', () => {
    const found = problems(
      withLanguages(['en', 'sv'], {
        ...everyPath,
        lock: 'tts/{part}/narration.lock.json',
      }),
    )
    expect(found.map((p) => p.path)).toEqual(['narration.paths.lock'])
    expect(found[0]!.message).toContain('{language}')
  })

  it('rejects an empty list, repeats and unknown codes', () => {
    expect(problems(withLanguages([])).length).toBeGreaterThan(0)
    expect(problems(withLanguages(['en', 'en'], everyPath))[0]!.message).toContain('unique')
    expect(problems(withLanguages(['en', 'Swedish'], everyPath))[0]!.path).toBe(
      'narration.languages[1]',
    )
  })
})

describe('partPathFor with a language', () => {
  it('replaces {language} too', () => {
    expect(partPathFor('tts/{part}/{language}.json', 'act2', 'sv')).toBe('tts/act2/sv.json')
  })

  it('leaves {language} alone when none is given', () => {
    expect(partPathFor('tts/{part}/{language}.json', 'act2')).toBe('tts/act2/{language}.json')
  })
})
