import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { readTakeTimes, recordTakeTime } from './takeTimes'

const repo = () => tempRepo({ 'content-studio.json': projectJson() })
const fileOf = (root: string) => join(root, 'content-studio.json')
const timesFile = (root: string) => join(root, 'content-studio/cache/take-times.json')

describe('the take timings', () => {
  it('are none when there is no file', async () => {
    expect(await readTakeTimes(fileOf(repo()))).toEqual({})
  })

  it('keep the last five of each key, in the cache', async () => {
    const root = repo()
    for (const s of [1, 2, 3, 4, 5, 6]) await recordTakeTime(fileOf(root), 'klein', s)
    await recordTakeTime(fileOf(root), 'klein-edit', 90)
    expect(await readTakeTimes(fileOf(root))).toEqual({
      klein: [2, 3, 4, 5, 6],
      'klein-edit': [90],
    })
    expect(existsSync(timesFile(root))).toBe(true)
  })

  it('drop one bad value and keep the rest', async () => {
    const root = repo()
    mkdirSync(join(root, 'content-studio/cache'), { recursive: true })
    writeFileSync(
      timesFile(root),
      JSON.stringify({ klein: [10, 'x', null, -1, 12], 'qwen-edit': [400] }),
    )
    expect(await readTakeTimes(fileOf(root))).toEqual({ klein: [10, 12], 'qwen-edit': [400] })
  })

  it('lose no time when two takes finish together', async () => {
    const root = repo()
    await Promise.all([10, 20, 30].map((s) => recordTakeTime(fileOf(root), 'qwen-edit', s)))
    expect((await readTakeTimes(fileOf(root)))['qwen-edit']?.toSorted()).toEqual([10, 20, 30])
  })

  it('are none, without an error, when the file is broken', async () => {
    const root = repo()
    mkdirSync(join(root, 'content-studio/cache'), { recursive: true })
    writeFileSync(timesFile(root), '{ not json')
    expect(await readTakeTimes(fileOf(root))).toEqual({})
    writeFileSync(timesFile(root), JSON.stringify({ klein: 'fast' }))
    expect(await readTakeTimes(fileOf(root))).toEqual({})
    // The next finished take starts the file again.
    await recordTakeTime(fileOf(root), 'klein', 20)
    expect(JSON.parse(readFileSync(timesFile(root), 'utf8'))).toEqual({ klein: [20] })
  })

  it('drop a time that is not a positive number', async () => {
    const root = repo()
    mkdirSync(join(root, 'content-studio/cache'), { recursive: true })
    writeFileSync(timesFile(root), JSON.stringify({ klein: [-1, 0, 25] }))
    expect(await readTakeTimes(fileOf(root))).toEqual({ klein: [25] })
  })
})
