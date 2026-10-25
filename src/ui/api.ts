import {
  keepPreviousData,
  useIsMutating,
  useMutation,
  useMutationState,
  useQueries,
  useQuery,
  useQueryClient,
  type MutationState,
  type QueryClient,
} from '@tanstack/react-query'
import type { Pronunciation } from '../core/pronounce'
import type { CueChange } from '../services/cues'
import type { ChangesResult } from '../services/git'
import type { CreditResult } from '../services/fish'
import type { RefreshResult } from '../services/refresh'
import { useCallback, useState } from 'react'
import type { CharacterChange, CharacterVoiceResult } from '../services/auditions'
import type { GenerationPlan } from '../core/generation'
import type { Problem } from '../core/project'
import type { JobState } from '../services/jobs'
import type { HeardResult } from '../services/heard'
import type { AcceptResult, MeasureResult, RecordResult } from '../services/narration'
import type { RuledOutResult } from '../services/ruledOut'
import type { SoundAlikeChange } from '../services/soundAlike'
import type { SetupResult } from '../services/setup'
import type { NoteChange } from '../services/notes'
import type { LineTakesResult, TakeLineResult, UseTakeResult } from '../services/lineTakes'
import type { CastResult, SessionView } from '../services/sessions'
import type { TakeResult, TryResult } from '../services/takes'
import type { AuditionText } from '../core/takes'
import type { SittingView } from '../core/sitting'
import { takeCaches, waitingAfter } from './sitting'
import { centsUp } from './format'
import { isAbout, withAuditionTakes, withTake, withVoiceTake } from './takes'
import type { AdoptResult, LoadResult, PartResult, ProjectFailure } from '../services/workspace'

/** A successful answer about a character's cast voice. */
export type Voiced = Extract<NonNullable<CharacterVoiceResult>, { ok: true }>

/** A session view with a phrase to record takes of. */
type Viewed = Extract<SessionView, { ok: true }> & { audition: AuditionText }

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return (await response.json()) as T
}

/** POSTs to `path`. A 409 is an answer (the request was refused for a reason given in the body). */
async function postJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: 'POST' })
  if (!response.ok && response.status !== 409)
    throw new Error(`${path} answered ${response.status}`)
  return (await response.json()) as T
}

/** The project summary, or the problems with the project file. Refetched when the window regains focus. */
export function useProject() {
  return useQuery({ queryKey: ['project'], queryFn: () => getJson<LoadResult>('/api/project') })
}

/**
 * What git sees of the project's files, for the Changes page and its count in the sidebar: read
 * again every few seconds, since recording, editing or a commit outside the studio changes it.
 */
export function useChanges() {
  return useQuery({
    queryKey: ['changes'],
    queryFn: () => getJson<ChangesResult>('/api/changes'),
    refetchInterval: 5000,
  })
}

/**
 * The Fish account's remaining credit. It changes only when money is spent or added, so it is read
 * again after recording and every five minutes, not on every return to the window.
 */
