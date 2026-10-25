import { useState, type FormEvent } from 'react'
import type { AuditionText } from '../../../core/takes'
import { useSetKeywords, useSetPhrase, useSetSpeed, useSetStyle } from '../../api'
import { SPEED } from '../../../core/resources'
import { speedDraft } from '../../speedDraft'
import { Problems } from '../../components/Problems'
import { addKeyword } from '../../keywords'

/**
 * A character's search keywords, saved in the cast: what the next audition searches Fish's
 * library with.
 */
export function KeywordsEditor({
  characterId,
  keywords,
}: {
  characterId: string
  keywords: string[]
}) {
  const save = useSetKeywords(characterId)
  const [draft, setDraft] = useState('')
  const current = save.isPending && save.variables ? save.variables : keywords

  const add = (event: FormEvent) => {
    event.preventDefault()
    const next = addKeyword(current, draft)
    if (next) save.mutate(next)
    setDraft('')
  }

  return (
    <form className="brief-item" onSubmit={add}>
      <label className="label" htmlFor="keyword">
        Search keywords
      </label>
      <div className="chips">
        {current.map((keyword) => (
          <span key={keyword} className="keyword">
            {keyword}
            <button
              type="button"
              aria-label={`Remove ${keyword}`}
              onClick={() => save.mutate(current.filter((k) => k !== keyword))}
            >
              ×
            </button>
          </span>
        ))}
        {current.length === 0 && <span className="muted">None yet</span>}
      </div>
      <div className="keyword-add">
        <input
          id="keyword"
          className="search"
          placeholder="e.g. elderly female"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn" type="submit" disabled={!draft.trim()}>
          Add
        </button>
      </div>
      <span className="muted brief-hint">
        Saved in the cast. Each keyword is searched, and voices are ranked by how many they match.
      </span>
      {save.data && !save.data.ok && 'problems' in save.data && (
        <Problems title="The keywords could not be saved" problems={save.data.problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </form>
  )
}

/** What a character says in its audition takes: its own phrase, or the project's standard one. */
export function PhraseEditor({
  characterId,
  audition,
}: {
  characterId: string
  audition: AuditionText
}) {
  const save = useSetPhrase(characterId)
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? audition.phrase
  const changed = draft !== null && draft.trim() !== audition.phrase

  return (
    <form
      className="brief-item"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate(text.trim() || null, { onSuccess: (result) => result.ok && setDraft(null) })
      }}
    >
      <label className="label" htmlFor="phrase">
        Audition phrase · {audition.own ? 'this character’s own' : 'the project’s standard'}
      </label>
      <textarea
        id="phrase"
        className="phrase"
        rows={3}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="keyword-add">
        <button className="btn" type="submit" disabled={!changed || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save phrase'}
        </button>
        {audition.own && (
          <button
            className="btn"
            type="button"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(null, { onSuccess: (result) => result.ok && setDraft(null) })
            }
          >
            Use the standard phrase
          </button>
        )}
      </div>
      <span className="muted brief-hint">
        A changed phrase needs new takes. Sent to Fish as:{' '}
        <span className="mono">{audition.spoken}</span>
      </span>
      {save.data && !save.data.ok && 'problems' in save.data && (
        <Problems title="The phrase could not be saved" problems={save.data.problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </form>
  )
}

/**
 * A character's style cue, saved in the cast: how every line without its own cue is said, and
 * the audition takes too.
 */
export function StyleEditor({ characterId, style }: { characterId: string; style: string }) {
  const save = useSetStyle(characterId)
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? style
  const changed = draft !== null && draft.trim() !== style

  return (
    <form
      className="brief-item"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate(text, { onSuccess: (result) => result.ok && setDraft(null) })
      }}
    >
      <label className="label" htmlFor="style">
        Style cue
      </label>
      <input
        id="style"
        className="style-input mono"
        placeholder="[warm, gentle, a little worried]"
        value={text}
        onChange={(e) => {
          // A new draft: what went wrong with the last one no longer applies.
          if (save.data || save.error) save.reset()
          setDraft(e.target.value)
        }}
      />
      <div className="keyword-add">
        <button className="btn" type="submit" disabled={!changed || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save style'}
        </button>
      </div>
      <span className="muted brief-hint">
        Saved in the cast. Every line without its own cue is said this way, and so are the audition
        takes: recorded lines show as stale until generated again.
      </span>
      {save.data && !save.data.ok && 'problems' in save.data && (
        <Problems title="The style could not be saved" problems={save.data.problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </form>
  )
}

/**
 * A character's own speaking speed, saved in the cast: its lines and takes are spoken at it
 * instead of the project's `tts.speed`.
 */
export function SpeedEditor({
  characterId,
  speed,
  projectSpeed,
}: {
  characterId: string
  speed: number | null
  projectSpeed: number
}) {
  const save = useSetSpeed(characterId)
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (speed === null ? '' : String(speed))
  const parsed = speedDraft(shown, speed)
  const done = (result: { ok: boolean }) => result.ok && setDraft(null)

  return (
    <form
      className="brief-item"
      onSubmit={(event) => {
        event.preventDefault()
        if (parsed.ok && parsed.changed) save.mutate(parsed.speed, { onSuccess: done })
      }}
    >
      <label className="label" htmlFor="speed">
        Speed · {speed === null ? `the project’s, ${projectSpeed}` : 'this character’s own'}
      </label>
      <div className="keyword-add">
        <input
          id="speed"
          className="style-input mono"
          type="number"
          inputMode="decimal"
          min={SPEED.min}
          max={SPEED.max}
          step={0.05}
          placeholder={String(projectSpeed)}
          value={shown}
          onChange={(e) => {
            if (save.data || save.error) save.reset()
            setDraft(e.target.value)
          }}
        />
        <button
          className="btn"
          type="submit"
          disabled={!parsed.ok || !parsed.changed || save.isPending}
        >
          {save.isPending ? 'Saving…' : 'Save speed'}
        </button>
        {speed !== null && (
          <button
            className="btn"
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate(null, { onSuccess: done })}
          >
            Use the project’s
          </button>
        )}
      </div>
      <span className="muted brief-hint">
        {parsed.ok
          ? `From ${SPEED.min} (half) to ${SPEED.max} (double). Saved in the cast; recorded lines show as stale until generated again.`
          : parsed.message}
      </span>
      {save.data && !save.data.ok && 'problems' in save.data && (
        <Problems title="The speed could not be saved" problems={save.data.problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </form>
  )
}
