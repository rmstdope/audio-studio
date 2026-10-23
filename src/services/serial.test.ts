import { describe, expect, it } from 'bun:test'
import { createSerial } from './serial'

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('createSerial', () => {
  it('runs jobs for one key one after another, in order', async () => {
    const serial = createSerial()
    const log: string[] = []
    const job = (name: string, ms: number) => async () => {
      log.push(`${name} start`)
      await tick(ms)
      log.push(`${name} end`)
      return name
    }
    const results = await Promise.all([serial.run('k', job('a', 15)), serial.run('k', job('b', 1))])
    expect(results).toEqual(['a', 'b'])
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end'])
  })

  it('runs different keys side by side, and goes on after a failure', async () => {
    const serial = createSerial()
    const log: string[] = []
    await Promise.all([
      serial.run('x', async () => {
        await tick(10)
        log.push('x')
      }),
      serial.run('y', async () => {
        log.push('y')
      }),
    ])
    expect(log).toEqual(['y', 'x'])
    await expect(serial.run('k', () => Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(await serial.run('k', async () => 'yes')).toBe('yes')
  })
})
