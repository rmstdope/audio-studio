import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { clipInputs, fingerprint } from '../core/fingerprint'
import { ProjectSchema } from '../core/project'
import {
  adoptPart,
  clipFile,
  findProjectFile,
  loadPart,
  loadProject,
  projectFileProblem,
  readPart,
} from './workspace'

const script = [
  { key: 'a', speaker: 'narrator', text: 'Once.' },
  { key: 'b', speaker: 'mira', text: 'Welcome.' },
]

describe('findProjectFile', () => {
  it('finds the project file in a parent directory', () => {
    const root = tempRepo({ 'audio-studio.json': projectJson() })
    const deep = join(root, 'web', 'src')
    mkdirSync(deep, { recursive: true })
    expect(findProjectFile(deep)).toBe(join(root, 'audio-studio.json'))
  })

  it('returns null when no directory up to the filesystem root has one', () => {
    const root = tempRepo({ 'README.md': 'no project here' })
    expect(findProjectFile(root)).toBeNull()
  })
})

describe('loadProject', () => {
  it('summarises the project from its resources', async () => {
    const root = tempRepo({
      'audio-studio.json': projectJson(),
      'tts/cast.json': { speakers: { narrator: { voice: 'v1', style: '[warm]' } } },
      'tts/act1/script.json': script,
    })
    const result = await loadProject(join(root, 'audio-studio.json'))
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
    expect(result.summary.problems).toEqual([])
    expect(result.summary.parts.map((p) => [p.id, p.dialog, p.lineCount])).toEqual([
      ['act1', 'ok', 2],
      ['act2', 'missing', 0],
    ])
    expect(result.summary.characters.map((c) => [c.id, c.voice])).toEqual([
      ['mira', null],
      ['narrator', 'v1'],
    ])
  })

  it('treats a missing cast as nobody cast yet', async () => {
    const root = tempRepo({ 'audio-studio.json': projectJson(), 'tts/act1/script.json': script })
    const result = await loadProject(join(root, 'audio-studio.json'))
    expect(result.ok && result.summary.problems).toEqual([])
  })

  it('reports broken resources as problems but still loads', async () => {
    const root = tempRepo({
      'audio-studio.json': projectJson(),
      'tts/cast.json': '{ not json',
      'tts/act1/script.json': [{ key: 'a', text: 'no speaker' }],
    })
    const result = await loadProject(join(root, 'audio-studio.json'))
    if (!result.ok) throw new Error('expected the project to load')
    expect(result.summary.parts[0]!.dialog).toBe('invalid')
    expect(result.summary.problems.map((p) => [p.file, p.path])).toEqual([
      ['tts/cast.json', ''],
      ['tts/act1/script.json', '[0].speaker'],
    ])
    expect(result.summary.problems[0]!.message).toStartWith('not valid JSON')
  })

  it('fails on an invalid project file, naming what is wrong', async () => {
    const root = tempRepo({ 'audio-studio.json': { name: '' } })
    const result = await loadProject(join(root, 'audio-studio.json'))
    if (result.ok) throw new Error('expected the project file to be rejected')
    expect(result.file).toBe('audio-studio.json')
    expect(result.problems.map((p) => p.path)).toEqual(['name', 'narration'])
  })

  it('fails when the project file is not JSON', async () => {
    const root = tempRepo({ 'audio-studio.json': '{' })
    const result = await loadProject(join(root, 'audio-studio.json'))
    expect(!result.ok && result.problems[0]!.message).toStartWith('not valid JSON')
  })

  it('refuses paths outside the project folder', async () => {
    const root = tempRepo({
      'audio-studio.json': projectJson({
        narration: { ...(projectJson().narration as object), characters: '../elsewhere/cast.json' },
      }),
    })
    const result = await loadProject(join(root, 'audio-studio.json'))
    expect(!result.ok && result.problems).toEqual([
      {
        file: 'audio-studio.json',
        path: 'narration.characters',
        message: '../elsewhere/cast.json is outside the project folder',
      },
    ])
  })
})