export function useCredit() {
  return useQuery({
    queryKey: ['credit'],
    queryFn: () => getJson<CreditResult>('/api/credit'),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
}

/** A part with the state of every line's clip. */
export function usePart(partId: string, enabled = true) {
  return useQuery({ ...partQuery(partId), enabled })
}

/**
 * What Whisper heard of a line's kept take, for comparing with its text. Asked again whenever it is
 * shown, and after the part's lines are recorded, since a retake replaces it.
 */
export function useHeard(partId: string, key: string) {
  return useQuery({
    queryKey: ['heard', partId, key],
    queryFn: () =>
      getJson<NonNullable<HeardResult>>(
        `/api/parts/${encodeURIComponent(partId)}/lines/${encodeURIComponent(key)}/heard`,
      ),
  })
}

/** How a part is asked for and cached, the same for one part as for several. */
function partQuery(partId: string) {
  return {
    queryKey: ['part', partId],
    queryFn: () => getJson<NonNullable<PartResult>>(`/api/parts/${encodeURIComponent(partId)}`),
  }
}

/** Several parts, as `usePart` loads each (sharing its cache), in the order given. */
export function useParts(partIds: string[]) {
  return useQueries({
    queries: partIds.map(partQuery),
  })
}

/** Saves the project's own words that sound the same, then reloads the project. */
export function useSetSoundAlike() {
  const client = useQueryClient()
  return useMutation({
    scope: { id: 'sound-alike' },
    mutationFn: async (change: { groups: string[][]; was: string[][] }) => {
      const response = await fetch('/api/sound-alike', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(change),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the words that sound the same answered ${response.status}`)
      }
      return (await response.json()) as SoundAlikeChange
    },
    // Refused or not, the page shows the file's groups again: a refusal may mean they changed.
    onSuccess: () => client.invalidateQueries({ queryKey: ['project'] }),
  })
}

/**
 * Has Whisper check a line's clip again with today's rules (no new audio), then reloads the part,
 * its plan and what was heard.
 */
export function useCheckAgain(partId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (key: string) =>
      postJson<MeasureResult>(
        `/api/parts/${encodeURIComponent(partId)}/lines/${encodeURIComponent(key)}/check`,
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['plan', partId] })
      void client.invalidateQueries({ queryKey: ['heard', partId] })
      return client.invalidateQueries({ queryKey: ['part', partId] })
    },
  })
}

/** Accepts a weak line's clip as it is, then reloads the part (the line is no longer weak). */
export function useAccept(partId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (key: string) =>
      postJson<AcceptResult>(
        `/api/parts/${encodeURIComponent(partId)}/lines/${encodeURIComponent(key)}/accept`,
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['plan', partId] })
      return client.invalidateQueries({ queryKey: ['part', partId] })
    },
  })
}

/** Adopts a part's untracked clips, then reloads the part. */
export function useAdopt(partId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () =>
      postJson<NonNullable<AdoptResult>>(`/api/parts/${encodeURIComponent(partId)}/adopt`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['plan', partId] })
      return client.invalidateQueries({ queryKey: ['part', partId] })
    },
  })
}

/**
 * A character's cast voice as Fish knows it, its take and the audition phrase, for its page.
 * Cached for a while: it asks Fish each time.
 */
export function useCharacterVoice(characterId: string, voiceId: string | null, enabled = true) {
  return useQuery({
    enabled,
    // Keyed by the voice too: a voice cast since (in the file, or by an audition) is asked anew.
    queryKey: ['voice', characterId, voiceId],
    queryFn: () =>
      getJson<NonNullable<CharacterVoiceResult>>(
        `/api/characters/${encodeURIComponent(characterId)}/voice`,
      ),
    // An answer about another voice (the file changed between) is asked again at once.
    staleTime: (query) => {
      const data = query.state.data
      return data?.ok && !isAbout(data, voiceId) ? 0 : 10 * 60 * 1000
    },
    refetchOnWindowFocus: false,
  })
}

/**
 * Saves a character's audition keywords (the next audition searches with them). Saves for one
 * character run one after another, so a quick second edit is never overtaken by the first.
 */
export function useSetKeywords(characterId: string) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: `keywords-${characterId}` },
    mutationFn: async (keywords: string[]) => {
      const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keywords }),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the keywords answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<CharacterChange>
    },
    // Stay pending until the project (which holds the saved keywords) is reloaded, so the chips
    // never fall back to the old list.
    onSuccess: () => client.invalidateQueries({ queryKey: ['project'] }),
  })
}

/** Saves a character's own audition phrase (null for the standard one), then reloads its takes. */
export function useSetPhrase(characterId: string) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: `phrase-${characterId}` },
    mutationFn: async (phrase: string | null) => {
      const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phrase }),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the phrase answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<CharacterChange>
    },
    // Refresh the phrase and takes shown, without searching Fish's library again.
    onSuccess: (saved) => (saved.ok ? refreshAudition(client, characterId) : undefined),
  })
}

/**
 * Reloads what shows a character's audition phrase after it or the style changed: the board and
 * the cast voice, with their takes. Neither searches Fish's library.
 */
async function refreshAudition(client: QueryClient, characterId: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['session', characterId] }),
    client.invalidateQueries({ queryKey: ['voice', characterId] }),
  ])
}

/** Saves a character's style cue (empty to remove it); its lines and audition takes follow it. */
export function useSetStyle(characterId: string) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: `style-${characterId}` },
    mutationFn: async (style: string) => {
      const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ style }),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the style answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<CharacterChange>
    },
    onSuccess: async (saved) => {
      if (!saved.ok) return
      // Lines without their own cue are said in the style: their statuses change everywhere. The
      // editor closes once the style shown is the new one.
      void client.invalidateQueries({ queryKey: ['part'] })
      void client.invalidateQueries({ queryKey: ['plan'] })
      await Promise.all([
        client.invalidateQueries({ queryKey: ['project'] }),
        refreshAudition(client, characterId),
      ])
    },
  })
}

/** Saves a character's own speed (null: the project's), then reloads what it changes. */
export function useSetSpeed(characterId: string) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: `speed-${characterId}` },
    mutationFn: async (speed: number | null) => {
      const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ speed }),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the speed answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<CharacterChange>
    },
    onSuccess: async (saved) => {
      if (!saved.ok) return
      // Every line of the character is spoken at the speed: statuses change everywhere, and the
      // audition takes are recorded anew.
      void client.invalidateQueries({ queryKey: ['part'] })
      void client.invalidateQueries({ queryKey: ['plan'] })
      await Promise.all([
        client.invalidateQueries({ queryKey: ['project'] }),
        refreshAudition(client, characterId),
      ])
    },
  })
}

/**
 * Saves the whole pronunciation table; `was` is the table shown, so a page that is out of date is
 * refused instead of overwriting someone's change. Every part's lines follow it.
 */
export function useSetPronunciations() {
  const client = useQueryClient()
  return useMutation({
    scope: { id: 'pronounce' },
    mutationFn: async (change: { table: Pronunciation[]; was: Pronunciation[] }) => {
      const response = await fetch('/api/pronounce', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(change),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the pronunciations answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<CharacterChange>
    },
    onSuccess: async (saved) => {
      // Refused or not, the page shows the file's table again: a refusal may mean it changed.
      if (saved.ok) {
        void client.invalidateQueries({ queryKey: ['part'] })
        void client.invalidateQueries({ queryKey: ['plan'] })
        // The phrase as said changes, and so do the takes of it.
        void client.invalidateQueries({ queryKey: ['session'] })
        void client.invalidateQueries({ queryKey: ['voice'] })
      }
      // The panel shows the saved table once the project has it.
      await client.invalidateQueries({ queryKey: ['project'] })
    },
  })
}

/**
 * Refreshing a part's dialog: `start` runs the project's refreshDialog command, `pending` says
 * whether it runs, `outcome` is the last one's result until dismissed. The state lives in the
 * mutation cache under the part's key, so leaving the page and coming back during a refresh still
 * shows it running. Afterwards everything read from the dialog is loaded again.
 */
export function useRefreshDialog(partId: string) {
  const client = useQueryClient()
  const mutationKey = ['refresh', partId]
  const mutation = useMutation({
    mutationKey,
    scope: { id: `refresh-${partId}` },
    mutationFn: async () => {
      const response = await fetch(`/api/parts/${encodeURIComponent(partId)}/refresh`, {
        method: 'POST',
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`refreshing answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<RefreshResult>
    },
    onSettled: async () => {
      void client.invalidateQueries({ queryKey: ['plan', partId] })
      void client.invalidateQueries({ queryKey: ['changes'] })
      await Promise.all([
        client.invalidateQueries({ queryKey: ['project'] }),
        client.invalidateQueries({ queryKey: ['part', partId] }),
      ])
    },
  })
  const pending = useIsMutating({ mutationKey }) > 0
  const last = useMutationState({
    filters: { mutationKey },
    select: (m) => m.state as MutationState<NonNullable<RefreshResult>, Error>,
  }).at(-1)
  const settled = last && last.status !== 'pending' && last.status !== 'idle'
  return {
    start: () => mutation.mutate(),
    pending,
    outcome: settled ? { result: last.data ?? null, error: last.error?.message ?? null } : null,
    // Closing forgets the finished refreshes, so the outcome does not come back on a later visit.
    dismiss: () => {
      const cache = client.getMutationCache()
      for (const done of cache.findAll({ mutationKey })) {
        if (done.state.status !== 'pending') cache.remove(done)
      }
    },
  }
}

/** Gives an orphaned cue to a line (`to`), or removes it (null), then reloads the part. */
export function useMoveCue(partId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ key, to }: { key: string; to: string | null }) => {
      const response = await fetch(
        `/api/parts/${encodeURIComponent(partId)}/cues/${encodeURIComponent(key)}/move`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ to }),
        },
      )
      if (response.status === 404) {
        throw new Error(
          'That cue or line is no longer in this part; the page shows it as it is now.',
        )
      }
      if (!response.ok && response.status !== 409) {
        throw new Error(`moving the cue answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<CueChange>
    },
    // Moved or not (a 404 means the part changed), the page shows the part as it is now.
    onSettled: async () => {
      void client.invalidateQueries({ queryKey: ['plan', partId] })
      void client.invalidateQueries({ queryKey: ['changes'] })
      await client.invalidateQueries({ queryKey: ['part', partId] })
    },
  })
}

/** Saves the user's note on a line (empty to remove it), then reloads the part. */
export function useSetNote(partId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ key, note }: { key: string; note: string }) => {
      const response = await fetch(
        `/api/parts/${encodeURIComponent(partId)}/lines/${encodeURIComponent(key)}/note`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note }),
        },
      )
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the note answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<NoteChange>
    },
    onSuccess: async (saved) => {
      if (saved.ok) await client.invalidateQueries({ queryKey: ['part', partId] })
    },
  })
}

/** Saves a line's own cue (empty to go back to the character's style), then reloads the part. */
export function useSetCue(partId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ key, cue }: { key: string; cue: string }) => {
      const response = await fetch(
        `/api/parts/${encodeURIComponent(partId)}/cues/${encodeURIComponent(key)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cue }),
        },
      )
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the cue answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<CueChange>
    },
    onSuccess: async (saved) => {
      if (!saved.ok) return
      void client.invalidateQueries({ queryKey: ['plan', partId] })
      void client.invalidateQueries({ queryKey: ['project'] })
      // The cell closes once the cue shown is the new one.
      await client.invalidateQueries({ queryKey: ['part', partId] })
    },
  })
}

