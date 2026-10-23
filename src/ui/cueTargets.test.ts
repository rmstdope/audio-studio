import { describe, expect, it } from 'bun:test'
import type { LineState } from '../core/planner'
import { cueTargets } from './cueTargets'

function line(key: string, overrides: Partial<LineState> = {}): LineState {
  return {
    key,
    speaker: 'mira',
    text: 'Hello.',
    cue: '',
    ownCue: false,
    status: 'missing',
    reasons: [],
    heard: null,
    duration: null,
    file: null,
    ...overrides,
  }
}

describe('cueTargets', () => {
  it('offers lines without their own cue, those without a clip first, numbered as in the dialog', () => {
    const targets = cueTargets([
      line('a', { file: 'a.mp3', status: 'ok' }),
      line('b', { ownCue: true }),
      line('c'),
      line('d', { text: 'x'.repeat(100) }),
    ])
    expect(targets.fresh.map((t) => [t.key, t.label])).toEqual([
      ['c', '3. Mira: Hello.'],
      ['d', `4. Mira: ${'x'.repeat(70)}…`],
    ])
    expect(targets.recorded.map((t) => [t.key, t.label])).toEqual([['a', '1. Mira: Hello.']])
  })

  it('suggests the one line without a clip, when there is just one', () => {
    expect(cueTargets([line('a', { file: 'a.mp3' }), line('c')]).suggested).toBe('c')
    expect(cueTargets([line('c'), line('d')]).suggested).toBeNull()
  })
})