describe('loadPart', () => {
  const files = {
    'audio-studio.json': projectJson(),
    'tts/cast.json': { speakers: { narrator: { voice: 'v1', style: '[warm]' } } },
    'tts/act1/script.json': script,
    'audio/act1/manifest.json': {
      a: { file: 'a.mp3', speaker: 'narrator', duration: 1.2 },
      gone: { file: 'gone.mp3', speaker: 'narrator' },
    },
    'audio/act1/a.mp3': 'audio',
  }

  it('plans every line of the part', async () => {
    const root = tempRepo(files)
    const result = await loadPart(join(root, 'audio-studio.json'), 'act1')
    if (!result?.ok) throw new Error('expected the part to load')
    const { part } = result
    expect(part).toMatchObject({
      id: 'act1',
      dialog: 'ok',
      clipsPath: 'audio/act1',
      lockPath: 'tts/act1/narration.lock.json',
      problems: [],
    })
    expect(part.lines.map((l) => [l.key, l.status])).toEqual([
      ['a', 'untracked'],
      ['b', 'uncast'],
    ])
    expect(part.orphans.map((o) => o.key)).toEqual(['gone'])
  })

  it('returns null for a part the project does not have', async () => {
    const root = tempRepo(files)
    expect(await loadPart(join(root, 'audio-studio.json'), 'act9')).toBeNull()
  })

  it('shows a part without dialog as having no lines', async () => {
    const root = tempRepo(files)
    const result = await loadPart(join(root, 'audio-studio.json'), 'act2')
    expect(result?.ok && [result.part.dialog, result.part.lines.length]).toEqual(['missing', 0])
  })

  it('counts no clip or cue as orphaned while the dialog cannot be read', async () => {
    const root = tempRepo({
      ...files,
      'tts/act1/script.json': '[not json',
      'tts/act1/cues.json': { a: '[softly]' },
    })
    const result = await loadPart(join(root, 'audio-studio.json'), 'act1')
    if (!result?.ok) throw new Error('expected the part to load')
    const { part } = result
    expect(part.dialog).toBe('invalid')
    expect(part.problems.map((p) => p.file)).toContain('tts/act1/script.json')
    expect([part.orphans, part.orphanCues]).toEqual([[], []])
  })
})

