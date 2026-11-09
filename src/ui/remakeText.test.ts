import { describe, expect, it } from 'bun:test'
import { remakeProgress } from './remakeText'

describe('the remake press progress line', () => {
  it('rounds the time left up in steps of seconds, then whole minutes', () => {
    expect(remakeProgress(2, 1, 700, 'qwen-edit')).toBe(
      'Making 2 takes for 1 patch with Qwen Image Edit · about 12 min left',
    )
    expect(remakeProgress(1, 1, 11, 'klein')).toBe(
      'Making 1 take for 1 patch with FLUX.2 klein · about 15 s left',
    )
  })
})