/**
 * Records audition takes: `record(voice)` asks the server for the take and adds it to the board
 * and the cast voice in the cache, without asking Fish for anything else. `board` says the takes
 * are the audition board's (on the audition model, paid from the sitting); the cast voice's on
 * its page are on the free model; with a `paid` audition model the two are different takes and
 * each goes only to its own cached answer (`takeCaches`). `recording` holds the voices in progress, `errors` what went
 * wrong per voice, `waiting` the voices whose take waits for more money (`retryWaiting` asks for
 * them again).
 */
export function useTakes(characterId: string, board = false, paid = false) {
  const client = useQueryClient()
  const [recording, setRecording] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [waiting, setWaiting] = useState<Set<string>>(new Set())

  const record = useCallback(
    async (voice: string) => {
      setRecording((now) => new Set(now).add(voice))
      setErrors(({ [voice]: _gone, ...rest }) => rest)
      try {
        const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}/takes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ voice, board }),
        })
        if (!response.ok && response.status !== 409) {
          throw new Error(`recording answered ${response.status}`)
        }
        const result = (await response.json()) as NonNullable<TakeResult>
        if (result.ok) {
          setWaiting((now) => waitingAfter(now, voice, 'recorded'))
          const caches = takeCaches(board, paid)
          if (caches.voice) {
            client.setQueriesData<NonNullable<CharacterVoiceResult>>(
              { queryKey: ['voice', characterId] },
              (old) => (old?.ok ? withVoiceTake<Voiced>(old, voice, result) : old),
            )
          }
          if (caches.session) {
            client.setQueryData<SessionView>(['session', characterId], (old) =>
              old?.ok && old.audition ? withTake<Viewed>(old as Viewed, voice, result) : old,
            )
          }
        } else if ('reason' in result && result.reason === 'waits') {
          setWaiting((now) => waitingAfter(now, voice, 'waits'))
        } else {
          setWaiting((now) => waitingAfter(now, voice, 'failed'))
          const message = 'message' in result ? result.message : 'the project’s files need fixing'
          setErrors((now) => ({ ...now, [voice]: message }))
        }
        // A paid take spent money: the meter reads it again.
        if (board) void client.invalidateQueries({ queryKey: ['sitting', characterId] })
      } catch (error) {
        setErrors((now) => ({
          ...now,
          [voice]: error instanceof Error ? error.message : String(error),
        }))
      } finally {
        setRecording((now) => {
          const next = new Set(now)
          next.delete(voice)
          return next
        })
      }
    },
    [board, characterId, client, paid],
  )

  const retryWaiting = useCallback(() => {
    for (const voice of waiting) void record(voice)
  }, [record, waiting])

  return { record, recording, errors, waiting, retryWaiting }
}

