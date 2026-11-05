import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { narrationInLanguages, projectJson, tempRepo } from '../../test/helpers'
import { clipInputs } from '../core/fingerprint'
import { loadPart, readPart } from './workspace'
import { moveCue, moveSceneCue, setCue, setInsideCue, setSceneCue } from './cues'

const files = {
  'content-studio.json': projectJson(),
  'content-studio/narration/cast.json': {
    speakers: { mira: { voice: 'v1', style: '[warm]' } },
    pronounce: {},
  },
  'tts/act1/script.json': [
    { id: 'a', speaker: 'mira', text: 'Hello.' },
    { id: 'b', speaker: 'mira', text: 'Goodbye.' },
  ],
}

describe('setCue', () => {
  it('creates the cues file with the first cue', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'content-studio.json')
    expect(await setCue(projectFile, 'act1', 'a', '  [whispering]  ')).toEqual({ ok: true })
    expect(readFileSync(join(root, 'content-studio/narration/act1.edits.json'), 'utf8')).toBe(
      '{\n  "cues": {\n    "a": "[whispering]"\n  },\n  "scenes": {}\n}\n',
    )
  })

  it('keeps the file’s own order and its other cues, adding a new cue at the end', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'content-studio.json')
    const cuesFile = join(root, 'content-studio/narration/act1.edits.json')
    writeFileSync(
      cuesFile,
      '{\n  "cues": {\n    "zz": "[old]",\n    "b": "[sad]"\n  },\n  "scenes": {}\n}\n',
    )
    await setCue(projectFile, 'act1', 'a', '[happy]')
    await setCue(projectFile, 'act1', 'b', '[sadder]')
    expect(readFileSync(cuesFile, 'utf8')).toBe(
      '{\n  "cues": {\n    "zz": "[old]",\n    "b": "[sadder]",\n    "a": "[happy]"\n  },\n  "scenes": {}\n}\n',
    )
  })

  it('removes a cleared cue, so the line goes back to the character’s style', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'content-studio.json')
    await setCue(projectFile, 'act1', 'a', '[happy]')
    await setCue(projectFile, 'act1', 'a', '')
    expect(readFileSync(join(root, 'content-studio/narration/act1.edits.json'), 'utf8')).toBe(
      '{\n  "cues": {},\n  "scenes": {}\n}\n',
    )
    const part = await loadPart(projectFile, 'act1')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'a')).toMatchObject({
      cue: '[warm]',
      cueFrom: 'style',
      sourceCue: null,
    })
  })

  it('delivers the line with its own cue from then on', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'content-studio.json')
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
    const projectFile = join(root, 'content-studio.json')
    writeFileSync(join(root, 'content-studio/narration/act1.edits.json'), '{ broken')
    const result = await setCue(projectFile, 'act1', 'a', '[x]')
    expect(result).toMatchObject({
      ok: false,
      problems: [{ file: 'content-studio/narration/act1.edits.json' }],
    })
    expect(readFileSync(join(root, 'content-studio/narration/act1.edits.json'), 'utf8')).toBe(
      '{ broken',
    )
  })

  it('writes nothing when the cue does not change', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'content-studio.json')
    const cuesFile = join(root, 'content-studio/narration/act1.edits.json')
    expect(await setCue(projectFile, 'act1', 'a', '')).toEqual({ ok: true })
    expect(existsSync(cuesFile)).toBe(false)
    writeFileSync(cuesFile, '{\n    "cues": { "a": "[caf\\u00e9]" }\n}')
    expect(await setCue(projectFile, 'act1', 'a', '[café]')).toEqual({ ok: true })
    expect(await setCue(projectFile, 'act1', 'b', ' ')).toEqual({ ok: true })
    expect(readFileSync(cuesFile, 'utf8')).toBe('{\n    "cues": { "a": "[caf\\u00e9]" }\n}')
  })

  it('refuses a number-like key that JavaScript would move to the front', async () => {
    const root = tempRepo({
      ...files,
      'tts/act1/script.json': [
        { id: 'b', speaker: 'mira', text: 'Goodbye.' },
        { id: '10', speaker: 'mira', text: 'Ten.' },
      ],
      'content-studio/narration/act1.edits.json': { cues: { b: '[sad]' } },
    })
    const result = await setCue(join(root, 'content-studio.json'), 'act1', '10', '[x]')
    expect(result).toMatchObject({
      ok: false,
      problems: [{ file: 'content-studio/narration/act1.edits.json', path: 'cues.10' }],
    })
    expect(
      JSON.parse(readFileSync(join(root, 'content-studio/narration/act1.edits.json'), 'utf8')),
    ).toEqual({ cues: { b: '[sad]' } })
  })

  it('saves a cue for a line keyed like an object property', async () => {
    const root = tempRepo({
      ...files,
      'tts/act1/script.json': [{ id: '__proto__', speaker: 'mira', text: 'Odd.' }],
    })
    const projectFile = join(root, 'content-studio.json')
    expect(await setCue(projectFile, 'act1', '__proto__', '[odd]')).toEqual({ ok: true })
    expect(readFileSync(join(root, 'content-studio/narration/act1.edits.json'), 'utf8')).toBe(
      '{\n  "cues": {\n    "__proto__": "[odd]"\n  },\n  "scenes": {}\n}\n',
    )
  })

  it('knows no unknown part or line', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'content-studio.json')
    expect(await setCue(projectFile, 'act9', 'a', '[x]')).toBeNull()
    expect(await setCue(projectFile, 'act1', 'nope', '[x]')).toBeNull()
  })
})

