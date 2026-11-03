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
    expect(compareClips('rain', take(2, true), take(3, true))).toEqual([
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
    const [chosen, other] = compareClips('rain', take(2, true), take(3, false))
    expect(chosen).toMatchObject({ loop: true, rounds: 2 })
    expect(other).toEqual({ id: takePlayId('rain', 3), url: takeUrl('rain', take(3, false).file) })
    const once = compareClips('rain', take(2, false), take(3, true))
    expect(once[0]).toEqual({
      id: takePlayId('rain', 2),
      url: takeUrl('rain', take(2, false).file),
      after: 1,
    })
  })
})