/** A character's audition in progress, with the phrase and the takes of the voices in it. */
export function useSession(characterId: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['session', characterId],
    queryFn: () => getJson<SessionView>(`/api/auditions/${encodeURIComponent(characterId)}`),
  })
}

/** What a session action sends: the path after the session's (`start`, `move`, …), and a body. */
export interface SessionAction {
  action: 'start' | 'move' | 'undo' | 'more' | 'add' | 'discard'
  body?: unknown
}

/**
 * Changes a character's audition (start, shortlist, unlist or drop a voice, undo the last drop,
 * more voices, add by id, stop) and shows the answer. Actions run one after another, in the order
 * asked.
 */
export function useSessionAction(characterId: string) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: `session-${characterId}` },
    mutationFn: async ({ action, body }: SessionAction) => {
      const base = `/api/auditions/${encodeURIComponent(characterId)}`
      const response = await fetch(action === 'discard' ? base : `${base}/${action}`, {
        method: action === 'discard' ? 'DELETE' : 'POST',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`the audition answered ${response.status}`)
      }
      return (await response.json()) as SessionView
    },
    onSuccess: (view, { action, body }) => {
      if (!view.ok) return
      // A drop rules a voice out, undoing it or adding a voice by id allows it again. A drop
      // shows at once, before the list is read again.
      const dropped = action === 'move' ? droppedBy(body) : null
      if (dropped && view.session && dropped !== view.session.current) {
        const title = view.session.voices[dropped]?.title ?? dropped
        client.setQueryData<NonNullable<RuledOutResult>>(['ruled-out', characterId], (old) =>
          old?.ok && !old.voices.some((v) => v.id === dropped)
            ? {
                ...old,
                voices: [{ id: dropped, title, at: new Date().toISOString() }, ...old.voices],
              }
            : old,
        )
      }
      void client.invalidateQueries({ queryKey: ['ruled-out', characterId] })
      // Starting opens a sitting, stopping ends it.
      if (action === 'start' || action === 'discard') {
        void client.invalidateQueries({ queryKey: ['sitting', characterId] })
      }
      // An answer without the recorded lines (after a move on the board) keeps the ones shown;
      // takes recorded while the answer was on its way are kept too.
      client.setQueryData<SessionView>(['session', characterId], (old) => {
        if (!old?.ok) return view
        const recorded = view.recorded ?? old.recorded
        if (!view.audition || !old.audition) return { ...view, recorded }
        const { takes } = withAuditionTakes<Viewed>(old as Viewed, view.audition, view.takes)
        return { ...view, takes, recorded }
      })
    },
  })
}

