import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { allowVoices, RULED_OUT_DIR, ruledOutIds, ruledOutVoices, updateRuledOut } from './ruledOut'

/** Rules voices out, as a drop does. */
const ruleOutVoices = (
  projectFile: string,
  characterId: string,
  voices: { id: string; title: string }[],
  at?: Date,
) => updateRuledOut(projectFile, characterId, { out: voices }, at)

const files = {
  'audio-studio.json': projectJson(),
  'tts/cast.json': { speakers: { mira: { voice: 'cur' } } },
  'tts/act1/script.json': [{ key: 'a1', speaker: 'mira', text: 'Welcome.' }],
}

function project() {
  return join(tempRepo(files), 'audio-studio.json')
}

describe('ruled-out voices, saved', () => {
  it('has none at first', async () => {
    const projectFile = project()
    expect(await ruledOutVoices(projectFile, 'mira')).toEqual({ ok: true, voices: [] })
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
  })

  it('saves voices ruled out, in the tool’s cache, and lists the latest first', async () => {
    const projectFile = project()
    await ruleOutVoices(
      projectFile,
      'mira',
      [{ id: 'a', title: 'A' }],
      new Date('2026-10-24T10:00:00Z'),
    )
    await ruleOutVoices(
      projectFile,
      'mira',
      [{ id: 'b', title: 'B' }],
      new Date('2026-10-24T11:00:00Z'),
    )
    expect(await ruledOutVoices(projectFile, 'mira')).toEqual({
      ok: true,
      voices: [
        { id: 'b', title: 'B', at: '2026-10-24T11:00:00.000Z' },
        { id: 'a', title: 'A', at: '2026-10-24T10:00:00.000Z' },
      ],
    })
    const saved = readdirSync(join(projectFile, '..', RULED_OUT_DIR))
    expect(saved).toHaveLength(1)
    expect(saved[0]).toStartWith('mira-')
  })

  it('applies changes made at once one after the other', async () => {
    const projectFile = project()
    await Promise.all(
      ['a', 'b', 'c'].map((id) => ruleOutVoices(projectFile, 'mira', [{ id, title: id }])),
    )
    expect((await ruledOutIds(projectFile, 'mira')).sort()).toEqual(['a', 'b', 'c'])
  })

  it('allows one voice again, or forgets them all', async () => {
    const projectFile = project()
    await ruleOutVoices(projectFile, 'mira', [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ])
    const one = await allowVoices(projectFile, 'mira', ['a'])
    expect(one?.ok && one.voices.map((v) => v.id)).toEqual(['b'])
    expect(await allowVoices(projectFile, 'mira', 'all')).toEqual({ ok: true, voices: [] })
    expect(existsSync(join(projectFile, '..', RULED_OUT_DIR))).toBe(true)
    expect(readdirSync(join(projectFile, '..', RULED_OUT_DIR))).toEqual([])
  })

  it('writes nothing when nothing changes', async () => {
    const projectFile = project()
    const dir = join(projectFile, '..', RULED_OUT_DIR)
    await allowVoices(projectFile, 'mira', 'all')
    expect(existsSync(dir)).toBe(false)
    await ruleOutVoices(
      projectFile,
      'mira',
      [{ id: 'a', title: 'A' }],
      new Date('2026-10-24T10:00:00Z'),
    )
    const file = join(dir, readdirSync(dir)[0]!)
    writeFileSync(file, readFileSync(file, 'utf8') + ' ')
    const before = statSync(file).mtimeMs
    await ruleOutVoices(
      projectFile,
      'mira',
      [{ id: 'a', title: 'A' }],
      new Date('2026-10-24T11:00:00Z'),
    )
    await updateRuledOut(projectFile, 'mira', { allowed: ['b'] })
    expect(readFileSync(file, 'utf8')).toEndWith('\n ')
    expect(statSync(file).mtimeMs).toBe(before)
  })

  it('names what is wrong with a broken project file', async () => {
    const projectFile = join(tempRepo({ ...files, 'audio-studio.json': '{' }), 'audio-studio.json')
    expect(await ruledOutVoices(projectFile, 'mira')).toMatchObject({ ok: false })
    expect(await allowVoices(projectFile, 'mira', 'all')).toMatchObject({ ok: false })
  })

  it('answers an unknown character with null', async () => {
    const projectFile = project()
    expect(await ruledOutVoices(projectFile, 'nobody')).toBeNull()
    expect(await allowVoices(projectFile, 'nobody', 'all')).toBeNull()
  })

  it('treats a broken or foreign file as no voices ruled out', async () => {
    const projectFile = project()
    await ruleOutVoices(projectFile, 'mira', [{ id: 'a', title: 'A' }])
    const dir = join(projectFile, '..', RULED_OUT_DIR)
    const [file] = readdirSync(dir)
    writeFileSync(join(dir, file!), '{ broken')
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
    writeFileSync(
      join(dir, file!),
      JSON.stringify({ version: 1, character: 'tilda', voices: { x: { title: 'X', at: 'then' } } }),
    )
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
  })
})

