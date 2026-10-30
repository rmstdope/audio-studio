import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { Recording } from '../core/spending'
import { createBudget } from '../core/spend'
import type { MusicSpend } from '../core/spending'
import {
  appendMusic,
  appendRecording,
  appendTry,
  createSpendLog,
  readSpending,
  SPENDING_FILE,
} from './spending'

const rec = (id: string, over: Partial<Recording> = {}): Recording => ({
  id,
  at: '2026-10-25T14:02:00.000Z',
  part: 'act1',
  language: 'en',
  model: 'drama-3',
  stage: 'draft',
  lines: 3,
  planned: 3,
  cost: 0.5,
  outcome: 'done',
  ...over,
})
const project = () =>
  join(tempRepo({ 'content-studio.json': projectJson() }), 'content-studio.json')

describe('the spending record', () => {
  it('is empty before anything was recorded', async () => {
    expect(await readSpending(project())).toEqual({
      ok: true,
      recordings: [],
      music: [],
      tries: [],
    })
  })

  it('keeps recordings across reads (a restart), in the order added', async () => {
    const file = project()
    await appendRecording(file, rec('a'))
    await appendRecording(file, rec('b', { cost: 0.25 }))
    const read = await readSpending(file)
    expect(read.ok && read.recordings.map((r) => r.id)).toEqual(['a', 'b'])
    const text = readFileSync(join(dirname(file), SPENDING_FILE), 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text).version).toBe(1)
  })

  it('keeps every one of recordings ending at the same time', async () => {
    const file = project()
    await Promise.all(['a', 'b', 'c', 'd'].map((id) => appendRecording(file, rec(id))))
    const read = await readSpending(file)
    expect(read.ok && read.recordings).toHaveLength(4)
  })

  it('reports a damaged file with its place, and never overwrites it', async () => {
    const file = project()
    const path = join(dirname(file), SPENDING_FILE)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ version: 1, recordings: [{ id: 1 }] }))
    const read = await readSpending(file)
    expect(read.ok).toBe(false)
    if (!read.ok) {
      expect(read.problems[0]).toMatchObject({ file: SPENDING_FILE, path: 'recordings[0].id' })
    }
    const added = await appendRecording(file, rec('a'))
    expect(added.ok).toBe(false)
    expect(readFileSync(path, 'utf8')).toContain('"id":1')
  })

  it('reports a file that is not JSON', async () => {
    const file = project()
    const path = join(dirname(file), SPENDING_FILE)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '{ nope')
    const read = await readSpending(file)
    expect(!read.ok && read.problems[0]!.message).toContain('not valid JSON')
  })
})

describe('the spending record, version 2', () => {
  const take = (id: string): MusicSpend => ({
    id,
    at: '2026-10-25T16:00:00.000Z',
    part: 'act1',
    track: 'cave',
    title: 'The cave',
    model: 'eleven',
    seconds: 110,
    cost: 0.275,
    outcome: 'done',
  })
  const versionOf = (file: string) =>
    JSON.parse(readFileSync(join(dirname(file), SPENDING_FILE), 'utf8')).version

  it('stays version 1 while it holds Fish recordings alone, an older studio can read it', async () => {
    const file = project()
    await appendRecording(file, rec('a'))
    expect(versionOf(file)).toBe(1)
  })

  it('moves to version 2 with a recording’s credits, keeping what was there', async () => {
    const file = project()
    await appendRecording(file, rec('a'))
    await appendRecording(file, rec('b', { credits: 120, elevenModel: 'eleven_v3' }))
    expect(versionOf(file)).toBe(2)
    expect(await readSpending(file)).toEqual({
      ok: true,
      recordings: [rec('a'), rec('b', { credits: 120, elevenModel: 'eleven_v3' })],
      music: [],
      tries: [],
    })
  })

  it('keeps a music take as a row of its own, in version 2', async () => {
    const file = project()
    await appendRecording(file, rec('a'))
    await appendMusic(file, take('m1'))
    expect(versionOf(file)).toBe(2)
    const read = await readSpending(file)
    expect(read.ok && read.music).toEqual([take('m1')])
    expect(read.ok && read.recordings.map((r) => r.id)).toEqual(['a'])
  })

  it('keeps a take or try with an ElevenLabs voice as a row of its own, in version 2', async () => {
    const file = project()
    await appendRecording(file, rec('a'))
    const tried = {
      id: 't1',
      at: '2026-10-25T17:00:00.000Z',
      kind: 'try' as const,
      character: 'mira',
      part: 'act1',
      language: 'en',
      model: 'eleven_v3',
      characters: 42,
      credits: 42,
    }
    await appendTry(file, tried)
    await appendMusic(file, take('m1'))
    expect(versionOf(file)).toBe(2)
    const read = await readSpending(file)
    expect(read.ok && read.tries).toEqual([tried])
    expect(read.ok && read.music).toEqual([take('m1')])
  })
})