/** The voice a move drops, if it is a drop. */
function droppedBy(body: unknown): string | null {
  const move = body as { voice?: unknown; move?: unknown } | undefined
  return move?.move === 'drop' && typeof move.voice === 'string' ? move.voice : null
}

/**
 * Casts a shortlisted voice, ending the audition. Afterwards the project, its parts (whose lines
 * are now stale) and the character's cast voice are loaded again.
 */
export function useCast(characterId: string) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: `session-${characterId}` },
    mutationFn: async (voice: string) => {
      const response = await fetch(`/api/auditions/${encodeURIComponent(characterId)}/cast`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voice }),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`casting answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<CastResult>
    },
    onSuccess: (result) => {
      if (!result.ok) return
      const ended: SessionView = {
        ok: true,
        session: null,
        audition: null,
        takes: {},
        recorded: [],
      }
      client.setQueryData<SessionView>(['session', characterId], () => ended)
      void client.invalidateQueries({ queryKey: ['project'] })
      void client.invalidateQueries({ queryKey: ['part'] })
      void client.invalidateQueries({ queryKey: ['voice', characterId] })
      void client.invalidateQueries({ queryKey: ['sitting', characterId] })
    },
  })
}

/** The voices ruled out for a character (dropped in auditions), the latest first. */
export function useRuledOut(characterId: string) {
  return useQuery({
    queryKey: ['ruled-out', characterId],
    queryFn: async () => {
      const path = `/api/characters/${encodeURIComponent(characterId)}/ruled-out`
      const response = await fetch(path)
      if (!response.ok && response.status !== 409)
        throw new Error(`${path} answered ${response.status}`)
      return okRuledOut((await response.json()) as NonNullable<RuledOutResult>)
    },
  })
}

/** Ruled-out voices, or an error naming what is wrong with the project. */
function okRuledOut(result: NonNullable<RuledOutResult>) {
  if (!result.ok) throw new Error(result.problems.map((p) => `${p.file}: ${p.message}`).join('; '))
  return result
}

/**
 * Allows ruled-out voices again: one by its id, or every one (null), forgetting them all. Later
 * searches for the character may show them again.
 */
export function useAllowVoices(characterId: string) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: `ruled-out-${characterId}` },
    mutationFn: async (voice: string | null) => {
      const base = `/api/characters/${encodeURIComponent(characterId)}/ruled-out`
      const path = voice === null ? base : `${base}/${encodeURIComponent(voice)}`
      const response = await fetch(path, { method: 'DELETE' })
      if (!response.ok && response.status !== 409) {
        throw new Error(`allowing voices again answered ${response.status}`)
      }
      return okRuledOut((await response.json()) as NonNullable<RuledOutResult>)
    },
    onSuccess: (result) => {
      client.setQueryData(['ruled-out', characterId], result)
    },
  })
}

/**
 * Hears a line with a cue before saving it: the server records the line as a take with the cue
 * (empty: the character's style) and answers with the take to play, or why there is none.
 */
export function useTryCue(partId: string) {
  return useMutation({
    mutationFn: async ({ key, cue }: { key: string; cue: string }) => {
      const response = await fetch(
        `/api/parts/${encodeURIComponent(partId)}/lines/${encodeURIComponent(key)}/try`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cue }),
        },
      )
      if (!response.ok && response.status !== 409) {
        throw new Error(`trying the cue answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<TryResult>
    },
  })
}

