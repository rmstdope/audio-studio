import { describe, expect, it } from 'bun:test'
import { cloneState, formatLength, MAX_FILES } from './cloneVoice'

const rec = (name: string, seconds: number | null) => ({ name, seconds })

describe('formatLength', () => {
  it('reads seconds under a minute and minutes with seconds above', () => {
    expect(formatLength(45)).toBe('45 s')
    expect(formatLength(85)).toBe('1 min 25 s')
    expect(formatLength(120)).toBe('2 min')
    expect(formatLength(9.6)).toBe('10 s')
  })
})

describe('cloneState', () => {
  const ready = { name: 'Elior', permitted: true }

  it('sends recordings of 10 seconds or more and leaves out short and non-audio ones', () => {
    const state = cloneState({
      ...ready,
      files: [rec('a.wav', 50), rec('b.wav', 9.9), rec('c.txt', null), rec('d.wav', 35)],
    })
    expect(state.marks).toEqual(['sent', 'short', 'not-audio', 'sent'])
    expect(state.sendable).toEqual([0, 3])
    expect(state.total).toBe('2 recordings will be sent · 1 min 25 s in all.')
    expect(state.canClone).toBe(true)
    expect(state.note).toBeNull()
  })

  it('says "1 recording" in the singular', () => {
    expect(cloneState({ ...ready, files: [rec('a.wav', 10)] }).total).toBe(
      '1 recording will be sent · 10 s in all.',
    )
  })

  it('blocks when no recording is long enough', () => {
    const state = cloneState({ ...ready, files: [rec('a.wav', 3)] })
    expect(state.canClone).toBe(false)
    expect(state.total).toBeNull()
    expect(state.note).toBe(
      'No recording is long enough. Each needs at least 10 seconds of speech.',
    )
  })

  it('blocks more than 20 files and says how many to remove', () => {
    const files = Array.from({ length: MAX_FILES + 3 }, (_, i) => rec(`${i}.wav`, 20))
    const state = cloneState({ ...ready, files })
    expect(state.canClone).toBe(false)
    expect(state.note).toBe('23 recordings chosen; Fish takes up to 20. Remove 3 to clone.')
  })

  it('needs a name and the permission tick, and says nothing more about them', () => {
    const files = [rec('a.wav', 20)]
    expect(cloneState({ name: '  ', permitted: true, files }).canClone).toBe(false)
    expect(cloneState({ name: 'Elior', permitted: false, files }).canClone).toBe(false)
    expect(cloneState({ name: 'Elior', permitted: false, files }).note).toBeNull()
  })

  it('has nothing to say before anything is chosen', () => {
    const state = cloneState({ ...ready, files: [] })
    expect(state.canClone).toBe(false)
    expect(state.note).toBeNull()
    expect(state.total).toBeNull()
  })
})
