import {
  keepPreviousData,
  useIsMutating,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type MutationState,
  type QueryClient,
} from '@tanstack/react-query'
import type { Pronunciation } from '../core/pronounce'
import type { CueChange } from '../services/cues'
import type { ChangesResult } from '../services/git'
import type { RefreshResult } from '../services/refresh'
import { useCallback, useState } from 'react'
import type { CandidatesResult, CharacterChange } from '../services/auditions'
import type { GenerationPlan } from '../core/generation'
import type { Problem } from '../core/project'
import type { JobState } from '../services/jobs'
import type { RecordResult } from '../services/narration'
import type { CastResult, SessionView } from '../services/sessions'
import type { AuditionTakesResult, TakeResult } from '../services/takes'
import type { AuditionText } from '../core/takes'
import { withAuditionTakes, withTake } from './takes'
import type { AdoptResult, LoadResult, PartResult, ProjectFailure } from '../services/workspace'

/** A successful candidates answer. */
type Found = Extract<NonNullable<CandidatesResult>, { ok: true }>

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

/** A part with the state of every line's clip. */
export function usePart(partId: string, enabled = true) {
  return useQuery({
    queryKey: ['part', partId],
    queryFn: () => getJson<NonNullable<PartResult>>(`/api/parts/${encodeURIComponent(partId)}`),
    enabled,
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
 * Voices found for a character's audition. Cached for a while: each search asks Fish many times.
 * Off while an audition round is shown, which does not need it.
 */
export function useCandidates(characterId: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['candidates', characterId],
    queryFn: () =>
      getJson<NonNullable<CandidatesResult>>(
        `/api/characters/${encodeURIComponent(characterId)}/candidates`,
      ),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

/**
 * Saves a character's audition keywords, then searches again with them. Saves for one character
 * run one after another, so a quick second edit is never overtaken by the first.
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
    // never fall back to the old list; the search reruns on its own time.
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['candidates', characterId] })
      return client.invalidateQueries({ queryKey: ['project'] })
    },
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
 * Reloads what a character's audition shows after its phrase or style changed: the round, and the
 * takes of the voices shown, without searching Fish's library again.
 */
async function refreshAudition(client: QueryClient, characterId: string) {
  // A round shows the phrase and its takes too; reloading it asks Fish nothing.
  void client.invalidateQueries({ queryKey: ['session', characterId] })
  const key = ['candidates', characterId]
  const shown = client.getQueryData<NonNullable<CandidatesResult>>(key)
  if (!shown?.ok) return client.invalidateQueries({ queryKey: key })
  const voices = [shown.current?.id, ...shown.candidates.map((c) => c.voice.id)]
  const query = encodeURIComponent(voices.filter(Boolean).join(','))
  const fresh = await getJson<NonNullable<AuditionTakesResult>>(
    `/api/characters/${encodeURIComponent(characterId)}/audition?voices=${query}`,
  ).catch(() => null)
  if (!fresh?.ok) return client.invalidateQueries({ queryKey: key })
  client.setQueryData<NonNullable<CandidatesResult>>(key, (old) =>
    old?.ok ? withAuditionTakes<Found>(old, fresh.audition, fresh.takes) : old,
  )
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
        void client.invalidateQueries({ queryKey: ['candidates'] })
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
  const [dismissed, setDismissed] = useState<number | null>(null)
  const settled = last && last.status !== 'pending' && last.status !== 'idle'
  return {
    start: () => mutation.mutate(),
    pending,
    outcome:
      settled && last.submittedAt !== dismissed
        ? { result: last.data ?? null, error: last.error?.message ?? null }
        : null,
    dismiss: () => setDismissed(last?.submittedAt ?? null),
  }
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
 * Records audition takes: `record(voice)` asks the server for the take and adds it to the
 * candidates in the cache, without searching Fish again. `recording` holds the voices in progress,
 * `errors` what went wrong per voice.
 */
export function useTakes(characterId: string) {
  const client = useQueryClient()
  const [recording, setRecording] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})

  const record = useCallback(
    async (voice: string) => {
      setRecording((now) => new Set(now).add(voice))
      setErrors(({ [voice]: _gone, ...rest }) => rest)
      try {
        const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}/takes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ voice }),
        })
        if (!response.ok && response.status !== 409) {
          throw new Error(`recording answered ${response.status}`)
        }
        const result = (await response.json()) as NonNullable<TakeResult>
        if (result.ok) {
          client.setQueryData<NonNullable<CandidatesResult>>(['candidates', characterId], (old) =>
            old?.ok ? withTake<Found>(old, voice, result) : old,
          )
          client.setQueryData<SessionView>(['session', characterId], (old) =>
            old?.ok && old.audition ? withTake<Viewed>(old as Viewed, voice, result) : old,
          )
        } else {
          const message = 'message' in result ? result.message : 'the project’s files need fixing'
          setErrors((now) => ({ ...now, [voice]: message }))
        }
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
    [characterId, client],
  )

  return { record, recording, errors }
}