describe('the spend log, with ElevenLabs credits', () => {
  it('follows a recording that spends credits alone, and saves both amounts', async () => {
    const file = project()
    const log = createSpendLog(file)
    const budget = createBudget({ model: 's2.1-pro-free', dollars: 0 })
    const credits = createBudget({ model: 'eleven_v3', dollars: 100 })
    const followed = log.follow({
      part: 'act1',
      language: 'en',
      model: 's2.1-pro-free',
      stage: 'draft',
      planned: 1,
      budget,
      credits,
      progress: () => ({ lines: 0 }),
    })
    expect(credits.spend('eleven_v3', 'Once.', new Date())).toBeNull()
    expect(log.running()).toMatchObject([{ cost: 0, credits: 5, elevenModel: 'eleven_v3' }])
    await followed.end({ lines: 1, outcome: 'done' })
    const read = await readSpending(file)
    expect(read.ok && read.recordings).toMatchObject([
      { part: 'act1', cost: 0, credits: 5, elevenModel: 'eleven_v3', lines: 1 },
    ])
  })

  it('saves a Fish recording without credits as before', async () => {
    const file = project()
    const log = createSpendLog(file)
    const budget = createBudget({ model: 's2-pro', dollars: 1 })
    const followed = log.follow({
      part: 'act1',
      language: 'en',
      model: 's2-pro',
      stage: 'draft',
      planned: 1,
      budget,
      credits: createBudget({ model: 'eleven_v3', dollars: 0 }),
      progress: () => ({ lines: 0 }),
    })
    budget.spend('s2-pro', 'x'.repeat(1000), new Date())
    await followed.end({ lines: 1, outcome: 'done' })
    const read = await readSpending(file)
    expect(read.ok && read.recordings[0]).not.toHaveProperty('credits')
    expect(JSON.parse(readFileSync(join(dirname(file), SPENDING_FILE), 'utf8')).version).toBe(1)
  })
})

describe('the spend log, credits given but not spent', () => {
  it('saves the recording as Fish’s alone, so the record stays version 1', async () => {
    const file = project()
    const log = createSpendLog(file)
    const budget = createBudget({ model: 's2-pro', dollars: 1 })
    const followed = log.follow({
      part: 'act1',
      language: 'en',
      model: 's2-pro',
      stage: 'draft',
      planned: 2,
      budget,
      credits: createBudget({ model: 'eleven_v3', dollars: 100 }),
      progress: () => ({ lines: 0 }),
    })
    budget.spend('s2-pro', 'x'.repeat(1000), new Date())
    expect(log.running()[0]).not.toHaveProperty('credits')
    await followed.end({ lines: 1, outcome: 'error' })
    const read = await readSpending(file)
    expect(read.ok && read.recordings[0]).not.toHaveProperty('elevenModel')
    expect(JSON.parse(readFileSync(join(dirname(file), SPENDING_FILE), 'utf8')).version).toBe(1)
  })
})

describe('appendMusic, to a damaged record', () => {
  it('leaves the record as it is and gives its problems', async () => {
    const file = project()
    const path = join(dirname(file), SPENDING_FILE)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ version: 2, recordings: [], music: [{ id: 1 }] }))
    const added = await appendMusic(file, {
      id: 'm1',
      at: '2026-10-25T16:00:00.000Z',
      part: 'act1',
      track: 'cave',
      title: 'The cave',
      model: 'eleven',
      seconds: 110,
      cost: 0.275,
      outcome: 'done',
    })
    expect(added.ok).toBe(false)
    expect(!added.ok && added.problems[0]).toMatchObject({ path: 'music[0].id' })
    expect(readFileSync(path, 'utf8')).toContain('"id":1')
  })
})