describe('loadPart, a dialog that is gone', () => {
  const entry = { file: 'a.mp3', speaker: 'narrator' }
  const base = { 'audio-studio.json': projectJson(), 'tts/cast.json': { speakers: {} } }
  const load = async (files: Record<string, unknown>) => {
    const root = tempRepo(files)
    const result = await loadPart(join(root, 'audio-studio.json'), 'act1')
    if (!result?.ok) throw new Error('expected the part to load')
    return result.part
  }

  it('holds clips and cues instead of calling them orphans', async () => {
    const part = await load({
      ...base,
      'audio/act1/manifest.json': { a: entry, b: entry },
      'tts/act1/cues.json': { a: '[softly]' },
    })
    expect([part.dialog, part.recorded]).toEqual(['gone', { clips: 2, cues: 1 }])
    expect([part.orphans, part.orphanCues, part.lines]).toEqual([[], [], []])
  })

  it('counts only what exists', async () => {
    expect((await load({ ...base, 'audio/act1/manifest.json': { a: entry } })).recorded).toEqual({
      clips: 1,
      cues: 0,
    })
    expect((await load({ ...base, 'tts/act1/cues.json': { a: 'x' } })).recorded).toEqual({
      clips: 0,
      cues: 1,
    })
  })

  it('stays missing when nothing was recorded', async () => {
    const part = await load({ ...base, 'audio/act1/manifest.json': {} })
    expect([part.dialog, part.recorded]).toEqual(['missing', null])
  })

  it('reads as usual when the file comes back, with the unmatched clips orphaned', async () => {
    const part = await load({
      ...base,
      'tts/act1/script.json': script,
      'audio/act1/manifest.json': { zzz: entry },
    })
    expect([part.dialog, part.recorded]).toEqual(['ok', null])
    expect(part.orphans.map((o) => o.key)).toEqual(['zzz'])
  })

  it('carries a gone language into the progress and the project summary', async () => {
    const project = {
      ...projectJson(),
      narration: {
        ...(projectJson().narration as object),
        languages: ['en', 'sv'],
        paths: {
          dialog: 'tts/{part}/{language}/script.json',
          cues: 'tts/{part}/{language}/cues.json',
          lock: 'tts/{part}/{language}/narration.lock.json',
          clips: 'audio/{part}/{language}',
          manifest: 'audio/{part}/{language}/manifest.json',
        },
      },
    }
    const root = tempRepo({
      'audio-studio.json': project,
      'tts/act1/en/script.json': script,
      'audio/act1/sv/manifest.json': { a: entry },
    })
    const file = join(root, 'audio-studio.json')
    const result = await loadPart(file, 'act1', 'sv')
    if (!result?.ok) throw new Error('expected the part to load')
    expect(result.part.dialog).toBe('gone')
    expect(result.part.languages.map((l) => [l.id, l.dialog, l.recorded])).toEqual([
      ['en', 'ok', null],
      ['sv', 'gone', { clips: 1, cues: 0 }],
    ])
    // The summary shows the source language, which is fine.
    const summary = await loadProject(file)
    expect(summary.ok && summary.summary.parts[0]).toMatchObject({ dialog: 'ok', recorded: null })
  })

  it('carries a gone source language into the project summary', async () => {
    const root = tempRepo({
      ...base,
      'audio/act1/manifest.json': { a: entry },
    })
    const result = await loadProject(join(root, 'audio-studio.json'))
    expect(result.ok && result.summary.parts[0]).toMatchObject({
      dialog: 'gone',
      recorded: { clips: 1, cues: 0 },
    })
  })
})

