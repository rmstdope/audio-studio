import { describe, expect, it } from 'bun:test'
import { createSerial } from './serial'
import { GPU, createGpuWorkers, onGpu } from './gpu'
import type { Transcriber } from './transcriber'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('onGpu', () => {
  it('keeps a transcription and a music job from running at once', async () => {
    const serial = createSerial()
    let running = 0
    let most = 0
    const slow = async () => {
      running++
      most = Math.max(most, running)
      await wait(20)
      running--
      return []
    }
    const whisper = onGpu({ transcribe: slow, close() {} } satisfies Transcriber, serial)
    await Promise.all([
      serial.run(GPU, async () => {
        await slow()
      }),
      whisper.transcribe('tiny', 'a.wav'),
      whisper.transcribe('tiny', 'b.wav'),
    ])
    expect(most).toBe(1)
  })

  it('passes on a failure and carries on with the next', async () => {
    const serial = createSerial()
    let calls = 0
    const whisper = onGpu(
      {
        async transcribe() {
          if (++calls === 1) throw new Error('bad')
          return []
        },
        close() {},
      },
      serial,
    )
    await expect(whisper.transcribe('tiny', 'a.wav')).rejects.toThrow('bad')
    expect(await whisper.transcribe('tiny', 'b.wav')).toEqual([])
  })
})

describe('createGpuWorkers', () => {
  it('closes every registered worker when the GPU is freed, and only then', async () => {
    const log: string[] = []
    const workers = createGpuWorkers()
    workers.add(() => void log.push('music'))
    workers.add(() => void log.push('whisper'))
    expect(log).toEqual([])
    await workers.free()
    expect(log).toEqual(['music', 'whisper'])
  })

  it('waits for workers that close late', async () => {
    const log: string[] = []
    const workers = createGpuWorkers()
    workers.add(async () => {
      await wait(20)
      log.push('late')
    })
    workers.add(() => void log.push('now'))
    await await workers.free()
    expect(log).toEqual(['now', 'late'])
  })

  it('frees with nothing registered, and registers a worker once', async () => {
    const log: string[] = []
    const workers = createGpuWorkers()
    await workers.free()
    const close = () => void log.push('x')
    workers.add(close)
    workers.add(close)
    await workers.free()
    expect(log).toEqual(['x'])
  })
})
