import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import {
  adoptPart,
  clipFile,
  findProjectFile,
  loadPart,
  loadProject,
  projectFileProblem,
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
