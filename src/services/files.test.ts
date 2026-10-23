import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempRepo } from '../../test/helpers'
import { formatEntriesPerLine, listFiles, writeAtomic } from './files'

describe('formatEntriesPerLine', () => {
  it('writes one sorted entry per line, as valid JSON', () => {
    const text = formatEntriesPerLine({ b: { x: 1 }, a: { y: [1, 2] } })
    expect(text).toBe('{\n "a": {"y":[1,2]},\n "b": {"x":1}\n}\n')
    expect(JSON.parse(text)).toEqual({ a: { y: [1, 2] }, b: { x: 1 } })
  })

  it('writes an empty object on one line', () => {
    expect(formatEntriesPerLine({})).toBe('{}\n')
  })
})

describe('writeAtomic', () => {
  it('creates the folder, writes the file and leaves no temporary file', async () => {
    const root = tempRepo({})
    await writeAtomic(root, 'tts/act1/narration.lock.json', '{}\n')
    expect(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8')).toBe('{}\n')
    expect(readdirSync(join(root, 'tts/act1'))).toEqual(['narration.lock.json'])
  })

  it('refuses to write outside the root', async () => {
    const root = tempRepo({})
    await expect(writeAtomic(root, '../escape.json', '{}')).rejects.toThrow('outside')
  })
})

describe('listFiles', () => {
  it('lists the files of a folder, and nothing for a folder that does not exist', async () => {
    const root = tempRepo({ 'clips/a.mp3': 'x', 'clips/sub/b.mp3': 'y' })
    expect(await listFiles(join(root, 'clips'))).toEqual(new Set(['a.mp3']))
    expect(await listFiles(join(root, 'nowhere'))).toEqual(new Set())
  })
})
