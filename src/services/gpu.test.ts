import { describe, expect, it } from 'bun:test'
import { createSerial } from './serial'
import { GPU, onGpu } from './gpu'
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