/**
 * The setup checks: what the studio needs on this machine and in the project, each with a fix.
 * Asked for once in a while (the sidebar shows the count on every page, and the check asks Fish),
 * or afresh each time the Setup page opens (`fresh`): the user installs things meanwhile.
 */
export function useSetup(fresh = false) {
  return useQuery({
    queryKey: ['setup'],
    queryFn: () => getJson<SetupResult>('/api/setup'),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: fresh ? 'always' : true,
  })
}

/** A line's extra takes, newest first, each marked current or stale. */
export function useLineTakes(partId: string, key: string) {
  return useQuery({
    queryKey: ['line-takes', partId, key],
    queryFn: () =>
      getJson<NonNullable<LineTakesResult>>(
        `/api/parts/${encodeURIComponent(partId)}/lines/${encodeURIComponent(key)}/takes`,
      ),
  })
}

/** The URL of one of a line's extra takes (a WAV). */
export function lineTakeUrl(partId: string, key: string, id: string): string {
  return `/api/parts/${encodeURIComponent(partId)}/lines/${encodeURIComponent(key)}/takes/${id}.wav`
}

/**
 * A line's extra takes: `take` records one more (free), `use` makes one the line's clip, `drop`
 * removes one from the cache. Each reloads the list; using one reloads the part too.
 */
export function useLineTakeActions(partId: string, key: string) {
  const client = useQueryClient()
  const base = `/api/parts/${encodeURIComponent(partId)}/lines/${encodeURIComponent(key)}/takes`
  const reloadTakes = () => client.invalidateQueries({ queryKey: ['line-takes', partId, key] })
  // The last refusal, of either action, shown until the next action.
  const [refused, setRefused] = useState<{
    what: string
    answer: NonNullable<TakeLineResult> | NonNullable<UseTakeResult>
  } | null>(null)
  const take = useMutation({
    mutationFn: () => postJson<NonNullable<TakeLineResult>>(base),
    onMutate: () => setRefused(null),
    onSuccess: (result) => {
      if (!result.ok) setRefused({ what: 'The take could not be made', answer: result })
      return reloadTakes()
    },
  })
  const use = useMutation({
    mutationFn: (id: string) => postJson<NonNullable<UseTakeResult>>(`${base}/${id}/use`),
    onMutate: () => setRefused(null),
    onSuccess: async (result) => {
      if (!result.ok) setRefused({ what: 'The take could not be used', answer: result })
      await reloadTakes()
      if (result.ok) {
        void client.invalidateQueries({ queryKey: ['plan', partId] })
        void client.invalidateQueries({ queryKey: ['changes'] })
        await client.invalidateQueries({ queryKey: ['part', partId] })
      }
    },
  })
  const drop = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`${base}/${id}`, { method: 'DELETE' })
      if (!response.ok && response.status !== 409) {
        throw new Error(`dropping the take answered ${response.status}`)
      }
      return (await response.json()) as { ok: boolean }
    },
    onSuccess: reloadTakes,
  })
  return { take, use, drop, refused }
}