describe('moveCue', () => {
  const withOrphan = {
    ...files,
    'content-studio/narration/act1.edits.json':
      '{\n  "cues": {\n    "zz": "[old]",\n    "gone": "[sad]",\n    "b": "[x]"\n  },\n  "scenes": {}\n}\n',
  }

  it('gives an orphaned cue to a line, in its place in the file', async () => {
    const root = tempRepo(withOrphan)
    expect(await moveCue(join(root, 'content-studio.json'), 'act1', 'gone', 'a')).toEqual({
      ok: true,
    })
    expect(readFileSync(join(root, 'content-studio/narration/act1.edits.json'), 'utf8')).toBe(
      '{\n  "cues": {\n    "zz": "[old]",\n    "a": "[sad]",\n    "b": "[x]"\n  },\n  "scenes": {}\n}\n',
    )
  })

  it('keeps every cue while the dialog is gone', async () => {
    const root = tempRepo({
      'content-studio.json': projectJson(),
      'content-studio/narration/act1.edits.json': { cues: { gone: '[sad]' } },
    })
    const result = await moveCue(join(root, 'content-studio.json'), 'act1', 'gone', null)
    expect(result).toMatchObject({
      ok: false,
      problems: [{ file: 'content-studio/narration/act1.edits.json' }],
    })
    expect(readFileSync(join(root, 'content-studio/narration/act1.edits.json'), 'utf8')).toContain(
      'gone',
    )
  })

  it('removes an orphaned cue', async () => {
    const root = tempRepo(withOrphan)
    expect(await moveCue(join(root, 'content-studio.json'), 'act1', 'gone', null)).toEqual({
      ok: true,
    })
    expect(readFileSync(join(root, 'content-studio/narration/act1.edits.json'), 'utf8')).toBe(
      '{\n  "cues": {\n    "zz": "[old]",\n    "b": "[x]"\n  },\n  "scenes": {}\n}\n',
    )
  })

  it('refuses a line that already has its own cue, and a cue that is not orphaned', async () => {
    const root = tempRepo(withOrphan)
    const projectFile = join(root, 'content-studio.json')
    expect(await moveCue(projectFile, 'act1', 'gone', 'b')).toMatchObject({
      ok: false,
      problems: [{ path: 'cues.b' }],
    })
    expect(await moveCue(projectFile, 'act1', 'b', 'a')).toMatchObject({
      ok: false,
      problems: [{ path: 'cues.b' }],
    })
  })

  it('knows no unknown cue or line', async () => {
    const root = tempRepo(withOrphan)
    const projectFile = join(root, 'content-studio.json')
    expect(await moveCue(projectFile, 'act1', 'nope', 'a')).toBeNull()
    expect(await moveCue(projectFile, 'act1', 'gone', 'nope')).toBeNull()
  })
})