/** A character's audition in progress, with the phrase and the takes of the voices in it. */
export function useSession(characterId: string) {
  return useQuery({
    queryKey: ['session', characterId],
    queryFn: () => getJson<SessionView>(`/api/auditions/${encodeURIComponent(characterId)}`),
  })
}

/** What a session action sends: the path after the session's (`start`, `verdict`, …), and a body. */
export interface SessionAction {
  action: 'start' | 'verdict' | 'next' | 'more' | 'add' | 'discard'
  body?: unknown
}

/**
 * Changes a character's audition (start, verdicts, next round, more voices, add by id, discard)
 * and shows the answer. Actions run one after another, in the order asked.
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
    onSuccess: (view) => {
      if (!view.ok) return
      // An answer without the recorded lines (after a verdict) keeps the ones shown.
      client.setQueryData<SessionView>(['session', characterId], (old) =>
        view.recorded === undefined && old?.ok ? { ...view, recorded: old.recorded } : view,
      )
    },
  })
}

/**
 * Casts the one voice left in a character's audition. Afterwards the project, its parts (whose
 * lines are now stale) and the character's candidates are loaded again.
 */
export function useCast(characterId: string) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: `session-${characterId}` },
    mutationFn: async () => {
      const response = await fetch(`/api/auditions/${encodeURIComponent(characterId)}/cast`, {
        method: 'POST',
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
      void client.invalidateQueries({ queryKey: ['candidates', characterId] })
    },
  })
}

/** The URL of a recorded audition take. */
export function takeUrl(key: string): string {
  return `/api/takes/${key}.mp3`
}

/**
 * Records lines of a part: `record(key)` asks the server to record the line, then reloads the
 * part so its status shows. `recording` holds the lines in progress, `errors` what went wrong.
 */
export function useRecordLines(partId: string) {
  const client = useQueryClient()
  const [recording, setRecording] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})

  const record = useCallback(
    async (key: string) => {
      setRecording((now) => new Set(now).add(key))
      setErrors(({ [key]: _gone, ...rest }) => rest)
      try {
        const path = `/api/parts/${encodeURIComponent(partId)}/lines/${encodeURIComponent(key)}/record`
        const response = await fetch(path, { method: 'POST' })
        if (!response.ok && response.status !== 409) {
          throw new Error(`recording answered ${response.status}`)
        }
        const result = (await response.json()) as NonNullable<RecordResult>
        if (!result.ok) {
          const message = 'message' in result ? result.message : 'the part’s files need fixing'
          setErrors((now) => ({ ...now, [key]: message }))
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setErrors((now) => ({ ...now, [key]: message }))
      } finally {
        // The line stays "recording" until its new status is shown, so it is never offered twice.
        void client.invalidateQueries({ queryKey: ['plan', partId] })
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

  return { record, recording, errors }
}

/** What generating a part (or one speaker in it) would do, or why it cannot be planned. */
export type PlanAnswer =
  | { ok: true; plan: GenerationPlan; parallel: number }
  | { ok: false; problems: Problem[] }
  | ProjectFailure

/** The generation plan for a part, or one speaker in it (null for all); weak lines retaken if asked. */
export function usePlan(partId: string, speaker: string | null, weak = false) {
  return useQuery({
    queryKey: ['plan', partId, speaker, weak],
    queryFn: () => {
      const params = new URLSearchParams()
      if (speaker) params.set('speaker', speaker)
      if (weak) params.set('weak', '1')
      const query = params.size ? `?${params}` : ''
      return getJson<PlanAnswer>(`/api/parts/${encodeURIComponent(partId)}/plan${query}`)
    },
    // Ticking the retake box asks for another plan: keep showing the last one for the same scope
    // meanwhile (its buttons wait), but never another speaker's.
    placeholderData: (previous, query) =>
      query?.queryKey[2] === speaker ? keepPreviousData(previous) : undefined,
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
      retakeWeak?: boolean
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
