import { describe, expect, it } from 'bun:test'
import type { EffectTakeView } from '../core/effectTakes'
import { compareClips, takePlayId, takeUrl } from './effectsPlay'

const take = (n: number, loops: boolean): EffectTakeView => ({
  n,
  file: `0123456789abcdef.${n}.wav`,
  seconds: 10,
  peaks: [],
  chosen: false,
  model: 'm',
  loops,
  quietAt: null,
})

describe('compareClips', () => {
  it('plays the chosen loop round twice, a second of quiet, then the take round twice', () => {
    expect(compareClips('rain', take(2, true), take(3, true), true)).toEqual([
      {
        id: takePlayId('rain', 2),
        url: takeUrl('rain', take(2, true).file),
        loop: true,
        rounds: 2,
        after: 1,
      },
      {
        id: takePlayId('rain', 3),
        url: takeUrl('rain', take(3, true).file),
        loop: true,
        rounds: 2,
      },
    ])
  })

  it('plays a take made to play once once through, within the comparison', () => {
    const [chosen, other] = compareClips('rain', take(2, true), take(3, false), true)
    expect(chosen).toMatchObject({ loop: true, rounds: 2 })
    expect(other).toEqual({ id: takePlayId('rain', 3), url: takeUrl('rain', take(3, false).file) })
    const once = compareClips('rain', take(2, false), take(3, true), true)
    expect(once[0]).toEqual({
      id: takePlayId('rain', 2),
      url: takeUrl('rain', take(2, false).file),
      after: 1,
    })
  })

  it('plays each take of a one-shot effect with its own saved fades', () => {
    const a = { ...take(2, false), fades: { in: 0.01, out: 0.4, shape: 'smooth' as const } }
    const b = { ...take(3, false), fades: { in: 0, out: 0.25, shape: 'straight' as const } }
    const [chosen, other] = compareClips('door', a, b, false)
    expect(chosen!.url).toBe(`${takeUrl('door', a.file)}?fadeIn=0.01&fadeOut=0.4&shape=smooth`)
    expect(other!.url).toBe(`${takeUrl('door', b.file)}?fadeIn=0&fadeOut=0.25&shape=straight`)
  })

  it('plays a take as made while its effect loops, whatever fades it still holds', () => {
    const a = { ...take(2, false), fades: { in: 0.01, out: 0.4, shape: 'smooth' as const } }
    expect(compareClips('door', a, take(3, false), true)[0]!.url).toBe(takeUrl('door', a.file))
  })
})
