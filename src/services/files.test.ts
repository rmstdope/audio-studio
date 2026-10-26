import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempRepo } from '../../test/helpers'
import { formatEntriesPerLine, listFiles, readJson, writeAtomic, writeFailure } from './files'

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

describe('writeAtomic, twice at once', () => {
  it('leaves one complete write and no temporary files', async () => {
    const root = tempRepo({})
    const a = 'a'.repeat(200_000)
    const b = 'b'.repeat(200_000)
    await Promise.all([writeAtomic(root, 'x.json', a), writeAtomic(root, 'x.json', b)])
    expect([a, b]).toContain(readFileSync(join(root, 'x.json'), 'utf8'))
    expect(readdirSync(root)).toEqual(['x.json'])
  })
})

describe('writeAtomic, when the write fails', () => {
  it('throws and leaves no temporary file', async () => {
    const root = tempRepo({ 'taken/x': 'a folder where the file should go' })
    await expect(writeAtomic(root, 'taken', '{}')).rejects.toThrow()
    expect(readdirSync(root)).toEqual(['taken'])
  })
})

describe('readJson, unreadable', () => {
  it('reports a path that is a folder as invalid, not as a crash', async () => {
    const root = tempRepo({ 'folder/x': 'x' })
    const read = await readJson(join(root, 'folder'))
    expect(read.status).toBe('invalid')
  })
})

describe('writeFailure', () => {
  const failed = (code: string) => Object.assign(new Error(`${code}: open 'x.tmp'`), { code })

  it('names the cause a user can act on, not the call that met it', () => {
    expect(writeFailure(failed('EACCES'))).toBe('permission denied')
    expect(writeFailure(failed('EPERM'))).toBe('permission denied')
    expect(writeFailure(failed('EROFS'))).toBe('the disk is read-only')
    expect(writeFailure(failed('ENOSPC'))).toBe('the disk is full')
    expect(writeFailure(failed('EDQUOT'))).toBe('the disk quota is used up')
  })

  it('gives an unknown error’s own message', () => {
    expect(writeFailure(failed('EIO'))).toBe("EIO: open 'x.tmp'")
    expect(writeFailure(failed('toString'))).toBe("toString: open 'x.tmp'")
  })
})
