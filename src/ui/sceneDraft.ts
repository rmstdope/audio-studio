import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { draftOf, redRows, sameDraft, toMix, type SceneDraft } from '../core/sceneEdit'
import type { SceneMix, SceneRow } from '../core/scenes'
import { useSaveScene } from './api'
import { holdRoute } from './route'

/** Where a scene's saving stands. */
export type SceneStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'failed'; message: string }
  /** Saved somewhere else since the page read it; `current` is what is saved now. */
  | { kind: 'conflict'; current: SceneMix | null }

/** The open scene as the page edits it. */
export interface SceneEditor {
  /** What the page shows: the unsaved draft, else the saved scene. */
  draft: SceneDraft
  /** The draft differs from the saved scene. */
  dirty: boolean
  /** How many effect rows have a red box. */
  reds: number
  status: SceneStatus
  change: (next: SceneDraft) => void
  discard: () => void
  /** Saves the draft; true when it was written. */
  save: () => Promise<boolean>
  /** After a conflict: writes the draft over what is saved. */
  keepMine: () => Promise<boolean>
  /** After a conflict: loses the draft for what is saved. */
  loadSaved: () => Promise<void>
}

/** What the editor holds for one scene: the unsaved draft, if any, and where saving stands. */
interface Held {
  sceneId: string
  draft: SceneDraft | null
  /** The entry the draft began from: what Save compares with the file, however the project is read again. */
  was: SceneMix | null
  status: SceneStatus
}

/**
 * The unsaved draft of the open scene (one at a time: it is dropped when another scene opens, which
 * the page asks about first), the rules for saving it and what saving answered.
 */
export function useSceneEditor(partId: string, scene: SceneRow | undefined): SceneEditor {
  const client = useQueryClient()
  const saving = useSaveScene(partId)
  const [held, setHeld] = useState<Held | null>(null)
  const sceneId = scene?.id ?? ''
  const mine: Held =
    held?.sceneId === sceneId
      ? held
      : { sceneId, draft: null, was: scene?.entry ?? null, status: { kind: 'idle' } }
  const base = scene ? draftOf(scene) : { music: { track: null, level: 1 }, effects: [] }
  const draft = mine.draft ?? base
  const dirty = !sameDraft(draft, base)
  const reds = redRows(draft)
  // The latest, for the saves that finish later.
  const latest = useRef({ draft, dirty, reds, sceneId, was: mine.was })
  latest.current = { draft, dirty, reds, sceneId, was: mine.was }
  // A scene saved earlier does not say Saved when it is opened again.
  useEffect(() => setHeld((h) => (h && h.sceneId !== sceneId && !h.draft ? null : h)), [sceneId])

  const send = useCallback(
    async (was: SceneMix | null): Promise<boolean> => {
      const { draft, sceneId } = latest.current
      const set = (status: SceneStatus, kept: SceneDraft | null = draft) =>
        setHeld({ sceneId, draft: kept, was: latest.current.was, status })
      set({ kind: 'saving' })
      try {
        const answer = await saving.mutateAsync({ sceneId, scene: toMix(draft), was })
        if (answer.ok) {
          set({ kind: 'saved' }, null)
          return true
        }
        if (answer.kind === 'stale') set({ kind: 'conflict', current: answer.current })
        else set({ kind: 'failed', message: answer.message })
      } catch (error) {
        set({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
      }
      return false
    },
    [saving],
  )

  return {
    draft,
    dirty,
    reds,
    status: mine.status,
    change: (next) => setHeld({ sceneId, draft: next, was: mine.was, status: { kind: 'idle' } }),
    discard: () =>
      setHeld({ sceneId, draft: null, was: scene?.entry ?? null, status: { kind: 'idle' } }),
    save: async () => {
      const { dirty, reds, was } = latest.current
      if (!dirty || reds > 0 || mine.status.kind === 'saving') return false
      return send(was)
    },
    keepMine: async () => (mine.status.kind === 'conflict' ? send(mine.status.current) : false),
    loadSaved: async () => {
      await client.invalidateQueries({ queryKey: ['project'] })
      setHeld({ sceneId, draft: null, was: null, status: { kind: 'idle' } })
    },
  }
}

/** What the page is asked to do once the user has said what happens to the unsaved changes. */
export interface Leaving {
  /** Goes on to where the user was headed. */
  proceed: () => void
}

/**
 * Guards the page's unsaved changes. The browser's own prompt is asked when the tab is closed or
 * reloaded. A move to another address (another scene, another page, Back) is undone before the
 * router follows it and handed to `ask`, which puts the question to the user and calls `proceed`
 * to go on. Refresh from the game asks the same way through `ask`, from the page.
 */
export function useLeaveGuard(dirty: boolean, ask: (leaving: Leaving) => void) {
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const askRef = useRef(ask)
  askRef.current = ask
  // The address the user is allowed to be at.
  const accepted = useRef(window.location.hash)
  const allow = useRef(false)

  useEffect(() => {
    const moved = (): boolean => {
      const to = window.location.hash
      if (allow.current || !dirtyRef.current) {
        accepted.current = to
        allow.current = false
        return false
      }
      if (to === accepted.current) return false
      // Back to where the user was, then ask.
      window.history.replaceState(null, '', accepted.current || '#')
      askRef.current({
        proceed: () => {
          allow.current = true
          window.location.hash = to
        },
      })
      return true
    }
    // The router asks before it follows a move, so nothing of the other page is ever shown (a
    // listener of its own could run after the router had already left this page).
    return holdRoute(moved)
  }, [])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
}
