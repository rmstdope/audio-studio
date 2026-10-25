import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { Recording } from '../core/spending'
import { appendRecording, readSpending, SPENDING_FILE } from './spending'

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
const project = () => join(tempRepo({ 'audio-studio.json': projectJson() }), 'audio-studio.json')

describe('the spending record', () => {
  it('is empty before anything was recorded', async () => {
    expect(await readSpending(project())).toEqual({ ok: true, recordings: [] })
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