describe('cues in a language besides the source', () => {
  const several = projectJson()
  const narration = several.narration as Record<string, unknown>
  several.languages = ['en', 'sv']
  Object.assign(narration, narrationInLanguages())
  const swedish = {
    'content-studio.json': several,
    'content-studio/narration/cast.json': {
      speakers: { mira: { voice: 'v1', style: '[warm]', languages: { sv: { voice: 'v2' } } } },
    },
    'tts/act1/en/script.json': [{ id: 'a', speaker: 'mira', text: 'Hello.' }],
    'tts/act1/sv/script.json': [{ id: 'a', speaker: 'mira', text: 'Hej.' }],
    'content-studio/narration/act1.edits.json':
      '{\n  "cues": {\n    "a": "[worried]"\n  },\n  "scenes": {}\n}\n',
  }
  const cueOf = async (projectFile: string, language: string) => {
    const part = await loadPart(projectFile, 'act1', language)
    return part?.ok ? part.part.lines.find((l) => l.key === 'a') : undefined
  }

  it('gives the line its own cue in that language only, never changing the source’s', async () => {
    const root = tempRepo(swedish)
    const projectFile = join(root, 'content-studio.json')
    expect(await setCue(projectFile, 'act1', 'a', '[mjukt]', 'sv')).toEqual({ ok: true })
    expect(readFileSync(join(root, 'content-studio/narration/act1.sv.edits.json'), 'utf8')).toBe(
      '{\n  "cues": {\n    "a": "[mjukt]"\n  },\n  "scenes": {}\n}\n',
    )
    expect(readFileSync(join(root, 'content-studio/narration/act1.edits.json'), 'utf8')).toBe(
      '{\n  "cues": {\n    "a": "[worried]"\n  },\n  "scenes": {}\n}\n',
    )
    expect(await cueOf(projectFile, 'sv')).toMatchObject({ cue: '[mjukt]', cueFrom: 'own' })
    expect(await cueOf(projectFile, 'en')).toMatchObject({ cue: '[worried]', cueFrom: 'own' })
  })

  it('goes back to following the source cue when its own is cleared', async () => {
    const root = tempRepo(swedish)
    const projectFile = join(root, 'content-studio.json')
    await setCue(projectFile, 'act1', 'a', '[mjukt]', 'sv')
    await setCue(projectFile, 'act1', 'a', '', 'sv')
    expect(await cueOf(projectFile, 'sv')).toMatchObject({ cue: '[worried]', cueFrom: 'source' })
  })

  it('moves an orphaned cue of the language to a line of it', async () => {
    const root = tempRepo({
      ...swedish,
      'content-studio/narration/act1.sv.edits.json':
        '{\n  "cues": {\n    "old": "[x]"\n  },\n  "scenes": {}\n}\n',
    })
    const projectFile = join(root, 'content-studio.json')
    expect(await moveCue(projectFile, 'act1', 'old', 'a', 'sv')).toEqual({ ok: true })
    expect(await cueOf(projectFile, 'sv')).toMatchObject({ cue: '[x]', cueFrom: 'own' })
  })
})

