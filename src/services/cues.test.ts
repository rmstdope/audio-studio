import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { loadPart } from './workspace'
import { moveCue, setCue } from './cues'

const files = {
  'audio-studio.json': projectJson(),
  'tts/cast.json': { speakers: { mira: { voice: 'v1', style: '[warm]' } }, pronounce: {} },
  'tts/act1/script.json': [
    { key: 'a', speaker: 'mira', text: 'Hello.' },
    { key: 'b', speaker: 'mira', text: 'Goodbye.' },
  ],
}

describe('setCue', () => {
  it('creates the cues file with the first cue', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    expect(await setCue(projectFile, 'act1', 'a', '  [whispering]  ')).toEqual({ ok: true })
    expect(readFileSync(join(root, 'tts/act1/cues.json'), 'utf8')).toBe(
      '{\n  "a": "[whispering]"\n}\n',
    )
  })

  it('keeps the file’s own order and its other cues, adding a new cue at the end', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    const cuesFile = join(root, 'tts/act1/cues.json')
    writeFileSync(cuesFile, '{\n  "zz": "[old]",\n  "b": "[sad]"\n}\n')
    await setCue(projectFile, 'act1', 'a', '[happy]')
    await setCue(projectFile, 'act1', 'b', '[sadder]')
    expect(readFileSync(cuesFile, 'utf8')).toBe(
      '{\n  "zz": "[old]",\n  "b": "[sadder]",\n  "a": "[happy]"\n}\n',
    )
  })

  it('removes a cleared cue, so the line goes back to the character’s style', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await setCue(projectFile, 'act1', 'a', '[happy]')
    await setCue(projectFile, 'act1', 'a', '')
    expect(readFileSync(join(root, 'tts/act1/cues.json'), 'utf8')).toBe('{}\n')
    const part = await loadPart(projectFile, 'act1')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'a')).toMatchObject({
      cue: '[warm]',
      cueFrom: 'style',
      sourceCue: null,
    })
  })

  it('delivers the line with its own cue from then on', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await setCue(projectFile, 'act1', 'b', '[sad]')
    const part = await loadPart(projectFile, 'act1')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'b')).toMatchObject({
      cue: '[sad]',
      cueFrom: 'own',
      sourceCue: null,
    })
  })

  it('refuses a broken cues file instead of overwriting it', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    writeFileSync(join(root, 'tts/act1/cues.json'), '{ broken')
    const result = await setCue(projectFile, 'act1', 'a', '[x]')
    expect(result).toMatchObject({ ok: false, problems: [{ file: 'tts/act1/cues.json' }] })
    expect(readFileSync(join(root, 'tts/act1/cues.json'), 'utf8')).toBe('{ broken')
  })

  it('writes nothing when the cue does not change', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    const cuesFile = join(root, 'tts/act1/cues.json')
    expect(await setCue(projectFile, 'act1', 'a', '')).toEqual({ ok: true })
    expect(existsSync(cuesFile)).toBe(false)
    writeFileSync(cuesFile, '{\n    "a": "[caf\\u00e9]"\n}')
    expect(await setCue(projectFile, 'act1', 'a', '[café]')).toEqual({ ok: true })
    expect(await setCue(projectFile, 'act1', 'b', ' ')).toEqual({ ok: true })
    expect(readFileSync(cuesFile, 'utf8')).toBe('{\n    "a": "[caf\\u00e9]"\n}')
  })

  it('refuses a number-like key that JavaScript would move to the front', async () => {
    const root = tempRepo({
      ...files,
      'tts/act1/script.json': [
        { key: 'b', speaker: 'mira', text: 'Goodbye.' },
        { key: '10', speaker: 'mira', text: 'Ten.' },
      ],
      'tts/act1/cues.json': { b: '[sad]' },
    })
    const result = await setCue(join(root, 'audio-studio.json'), 'act1', '10', '[x]')
    expect(result).toMatchObject({ ok: false, problems: [{ file: 'tts/act1/cues.json' }] })
    expect(JSON.parse(readFileSync(join(root, 'tts/act1/cues.json'), 'utf8'))).toEqual({
      b: '[sad]',
    })
  })

  it('saves a cue for a line keyed like an object property', async () => {
    const root = tempRepo({
      ...files,
      'tts/act1/script.json': [{ key: '__proto__', speaker: 'mira', text: 'Odd.' }],
    })
    const projectFile = join(root, 'audio-studio.json')
    expect(await setCue(projectFile, 'act1', '__proto__', '[odd]')).toEqual({ ok: true })
    expect(readFileSync(join(root, 'tts/act1/cues.json'), 'utf8')).toBe(
      '{\n  "__proto__": "[odd]"\n}\n',
    )
  })

  it('knows no unknown part or line', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    expect(await setCue(projectFile, 'act9', 'a', '[x]')).toBeNull()
    expect(await setCue(projectFile, 'act1', 'nope', '[x]')).toBeNull()
  })
})