describe('adoptPart', () => {
  const files = {
    'audio-studio.json': projectJson(),
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': script,
    'audio/act1/manifest.json': { a: { file: 'a.mp3' } },
    'audio/act1/a.mp3': 'audio',
  }

  it('writes the lock for untracked clips, after which they are up to date', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    const result = await adoptPart(projectFile, 'act1', new Date('2026-10-23T12:00:00Z'))
    expect(result).toEqual({ ok: true, adopted: 1, lockPath: 'tts/act1/narration.lock.json' })
    const lock = JSON.parse(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8'))
    expect(lock.a).toMatchObject({ voice: 'v1', adopted: true, at: '2026-10-23T12:00:00.000Z' })
    const after = await loadPart(projectFile, 'act1')
    expect(after?.ok && after.part.lines[0]!.status).toBe('ok')
  })

  it('writes nothing when there is nothing to adopt', async () => {
    const root = tempRepo({ ...files, 'audio/act1/manifest.json': {} })
    const result = await adoptPart(join(root, 'audio-studio.json'), 'act1')
    expect(result).toMatchObject({ ok: true, adopted: 0 })
    expect(existsSync(join(root, 'tts/act1/narration.lock.json'))).toBe(false)
  })

  it('refuses while a file of the part is broken', async () => {
    const root = tempRepo({ ...files, 'tts/act1/narration.lock.json': '{ broken' })
    const result = await adoptPart(join(root, 'audio-studio.json'), 'act1')
    expect(result && !result.ok && 'problems' in result && result.problems[0]!.file).toBe(
      'tts/act1/narration.lock.json',
    )
    expect(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8')).toBe('{ broken')
  })
})

describe('review fixes', () => {
  const files = {
    'audio-studio.json': projectJson(),
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': script,
    'audio/act1/manifest.json': { a: { file: 'a.mp3' }, b: { file: 'b.mp3' } },
    'audio/act1/a.mp3': 'audio',
  }

  it('keeps fields it does not know on existing lock entries when adopting', async () => {
    const root = tempRepo({
      ...files,
      'tts/cast.json': { speakers: { narrator: { voice: 'v1' }, mira: { voice: 'v2' } } },
      'audio/act1/b.mp3': 'audio',
      'tts/act1/narration.lock.json': {
        a: {
          fp: 'x',
          voice: 'v1',
          model: 's2.1-pro-free',
          parts: { cue: '', text: '', said: '', settings: '' },
          at: 'then',
          future: 42,
        },
      },
    })
    const result = await adoptPart(join(root, 'audio-studio.json'), 'act1')
    expect(result).toMatchObject({ ok: true, adopted: 1 })
    const lock = JSON.parse(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8'))
    expect(lock.a.future).toBe(42)
  })

  it('gives the project’s quality bar with the part', async () => {
    const root = tempRepo(files)
    const result = await loadPart(join(root, 'audio-studio.json'), 'act1')
    expect(result?.ok && result.part.minHeard).toBe(0.9)
  })

  it('gives the draft model, which a line’s extra takes are made with', async () => {
    const root = tempRepo(files)
    const result = await loadPart(join(root, 'audio-studio.json'), 'act1')
    expect(result?.ok && result.part.draftModel).toBe('s2.1-pro-free')
  })

  it('names its stages’ models, both providers’ in a part with an ElevenLabs voice, and its final step', async () => {
    const elevenFinal = projectJson({
      narration: {
        ...(projectJson().narration as object),
        elevenlabs: { models: { final: 'eleven_multilingual_v2' } },
      },
    })
    // A project whose ElevenLabs stages differ, but whose part has Fish voices alone.
    const fishPart = await loadPart(
      join(tempRepo({ ...files, 'audio-studio.json': elevenFinal }), 'audio-studio.json'),
      'act1',
    )
    expect(fishPart?.ok && fishPart.part.stages.finalStep).toBe(false)
    const fishOnly = await loadPart(join(tempRepo(files), 'audio-studio.json'), 'act1')
    expect(fishOnly?.ok && fishOnly.part.stages).toEqual({
      draft: 's2.1-pro-free',
      final: 's2.1-pro-free',
      finalStep: false,
      both: false,
    })
    const root = tempRepo({
      ...files,
      'audio-studio.json': elevenFinal,
      'tts/cast.json': { speakers: { narrator: { voice: 'eleven:g1' } } },
    })
    const result = await loadPart(join(root, 'audio-studio.json'), 'act1')
    expect(result?.ok && result.part.stages).toEqual({
      draft: 's2.1-pro-free · Eleven v3',
      final: 's2.1-pro-free · Multilingual v2',
      finalStep: true,
      both: true,
    })
  })

  it('reports a dialog key that could not be a file name', async () => {
    const root = tempRepo({
      ...files,
      'tts/act1/script.json': [{ key: '../../x', speaker: 'narrator', text: 'Escape.' }],
    })
    const result = await loadPart(join(root, 'audio-studio.json'), 'act1')
    expect(result?.ok && result.part.problems.map((p) => p.path)).toEqual(['[0].key'])
  })

  it('reports a dialog that uses a key twice', async () => {
    const root = tempRepo({
      ...files,
      'tts/act1/script.json': [...script, { key: 'a', speaker: 'mira', text: 'Again.' }],
    })
    const result = await loadPart(join(root, 'audio-studio.json'), 'act1')
    expect(result?.ok && result.part.problems.map((p) => [p.file, p.message])).toEqual([
      ['tts/act1/script.json', 'line keys must be unique; used more than once: a'],
    ])
  })

  it('names the project file it was given in its problems', async () => {
    const root = tempRepo({ 'studio.json': { name: '' } })
    const result = await loadProject(join(root, 'studio.json'))
    expect(!result.ok && [result.file, result.problems[0]!.file]).toEqual([
      'studio.json',
      'studio.json',
    ])
  })

  it('serves only plain files from the clips folder', async () => {
    const root = tempRepo({
      ...files,
      'audio/act1/sub.d/x': 'x',
      'audio/act1/.hidden': 'x',
      'outside.txt': 'secret',
    })
    symlinkSync(join(root, 'outside.txt'), join(root, 'audio/act1/link.mp3'))
    const projectFile = join(root, 'audio-studio.json')
    expect(await clipFile(projectFile, 'act1', 'a.mp3')).toBe(join(root, 'audio/act1/a.mp3'))
    expect(await clipFile(projectFile, 'act1', 'sub.d')).toBeNull()
    expect(await clipFile(projectFile, 'act1', 'link.mp3')).toBeNull()
    expect(await clipFile(projectFile, 'act1', '.hidden')).toBeNull()
  })
})

describe('projectFileProblem', () => {
  it('accepts a file, and explains a missing file or a folder', () => {
    const root = tempRepo({ 'audio-studio.json': projectJson() })
    expect(projectFileProblem(join(root, 'audio-studio.json'))).toBeNull()
    expect(projectFileProblem(join(root, 'nope.json'))).toContain('does not exist')
    expect(projectFileProblem(root)).toContain('is a folder')
  })

  it('does not take a folder named like the project file for one', () => {
    const root = tempRepo({ 'audio-studio.json/x': 'x' })
    expect(findProjectFile(root)).not.toBe(join(root, 'audio-studio.json'))
  })
})

describe('a part in several languages', () => {
  const paths = {
    dialog: 'tts/{part}/{language}/script.json',
    cues: 'tts/{part}/{language}/cues.json',
    lock: 'tts/{part}/{language}/narration.lock.json',
    clips: 'audio/{part}/{language}',
    manifest: 'audio/{part}/{language}/manifest.json',
  }
  function project(languages: string[]) {
    const base = projectJson()
    return { ...base, narration: { ...(base.narration as object), languages, paths } }
  }
  const files = {
    'audio-studio.json': project(['en', 'sv', 'de']),
    'tts/cast.json': {
      speakers: {
        narrator: { voice: 'v1', languages: { sv: { voice: 'v1-sv' } } },
        mira: { voice: 'v2', languages: { sv: { voice: 'v2-sv' } } },
      },
    },
    'tts/act1/en/script.json': script,
    'tts/act1/sv/script.json': [
      { key: 'a', speaker: 'narrator', text: 'En gång.' },
      { key: 'z', speaker: 'mira', text: 'Bara här.' },
    ],
    'audio/act1/sv/manifest.json': { a: { file: 'a.mp3', speaker: 'narrator', duration: 1 } },
    'audio/act1/sv/a.mp3': 'x',
    'tts/act2/en/script.json': '[not json',
  }
  const open = async (language?: string, part = 'act1', extra = {}) => {
    const root = tempRepo({ ...files, ...extra })
    const result = await loadPart(join(root, 'audio-studio.json'), part, language)
    if (!result?.ok) throw new Error(JSON.stringify(result))
    return { root, part: result.part }
  }

  it('reads the chosen language’s lines, with the source text beside them', async () => {
    const { part } = await open('sv')
    expect(part.language).toBe('sv')
    expect(part.lines.map((l) => [l.key, l.status, l.text, l.english])).toEqual([
      ['a', 'untracked', 'En gång.', 'Once.'],
      ['b', 'untranslated', '', 'Welcome.'],
      ['z', 'missing', 'Bara här.', null],
    ])
    expect(part.clipsPath).toBe('audio/act1/sv')
  })

  it('plans a language with the voices cast for it, not the source language’s', async () => {
    const cast = { speakers: { narrator: { voice: 'v1' }, mira: { voice: 'v2' } } }
    const { part } = await open('sv', 'act1', { 'tts/cast.json': cast })
    expect(part.lines.map((l) => [l.key, l.status])).toEqual([
      ['a', 'uncast'],
      ['b', 'untranslated'],
      ['z', 'uncast'],
    ])
    expect((await open('en', 'act1', { 'tts/cast.json': cast })).part.lines[0]?.status).toBe(
      'missing',
    )
  })

  it('reads every language’s dialog into the summary, a missing one is no problem', async () => {
    const root = tempRepo(files)
    const loaded = await loadProject(join(root, 'audio-studio.json'))
    if (!loaded.ok) throw new Error('expected a summary')
    const narrator = loaded.summary.characters.find((c) => c.id === 'narrator')!
    expect(narrator.languages.sv).toMatchObject({ voice: 'v1-sv', totalLines: 1 })
    expect(narrator.languages.de).toMatchObject({ voice: null, totalLines: 0 })
    expect(loaded.summary.problems.map((p) => p.file)).not.toContain('tts/act1/de/script.json')
  })

  it('reports a broken dialog of another language, as one of the source language', async () => {
    const root = tempRepo({ ...files, 'tts/act1/sv/script.json': '[not json' })
    const loaded = await loadProject(join(root, 'audio-studio.json'))
    if (!loaded.ok) throw new Error('expected a summary')
    expect(loaded.summary.problems.map((p) => p.file)).toContain('tts/act1/sv/script.json')
  })

  it('reads the source language when none is asked for, or one is not declared', async () => {
    for (const asked of [undefined, 'fr']) {
      const { part } = await open(asked)
      expect(part.language).toBe('en')
      expect(part.lines.map((l) => l.status)).toEqual(['missing', 'missing'])
    }
  })

  it('counts every language: up to date out of all its lines, no dialog, unreadable', async () => {
    const { part } = await open('sv')
    expect(part.languages).toEqual([
      { id: 'en', name: 'English', dialog: 'ok', recorded: null, upToDate: 0, total: 2 },
      { id: 'sv', name: 'Svenska', dialog: 'ok', recorded: null, upToDate: 0, total: 3 },
      { id: 'de', name: 'Deutsch', dialog: 'missing', recorded: null, upToDate: 0, total: 0 },
    ])
    const act2 = await open('en', 'act2')
    expect(act2.part.languages.find((l) => l.id === 'en')!.dialog).toBe('invalid')
    expect(act2.part.dialog).toBe('invalid')
  })

  it('has a line follow the source language’s cue until it has its own', async () => {
    const { part } = await open('sv', 'act1', {
      'tts/cast.json': {
        speakers: {
          narrator: { voice: 'v1', style: '[warm]', languages: { sv: { voice: 'v1-sv' } } },
        },
      },
      'tts/act1/en/cues.json': { a: '[worried]', b: '[soft]' },
      'tts/act1/sv/cues.json': { b: '[mjukt]', gone: '[x]' },
    })
    const by = Object.fromEntries(part.lines.map((l) => [l.key, [l.cue, l.cueFrom]]))
    expect(by.a).toEqual(['[worried]', 'source'])
    expect(by.b).toEqual(['', 'style'])
    expect(by.z).toEqual(['', 'style'])
    expect(part.orphanCues).toEqual([{ key: 'gone', cue: '[x]' }])
  })

  it('makes a language’s clips stale, for the cue, when the source cue changes', async () => {
    const cast = { speakers: { narrator: { voice: 'v1-sv' } } }
    const narration = ProjectSchema.parse(project(['en', 'sv', 'de'])).narration
    const inputs = clipInputs(
      { key: 'a', text: 'En gång.' },
      cast.speakers.narrator,
      {},
      {},
      narration,
    )!
    const { fp, parts } = fingerprint(inputs)
    const made = { a: { fp, voice: 'v1-sv', model: inputs.model, parts, at: 'then' } }
    const { part } = await open('sv', 'act1', {
      'tts/cast.json': {
        speakers: { narrator: { voice: 'v1', languages: { sv: { voice: 'v1-sv' } } } },
      },
      'tts/act1/sv/narration.lock.json': made,
      'tts/act1/en/cues.json': { a: '[worried]' },
    })
    expect(part.lines.find((l) => l.key === 'a')).toMatchObject({
      status: 'stale',
      reasons: ['cue'],
    })
  })

  it('hears a language with its own words that sound the same, the built-in English ones for English only', async () => {
    const narration = project(['en', 'sv', 'de']).narration as Record<string, unknown>
    const withGroups = {
      ...project(['en', 'sv', 'de']),
      narration: {
        ...narration,
        quality: {
          soundAlike: [['Lyra', 'Lira']],
          soundAlikeByLanguage: { sv: [['Lyria', 'Liria']] },
        },
      },
    }
    const root = tempRepo({ ...files, 'audio-studio.json': withGroups })
    const projectFile = join(root, 'audio-studio.json')
    const alike = async (language: string) => {
      const read = await readPart(projectFile, 'act1', language)
      if (!read?.ok) throw new Error('no part')
      return read.ears.alike
    }
    const same = (map: Awaited<ReturnType<typeof alike>>, a: string, b: string) =>
      (map.get(a) ?? a) === (map.get(b) ?? b)
    const en = await alike('en')
    expect(same(en, 'inn', 'in')).toBe(true)
    expect(same(en, 'lira', 'lyra')).toBe(true)
    expect(same(en, 'liria', 'lyria')).toBe(false)
    const sv = await alike('sv')
    expect(same(sv, 'liria', 'lyria')).toBe(true)
    expect(same(sv, 'inn', 'in')).toBe(false)
    expect(same(sv, 'lira', 'lyra')).toBe(false)
    // Numbers in the part's own language.
    expect(same(sv, 'tjugo', '20')).toBe(true)
    expect(same(en, 'tjugo', '20')).toBe(false)
    expect(same(en, 'twenty', '20')).toBe(true)
  })

  it('hears German as a language that capitalises its nouns, and no other', async () => {
    const root = tempRepo({ ...files, 'audio-studio.json': project(['en', 'sv', 'de']) })
    const projectFile = join(root, 'audio-studio.json')
    const nouns = async (language: string) => {
      const read = await readPart(projectFile, 'act1', language)
      if (!read?.ok) throw new Error('no part')
      return read.ears.capitalNouns
    }
    expect(await nouns('de')).toBe(true)
    expect(await nouns('en')).toBe(false)
    expect(await nouns('sv')).toBe(false)
  })

  it('says so when the source dialog is missing, since lines cannot be matched', async () => {
    const { part } = await open('sv', 'act1', { 'tts/act1/en/script.json': undefined })
    expect(part.problems.map((p) => p.file)).toContain('tts/act1/en/script.json')
  })

  it('says the source dialog is missing when it is gone, and not when it is unreadable', async () => {
    const gone = await open('sv', 'act1', {
      'tts/act1/en/script.json': undefined,
      'audio/act1/en/manifest.json': { a: { file: 'a.mp3' } },
    })
    expect(gone.part.problems.map((p) => p.file)).toContain('tts/act1/en/script.json')
    const bad = await open('sv', 'act1', { 'tts/act1/en/script.json': '[bad' })
    const about = bad.part.problems.filter((p) => p.file === 'tts/act1/en/script.json')
    expect(about.map((p) => p.message.includes('missing'))).toEqual([false])
  })

  it('serves a clip from the language’s folder', async () => {
    const { root } = await open()
    const projectFile = join(root, 'audio-studio.json')
    expect(await clipFile(projectFile, 'act1', 'a.mp3', 'sv')).toBe(
      join(root, 'audio/act1/sv/a.mp3'),
    )
    expect(await clipFile(projectFile, 'act1', 'a.mp3', 'en')).toBeNull()
    expect(await clipFile(projectFile, 'act1', 'a.mp3', 'fr')).toBeNull()
  })
})

describe('loadProject with a music section', () => {
  const musicSection = {
    refreshShared: 'true',
    paths: {
      loops: 'tts/{part}/music.json',
      stingers: 'tts/stingers.json',
      briefs: 'music/briefs.json',
      lock: 'music/music.lock.json',
      clips: 'audio/music',
      manifest: 'audio/music/manifest.json',
    },
  }
  const loop = (id: string, extra = {}) => ({
    id,
    title: id,
    brief: `${id} brief`,
    seconds: 80,
    ...extra,
  })

  it('has no music pages without a section', async () => {
    const root = tempRepo({ 'audio-studio.json': projectJson() })
    const loaded = await loadProject(join(root, 'audio-studio.json'))
    if (!loaded.ok) throw new Error('expected the project to load')
    expect(loaded.summary.music).toBeNull()
  })

  it('lists each act’s loops and the stingers, and tells a missing list from an empty one', async () => {
    const root = tempRepo({
      'audio-studio.json': projectJson({ music: musicSection }),
      'tts/act1/music.json': [loop('a'), loop('b')],
      'tts/act2/music.json': [],
      'tts/stingers.json': [loop('victory', { seconds: 5 })],
      'music/briefs.json': { a: { brief: 'ours' } },
    })
    const loaded = await loadProject(join(root, 'audio-studio.json'))
    if (!loaded.ok) throw new Error('expected the project to load')
    const lists = loaded.summary.music!.lists
    expect(lists.map((l) => [l.id, l.kind, l.state, l.tracks.length, l.canRefresh])).toEqual([
      ['act1', 'act', 'ok', 2, false],
      ['act2', 'act', 'ok', 0, false],
      ['stingers', 'stingers', 'ok', 1, true],
    ])
    expect(lists[0]!.tracks[0]!.brief).toBe('ours')
    expect(loaded.summary.problems).toEqual([])
  })

  it('shows an act without a list as missing', async () => {
    const root = tempRepo({ 'audio-studio.json': projectJson({ music: musicSection }) })
    const loaded = await loadProject(join(root, 'audio-studio.json'))
    if (!loaded.ok) throw new Error('expected the project to load')
    expect(loaded.summary.music!.lists.map((l) => l.state)).toEqual([
      'missing',
      'missing',
      'missing',
    ])
    expect(loaded.summary.problems).toEqual([])
  })

  it('reports a broken list with its file and JSON path, and the rest still loads', async () => {
    const root = tempRepo({
      'audio-studio.json': projectJson({ music: musicSection }),
      'tts/act1/music.json': [loop('a'), { id: 'Bad Id', title: 'x', brief: 'x', seconds: 1 }],
      'tts/stingers.json': [loop('long', { seconds: 30 })],
      'music/briefs.json': '{ broken',
    })
    const loaded = await loadProject(join(root, 'audio-studio.json'))
    if (!loaded.ok) throw new Error('expected the project to load')
    expect(loaded.summary.music!.lists.map((l) => l.state)).toEqual([
      'invalid',
      'missing',
      'invalid',
    ])
    expect(loaded.summary.problems.map((p) => [p.file, p.path])).toEqual([
      ['tts/act1/music.json', '[1].id'],
      ['tts/stingers.json', '[0].seconds'],
      ['music/briefs.json', ''],
    ])
  })

  it('reports an id used in two lists at both places', async () => {
    const root = tempRepo({
      'audio-studio.json': projectJson({ music: musicSection }),
      'tts/act1/music.json': [loop('x'), loop('a')],
      'tts/stingers.json': [loop('x', { seconds: 5 })],
    })
    const loaded = await loadProject(join(root, 'audio-studio.json'))
    if (!loaded.ok) throw new Error('expected the project to load')
    expect(loaded.summary.music!.lists.map((l) => l.tracks.map((t) => t.id))).toEqual([
      ['a'],
      [],
      [],
    ])
    expect(loaded.summary.problems.map((p) => [p.file, p.path])).toEqual([
      ['tts/act1/music.json', '[0].id'],
      ['tts/stingers.json', '[0].id'],
    ])
  })
})
