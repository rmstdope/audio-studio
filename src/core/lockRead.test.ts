import { expect, test } from 'bun:test'
import { LOCK_UNREAD, lockEntry, type LockRead } from './lockRead'

const read: LockRead<number> = { read: true, entries: { a: 1 } }

test('an unreadable lock says nothing is known, whatever the id', () => {
  expect(lockEntry(LOCK_UNREAD, 'a')).toEqual({ standing: 'unknown' })
})

test('a readable lock without the id says not chosen', () => {
  expect(lockEntry(read, 'b')).toEqual({ standing: 'not-chosen' })
})

test('a readable lock with the id says chosen, with its entry', () => {
  expect(lockEntry(read, 'a')).toEqual({ standing: 'chosen', entry: 1 })
})