describe('moveCue', () => {
  const withOrphan = {
    ...files,
    'tts/act1/cues.json': '{\n  "zz": "[old]",\n  "gone": "[sad]",\n  "b": "[x]"\n}\n',
  }

  it('gives an orphaned cue to a line, in its place in the file', async () => {
    const root = tempRepo(withOrphan)
    expect(await moveCue(join(root, 'audio-studio.json'), 'act1', 'gone', 'a')).toEqual({
      ok: true,
    })
    expect(readFileSync(join(root, 'tts/act1/cues.json'), 'utf8')).toBe(
      '{\n  "zz": "[old]",\n  "a": "[sad]",\n  "b": "[x]"\n}\n',
    )
  })

  it('removes an orphaned cue', async () => {
    const root = tempRepo(withOrphan)
    expect(await moveCue(join(root, 'audio-studio.json'), 'act1', 'gone', null)).toEqual({
      ok: true,
    })
    expect(readFileSync(join(root, 'tts/act1/cues.json'), 'utf8')).toBe(
      '{\n  "zz": "[old]",\n  "b": "[x]"\n}\n',
    )
  })

  it('refuses a line that already has its own cue, and a cue that is not orphaned', async () => {
    const root = tempRepo(withOrphan)
    const projectFile = join(root, 'audio-studio.json')
    expect(await moveCue(projectFile, 'act1', 'gone', 'b')).toMatchObject({
      ok: false,
      problems: [{ path: 'b' }],
    })
    expect(await moveCue(projectFile, 'act1', 'b', 'a')).toMatchObject({
      ok: false,
      problems: [{ path: 'b' }],
    })
  })

  it('knows no unknown cue or line', async () => {
    const root = tempRepo(withOrphan)
    const projectFile = join(root, 'audio-studio.json')
    expect(await moveCue(projectFile, 'act1', 'nope', 'a')).toBeNull()
    expect(await moveCue(projectFile, 'act1', 'gone', 'nope')).toBeNull()
  })
})

describe('cues in a language besides the source', () => {
  const several = projectJson()
  const narration = several.narration as Record<string, unknown>
  narration.languages = ['en', 'sv']
  narration.paths = {
    dialog: 'tts/{part}/{language}/script.json',
    cues: 'tts/{part}/{language}/cues.json',
    lock: 'tts/{part}/{language}/narration.lock.json',
    clips: 'audio/{part}/{language}',
    manifest: 'audio/{part}/{language}/manifest.json',
  }
  const swedish = {
    'audio-studio.json': several,
    'tts/cast.json': {
      speakers: { mira: { voice: 'v1', style: '[warm]', languages: { sv: { voice: 'v2' } } } },
    },
    'tts/act1/en/script.json': [{ key: 'a', speaker: 'mira', text: 'Hello.' }],
    'tts/act1/sv/script.json': [{ key: 'a', speaker: 'mira', text: 'Hej.' }],
    'tts/act1/en/cues.json': '{\n  "a": "[worried]"\n}\n',
  }
  const cueOf = async (projectFile: string, language: string) => {
    const part = await loadPart(projectFile, 'act1', language)
    return part?.ok ? part.part.lines.find((l) => l.key === 'a') : undefined
  }

  it('gives the line its own cue in that language only, never changing the source’s', async () => {
    const root = tempRepo(swedish)
    const projectFile = join(root, 'audio-studio.json')
    expect(await setCue(projectFile, 'act1', 'a', '[mjukt]', 'sv')).toEqual({ ok: true })
    expect(readFileSync(join(root, 'tts/act1/sv/cues.json'), 'utf8')).toBe(
      '{\n  "a": "[mjukt]"\n}\n',
    )
    expect(readFileSync(join(root, 'tts/act1/en/cues.json'), 'utf8')).toBe(
      '{\n  "a": "[worried]"\n}\n',
    )
    expect(await cueOf(projectFile, 'sv')).toMatchObject({ cue: '[mjukt]', cueFrom: 'own' })
    expect(await cueOf(projectFile, 'en')).toMatchObject({ cue: '[worried]', cueFrom: 'own' })
  })

  it('goes back to following the source cue when its own is cleared', async () => {
    const root = tempRepo(swedish)
    const projectFile = join(root, 'audio-studio.json')
    await setCue(projectFile, 'act1', 'a', '[mjukt]', 'sv')
    await setCue(projectFile, 'act1', 'a', '', 'sv')
    expect(await cueOf(projectFile, 'sv')).toMatchObject({ cue: '[worried]', cueFrom: 'source' })
  })

  it('moves an orphaned cue of the language to a line of it', async () => {
    const root = tempRepo({ ...swedish, 'tts/act1/sv/cues.json': '{\n  "old": "[x]"\n}\n' })
    const projectFile = join(root, 'audio-studio.json')
    expect(await moveCue(projectFile, 'act1', 'old', 'a', 'sv')).toEqual({ ok: true })
    expect(await cueOf(projectFile, 'sv')).toMatchObject({ cue: '[x]', cueFrom: 'own' })
  })
})
