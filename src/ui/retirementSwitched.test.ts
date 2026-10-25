import { beforeEach, describe, expect, it } from 'bun:test'
import { clearSwitched, markSwitched, switchedTakes } from './retirementSwitched'

describe('retirementSwitched', () => {
  beforeEach(() => clearSwitched())

  it('remembers each take switched from the Models panel, draft first, once', () => {
    expect(switchedTakes()).toEqual([])
    markSwitched('final')
    markSwitched('draft')
    markSwitched('final')
    expect(switchedTakes()).toEqual(['draft', 'final'])
  })

  it('forgets them when the confirmation is dismissed', () => {
    markSwitched('draft')
    clearSwitched()
    expect(switchedTakes()).toEqual([])
  })
})