/** The money of a character's audition, or why it cannot be shown. */
export type SittingAnswer =
  ({ ok: true } & SittingView) | { ok: false; message?: string; problems?: Problem[] }

/**
 * The audition model, what a take costs and the sitting's money for a character. Read from the
 * server alone (no Fish call), and again after every paid take and every change to the sitting.
 */
export function useSitting(characterId: string, enabled = true) {
  return useQuery({
    queryKey: ['sitting', characterId],
    queryFn: () =>
      getJson<SittingAnswer>(`/api/auditions/${encodeURIComponent(characterId)}/sitting`),
    enabled,
  })
}

/**
 * Changes a character's sitting: `resume` opens a fresh one with an amount, `add` tops the one
 * going on up, `end` ends it (Pause). Each answers with the sitting's money, or why it was refused.
 */
export function useSittingActions(characterId: string) {
  const client = useQueryClient()
  const base = `/api/auditions/${encodeURIComponent(characterId)}/sitting`
  const send = async (method: string, path: string, amount?: number) => {
    const response = await fetch(path, {
      method,
      headers: amount === undefined ? {} : { 'content-type': 'application/json' },
      body: amount === undefined ? undefined : JSON.stringify({ amount }),
    })
    if (!response.ok && response.status !== 409) {
      throw new Error(`the sitting answered ${response.status}`)
    }
    return (await response.json()) as SittingAnswer
  }
  const options = {
    scope: { id: `sitting-${characterId}` },
    onSuccess: (answer: SittingAnswer) => {
      if (answer.ok) client.setQueryData<SittingAnswer>(['sitting', characterId], answer)
    },
  }
  const resume = useMutation({
    ...options,
    mutationFn: (amount: number) => send('POST', base, amount),
  })
  const add = useMutation({
    ...options,
    mutationFn: (amount: number) => send('POST', `${base}/add`, amount),
  })
  const end = useMutation({ ...options, mutationFn: () => send('DELETE', base) })
  return { resume, add, end }
}

/** The URL of a recorded audition take. */
export function takeUrl(key: string): string {
  return `/api/takes/${key}.mp3`
}

/**
 * Records lines one by one from their rows. On a paid model the server first answers with the
 * most the line can cost: `toConfirm` holds it per line until the user confirms (`record` again
 * with that amount) or `cancel`s. `recording` holds the lines in progress, `errors` what went
 * wrong per line.
 */
export function useRecordLines(partId: string) {
  const client = useQueryClient()
  const [recording, setRecording] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [toConfirm, setToConfirm] = useState<Record<string, number>>({})
  const forget = (key: string) => setToConfirm(({ [key]: _gone, ...rest }) => rest)

  const record = useCallback(
    async (key: string, confirmedCost?: number, stage: 'draft' | 'final' = 'draft') => {
      setRecording((now) => new Set(now).add(key))
      setErrors(({ [key]: _gone, ...rest }) => rest)
      forget(key)
      try {
        const path = `/api/parts/${encodeURIComponent(partId)}/lines/${encodeURIComponent(key)}/record`
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            stage,
            ...(confirmedCost === undefined ? {} : { confirmedCost }),
          }),
        })
        if (!response.ok && response.status !== 409) {
          throw new Error(`recording answered ${response.status}`)
        }
        const result = (await response.json()) as NonNullable<RecordResult> | SpendAnswer
        if (!result.ok && 'ceiling' in result) {
          // Shown and sent rounded up to the cent, so the amount agreed covers the cost.
          setToConfirm((now) => ({ ...now, [key]: centsUp(result.ceiling) }))
        } else if (!result.ok) {
          const message = 'message' in result ? result.message : 'the part’s files need fixing'
          setErrors((now) => ({ ...now, [key]: message }))
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setErrors((now) => ({ ...now, [key]: message }))
      } finally {
        // The line stays "recording" until its new status is shown, so it is never offered twice.
        void client.invalidateQueries({ queryKey: ['plan', partId] })
        void client.invalidateQueries({ queryKey: ['credit'] })
        void client.invalidateQueries({ queryKey: ['heard', partId] })
        await client.invalidateQueries({ queryKey: ['part', partId] })
        setRecording((now) => {
          const next = new Set(now)
          next.delete(key)
          return next
        })
      }
    },
    [partId, client],
  )

  return { record, recording, errors, toConfirm, cancel: forget }
}