describe('scene cues', () => {
  const scened = {
    ...files,
    'tts/act1/script.json': [
      { id: 'a', speaker: 'narrator', text: 'Hello.', scene: 'Cave' },
      { id: 'b', speaker: 'narrator', text: 'Goodbye.', scene: 'Meadow' },
    ],
    'content-studio/narration/cast.json': {
      speakers: { narrator: { voice: 'v1', style: '[warm]' } },
      pronounce: {},
    },
  }
  const cuesOf = (root: string) =>
    readFileSync(join(root, 'content-studio/narration/act1.edits.json'), 'utf8')

  it('saves a scene’s cue under scene:<name>, after the others, and the narrator follows it', async () => {
    const root = tempRepo({
      ...scened,
      'content-studio/narration/act1.edits.json':
        '{\n  "cues": {\n    "b": "[sad]"\n  },\n  "scenes": {}\n}\n',
    })
    const projectFile = join(root, 'content-studio.json')
    expect(await setSceneCue(projectFile, 'act1', 'Cave', ' [dark] ')).toEqual({ ok: true })
    expect(cuesOf(root)).toBe(
      '{\n  "cues": {\n    "b": "[sad]"\n  },\n  "scenes": {\n    "Cave": "[dark]"\n  }\n}\n',
    )
    const part = await loadPart(projectFile, 'act1')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'a')).toMatchObject({
      cue: '[dark]',
      cueFrom: 'scene',
    })
  })

  it('removes the cue when it is cleared, and writes nothing when it does not change', async () => {
    const root = tempRepo(scened)
    const projectFile = join(root, 'content-studio.json')
    await setSceneCue(projectFile, 'act1', 'Cave', '[dark]')
    const before = cuesOf(root)
    await setSceneCue(projectFile, 'act1', 'Cave', '[dark]')
    expect(cuesOf(root)).toBe(before)
    await setSceneCue(projectFile, 'act1', 'Cave', '')
    expect(cuesOf(root)).toBe('{\n  "cues": {},\n  "scenes": {}\n}\n')
  })

  it('knows no unknown scene or part', async () => {
    const root = tempRepo(scened)
    const projectFile = join(root, 'content-studio.json')
    expect(await setSceneCue(projectFile, 'act1', 'Nowhere', '[x]')).toBeNull()
    expect(await setSceneCue(projectFile, 'nope', 'Cave', '[x]')).toBeNull()
  })

  it('gives an orphaned scene cue to another scene, or removes it; never one still in the dialog', async () => {
    const root = tempRepo({
      ...scened,
      'content-studio/narration/act1.edits.json':
        '{\n  "cues": {},\n  "scenes": {\n    "Gone": "[old]",\n    "Cave": "[dark]"\n  }\n}\n',
    })
    const projectFile = join(root, 'content-studio.json')
    expect(await moveSceneCue(projectFile, 'act1', 'Cave', 'Meadow')).toMatchObject({ ok: false })
    expect(await moveSceneCue(projectFile, 'act1', 'Gone', 'Cave')).toMatchObject({ ok: false })
    expect(await moveSceneCue(projectFile, 'act1', 'Gone', 'Meadow')).toEqual({ ok: true })
    expect(cuesOf(root)).toBe(
      '{\n  "cues": {},\n  "scenes": {\n    "Meadow": "[old]",\n    "Cave": "[dark]"\n  }\n}\n',
    )
    const other = tempRepo({
      ...scened,
      'content-studio/narration/act1.edits.json': { scenes: { Gone: '[old]' } },
    })
    expect(await moveSceneCue(join(other, 'content-studio.json'), 'act1', 'Gone', null)).toEqual({
      ok: true,
    })
    expect(cuesOf(other)).toBe('{\n  "cues": {},\n  "scenes": {}\n}\n')
    expect(await moveSceneCue(join(other, 'content-studio.json'), 'act1', 'Gone', null)).toBeNull()
  })

  it('follows the source language’s scene name, and writes the language’s own cue only', async () => {
    const several = projectJson()
    const narration = several.narration as Record<string, unknown>
    several.languages = ['en', 'sv']
    Object.assign(narration, narrationInLanguages())
    const root = tempRepo({
      'content-studio.json': several,
      'content-studio/narration/cast.json': {
        speakers: { narrator: { voice: 'v1', languages: { sv: { voice: 'v2' } } } },
      },
      'tts/act1/en/script.json': [{ id: 'a', speaker: 'narrator', text: 'Hi.', scene: 'Cave' }],
      'tts/act1/sv/script.json': [{ id: 'a', speaker: 'narrator', text: 'Hej.' }],
      'content-studio/narration/act1.edits.json': { scenes: { Cave: '[dark]' } },
    })
    const projectFile = join(root, 'content-studio.json')
    const line = async () => {
      const part = await loadPart(projectFile, 'act1', 'sv')
      return part?.ok ? part.part.lines[0] : undefined
    }
    expect(await line()).toMatchObject({ cue: '[dark]', cueFrom: 'sceneSource' })
    // What is recorded, adopted and tried reads the same lines as the page: with the source's scene.
    const read = await readPart(projectFile, 'act1', 'sv')
    if (!read?.ok) throw new Error('part unreadable')
    const sv = read.input.lines[0]!
    expect(sv.scene).toBe('Cave')
    const inputs = clipInputs(
      sv,
      read.input.cast.speakers.narrator,
      read.input.cues,
      {},
      read.project.narration,
    )
    expect(inputs?.cue).toBe('[dark]')
    expect(await setSceneCue(projectFile, 'act1', 'Cave', '[mörkt]', 'sv')).toEqual({ ok: true })
    expect(await line()).toMatchObject({ cue: '[mörkt]', cueFrom: 'scene' })
    expect(readFileSync(join(root, 'content-studio/narration/act1.edits.json'), 'utf8')).toBe(
      '{\n  "scenes": {\n    "Cave": "[dark]"\n  }\n}',
    )
  })
})