describe('ruled-out voices per language', () => {
  const base = projectJson()
  const several = {
    ...files,
    'audio-studio.json': {
      ...base,
      narration: {
        ...(base.narration as object),
        languages: ['en', 'sv'],
        paths: {
          dialog: 'tts/{part}/{language}/script.json',
          cues: 'tts/{part}/{language}/cues.json',
          lock: 'tts/{part}/{language}/narration.lock.json',
          clips: 'audio/{part}/{language}',
          manifest: 'audio/{part}/{language}/manifest.json',
        },
      },
    },
  }
  const open = () => join(tempRepo(several), 'audio-studio.json')

  it('keeps a list for each language: ruling out in Svenska leaves English alone', async () => {
    const projectFile = open()
    await updateRuledOut(projectFile, 'mira', { out: [{ id: 'a', title: 'A' }], language: 'sv' })
    expect(await ruledOutIds(projectFile, 'mira', 'sv')).toEqual(['a'])
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
    expect(await ruledOutIds(projectFile, 'mira', 'en')).toEqual([])
  })

  it('allows a voice again, or forgets them all, in one language only', async () => {
    const projectFile = open()
    for (const language of ['en', 'sv']) {
      await updateRuledOut(projectFile, 'mira', {
        out: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
        ],
        language,
      })
    }
    await allowVoices(projectFile, 'mira', ['a'], 'sv')
    expect(await ruledOutIds(projectFile, 'mira', 'sv')).toEqual(['b'])
    await allowVoices(projectFile, 'mira', 'all', 'sv')
    expect(await ruledOutIds(projectFile, 'mira', 'sv')).toEqual([])
    expect((await ruledOutIds(projectFile, 'mira')).sort()).toEqual(['a', 'b'])
  })

  it('lists a language’s voices, and takes a language the project lacks for the source language', async () => {
    const projectFile = open()
    await updateRuledOut(projectFile, 'mira', { out: [{ id: 'a', title: 'A' }], language: 'fr' })
    expect(await ruledOutIds(projectFile, 'mira')).toEqual(['a'])
    const listed = await ruledOutVoices(projectFile, 'mira', 'sv')
    expect(listed).toEqual({ ok: true, voices: [] })
  })

  it('keeps the source language’s file where it was', async () => {
    const projectFile = open()
    await updateRuledOut(projectFile, 'mira', { out: [{ id: 'a', title: 'A' }] })
    await updateRuledOut(projectFile, 'mira', { out: [{ id: 'b', title: 'B' }], language: 'sv' })
    const dir = join(projectFile, '..', RULED_OUT_DIR)
    expect(readdirSync(dir)).toHaveLength(2)
    expect(readdirSync(dir).filter((f) => f.startsWith('mira-'))).toHaveLength(1)
    expect(readdirSync(dir).filter((f) => f.startsWith('mira_sv-'))).toHaveLength(1)
  })
})
