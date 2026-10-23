import { describe, expect, it } from 'bun:test'
import { createLimiter } from './limit'

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('createLimiter', () => {
  it('runs at most `limit` jobs at once', async () => {
    const limiter = createLimiter()
    let running = 0
    let most = 0
    const job = async () => {
      running++
      most = Math.max(most, running)
      await tick()
      running--
    }
    await Promise.all(Array.from({ length: 6 }, (_, i) => limiter.run(`k${i}`, 2, job)))
    expect(most).toBe(2)
  })

  it('shares one run between requests for the same key', async () => {
    const limiter = createLimiter()
    let runs = 0
    const job = async () => {
      runs++
      await tick()
      return 'done'
    }
    const results = await Promise.all([limiter.run('a', 4, job), limiter.run('a', 4, job)])
    expect(results).toEqual(['done', 'done'])
    expect(runs).toBe(1)
    await limiter.run('a', 4, job)
    expect(runs).toBe(2)
  })

  it('passes on a failure and keeps going', async () => {
    const limiter = createLimiter()
    await expect(limiter.run('a', 1, () => Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(await limiter.run('b', 1, async () => 'yes')).toBe('yes')
  })
})