describe('cues inside a line', () => {
  const inside = {
    ...files,
    'tts/act1/script.json': [
      { id: 'a', speaker: 'mira', text: 'I did it. I will fix it.' },
      { id: 'b', speaker: 'mira', text: 'Goodbye.' },
    ],
  }
  const cuesAt = (root: string) =>
    readFileSync(join(root, 'content-studio/narration/act1.edits.json'), 'utf8')

  it('saves a cue at a gap with its brackets, and the line is stale for it', async () => {
    const root = tempRepo(inside)
    const projectFile = join(root, 'content-studio.json')
    const result = await setInsideCue(projectFile, 'act1', 'a', {
      at: 3,
      cue: ' resolute ',
      text: 'I did it. I will fix it.',
    })
    expect(result).toEqual({ ok: true })
    expect(cuesAt(root)).toBe(
      '{\n  "cues": {\n    "a": "I did it. [resolute] I will fix it."\n  },\n  "scenes": {}\n}\n',
    )
    const part = await loadPart(projectFile, 'act1')
    expect(part?.ok && part.part.lines[0]).toMatchObject({
      cue: '[warm]',
      cueFrom: 'style',
      inside: [{ at: 3, cue: '[resolute]' }],
    })
  })

  it('replaces the cue at a gap, removes it when empty, and drops the entry when nothing is left', async () => {
    const root = tempRepo(inside)
    const projectFile = join(root, 'content-studio.json')
    const text = 'I did it. I will fix it.'
    await setInsideCue(projectFile, 'act1', 'a', { at: 3, cue: '[a]', text })
    await setInsideCue(projectFile, 'act1', 'a', { at: 3, cue: '[b]', text })
    await setInsideCue(projectFile, 'act1', 'a', { at: 1, cue: '[c]', text })
    expect(cuesAt(root)).toBe(
      '{\n  "cues": {\n    "a": "I [c] did it. [b] I will fix it."\n  },\n  "scenes": {}\n}\n',
    )
    await setInsideCue(projectFile, 'act1', 'a', { at: 3, cue: '', text })
    await setInsideCue(projectFile, 'act1', 'a', { at: 1, cue: '', text })
    expect(cuesAt(root)).toBe('{\n  "cues": {},\n  "scenes": {}\n}\n')
  })

  it('keeps the opening cue, and the opening cue edit keeps the cues inside', async () => {
    const root = tempRepo(inside)
    const projectFile = join(root, 'content-studio.json')
    const text = 'I did it. I will fix it.'
    await setCue(projectFile, 'act1', 'a', '[ashamed]')
    await setInsideCue(projectFile, 'act1', 'a', { at: 3, cue: '[resolute]', text })
    await setCue(projectFile, 'act1', 'a', '[proud]')
    expect(cuesAt(root)).toBe(
      '{\n  "cues": {\n    "a": "[proud] I did it. [resolute] I will fix it."\n  },\n  "scenes": {}\n}\n',
    )
    await setCue(projectFile, 'act1', 'a', '')
    expect(cuesAt(root)).toBe(
      '{\n  "cues": {\n    "a": "I did it. [resolute] I will fix it."\n  },\n  "scenes": {}\n}\n',
    )
  })

  it('refuses a cue when the words changed since the page showed them', async () => {
    const root = tempRepo(inside)
    const projectFile = join(root, 'content-studio.json')
    const result = await setInsideCue(projectFile, 'act1', 'a', {
      at: 3,
      cue: '[a]',
      text: 'I did it. I will mend it.',
    })
    expect(result).toMatchObject({
      ok: false,
      problems: [{ message: expect.stringContaining('words changed') }],
    })
    expect(existsSync(join(root, 'content-studio/narration/act1.edits.json'))).toBe(false)
  })

  it('refuses a place that is not between two words', async () => {
    const root = tempRepo(inside)
    const projectFile = join(root, 'content-studio.json')
    const text = 'I did it. I will fix it.'
    for (const at of [0, 7, 2.5]) {
      expect(await setInsideCue(projectFile, 'act1', 'a', { at, cue: '[a]', text })).toMatchObject({
        ok: false,
      })
    }
  })

  it('replaces an entry whose words no longer fit when the opening cue is set again', async () => {
    const root = tempRepo(inside)
    const projectFile = join(root, 'content-studio.json')
    writeFileSync(
      join(root, 'content-studio/narration/act1.edits.json'),
      '{\n  "cues": {\n    "a": "[old] I did it. [x] I will mend it."\n  },\n  "scenes": {}\n}\n',
    )
    await setCue(projectFile, 'act1', 'a', '[new]')
    expect(cuesAt(root)).toBe('{\n  "cues": {\n    "a": "[new]"\n  },\n  "scenes": {}\n}\n')
  })

  it('places a cue on a stale entry afresh, dropping the old one', async () => {
    const root = tempRepo(inside)
    const projectFile = join(root, 'content-studio.json')
    writeFileSync(
      join(root, 'content-studio/narration/act1.edits.json'),
      '{\n  "cues": {\n    "a": "[old] I did it. [x] I will mend it."\n  },\n  "scenes": {}\n}\n',
    )
    await setInsideCue(projectFile, 'act1', 'a', {
      at: 3,
      cue: '[a]',
      text: 'I did it. I will fix it.',
    })
    expect(cuesAt(root)).toBe(
      '{\n  "cues": {\n    "a": "[old] I did it. [a] I will fix it."\n  },\n  "scenes": {}\n}\n',
    )
  })

  it('refuses a cue with brackets inside it, and one on a line whose own words have brackets', async () => {
    const root = tempRepo({
      ...inside,
      'tts/act1/script.json': [
        { id: 'a', speaker: 'mira', text: 'I did it. I will fix it.' },
        { id: 'b', speaker: 'mira', text: '[E] to open the door' },
      ],
    })
    const projectFile = join(root, 'content-studio.json')
    const text = 'I did it. I will fix it.'
    await setInsideCue(projectFile, 'act1', 'a', { at: 2, cue: '[keep]', text })
    for (const cue of ['very [sad] slowly', 'sad]']) {
      expect(await setInsideCue(projectFile, 'act1', 'a', { at: 3, cue, text })).toMatchObject({
        ok: false,
      })
    }
    expect(cuesAt(root)).toBe(
      '{\n  "cues": {\n    "a": "I did [keep] it. I will fix it."\n  },\n  "scenes": {}\n}\n',
    )
    expect(
      await setInsideCue(projectFile, 'act1', 'b', {
        at: 1,
        cue: '[x]',
        text: '[E] to open the door',
      }),
    ).toMatchObject({ ok: false })
  })

  it('keeps the free text of an opening cue when the words changed and a cue is placed again', async () => {
    const root = tempRepo(inside)
    const projectFile = join(root, 'content-studio.json')
    writeFileSync(
      join(root, 'content-studio/narration/act1.edits.json'),
      '{\n  "cues": {\n    "a": "[sad] very slowly I did it. [x] I will mend it."\n  },\n  "scenes": {}\n}\n',
    )
    await setInsideCue(projectFile, 'act1', 'a', {
      at: 3,
      cue: '[a]',
      text: 'I did it. I will fix it.',
    })
    expect(cuesAt(root)).toBe(
      '{\n  "cues": {\n    "a": "[sad] very slowly I did it. [a] I will fix it."\n  },\n  "scenes": {}\n}\n',
    )
  })
})