/** The server asking to confirm a paid recording: the most it can cost, in dollars. */
export interface SpendAnswer {
  ok: false
  reason: 'confirm'
  ceiling: number
  message: string
}

/** What generating a part (or one speaker in it) would do, or why it cannot be planned. */
export type PlanAnswer =
  | { ok: true; plan: GenerationPlan; parallel: number }
  | { ok: false; problems: Problem[] }
  | ProjectFailure

/** The generation plan for a part, or one speaker in it (null for all); weak lines retaken if asked. */
export function usePlan(
  partId: string,
  speaker: string | null,
  weak = false,
  stage: 'draft' | 'final' = 'draft',
) {
  return useQuery({
    queryKey: ['plan', partId, speaker, weak, stage],
    queryFn: () => {
      const params = new URLSearchParams()
      if (speaker) params.set('speaker', speaker)
      if (weak) params.set('weak', '1')
      if (stage === 'final') params.set('stage', 'final')
      const query = params.size ? `?${params}` : ''
      return getJson<PlanAnswer>(`/api/parts/${encodeURIComponent(partId)}/plan${query}`)
    },
    // Ticking the retake box asks for another plan: keep showing the last one for the same scope
    // meanwhile (its buttons wait), but never another speaker's or stage's.
    placeholderData: (previous, query) =>
      query?.queryKey[2] === speaker && query?.queryKey[4] === stage
        ? keepPreviousData(previous)
        : undefined,
  })
}

/**
 * The part's latest generation job, polled every second while it runs. When it finishes, the
 * part and its plans are loaded again.
 */
export function useJob(partId: string) {
  const client = useQueryClient()
  return useQuery({
    queryKey: ['job', partId],
    queryFn: async () => {
      const job = await getJson<JobState | null>(
        `/api/parts/${encodeURIComponent(partId)}/jobs/latest`,
      )
      const before = client.getQueryData<JobState | null>(['job', partId])
      // Keep the lines' statuses current while the job runs, and once more when it ends.
      const running = job && (job.status === 'running' || job.status === 'cancelling')
      if (job && (running || before?.status !== job.status)) {
        void client.invalidateQueries({ queryKey: ['part', partId] })
        void client.invalidateQueries({ queryKey: ['plan', partId] })
        void client.invalidateQueries({ queryKey: ['heard', partId] })
      }
      // A finished job may have spent credit.
      if (job && !running && before?.status !== job.status) {
        void client.invalidateQueries({ queryKey: ['credit'] })
      }
      return job
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'running' || status === 'cancelling' ? 1000 : false
    },
  })
}

/** Starts generating a part, or cancels the running job. */
export function useJobActions(partId: string) {
  const client = useQueryClient()
  const start = useMutation({
    mutationFn: async (options: {
      kind: JobState['kind']
      stage?: 'draft' | 'final'
      retakeWeak?: boolean
      /** The most the user agreed to spend, for a paid model. */
      confirmedCost?: number
      speaker: string | null
      keys: string[]
      orphans: string[]
    }) => {
      const response = await fetch(`/api/parts/${encodeURIComponent(partId)}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(options),
      })
      const body = (await response.json()) as JobState | { error: string }
      if ('error' in body) throw new Error(body.error)
      if (!response.ok) throw new Error(`generating answered ${response.status}`)
      return body
    },
    onSuccess: (job) => client.setQueryData(['job', partId], job),
    // Refused (the cost changed, a promotion ended): the plan shows what to confirm now.
    onError: () => client.invalidateQueries({ queryKey: ['plan', partId] }),
  })
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`cancelling answered ${response.status}`)
      return (await response.json()) as JobState
    },
    onSuccess: (job) => client.setQueryData(['job', partId], job),
  })
  return { start, cancel }
}

/** The URL of a clip in a part. */
export function clipUrl(partId: string, file: string): string {
  return `/api/parts/${encodeURIComponent(partId)}/clips/${encodeURIComponent(file)}`
}
