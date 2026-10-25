import { useRef, useState, type FormEvent } from 'react'
import type { AuditionText } from '../../../core/takes'
import { useSetKeywords, useSetPhrase, useSetSpeed, useSetStyle } from '../../api'
import { SPEED } from '../../../core/resources'
import { speedDraft } from '../../speedDraft'
import { Problems } from '../../components/Problems'
import { addKeyword } from '../../keywords'
import { noPhraseText, phraseNote } from '../../castLanguages'

/**
 * A character's search keywords, saved in the cast: what the next audition searches Fish's
 * library with.
 */
export function KeywordsEditor({
  characterId,
  keywords,
  note,
}: {
  characterId: string
  keywords: string[]
  /** Said under the keywords in a project with several languages: they are one set for all. */
  note?: string
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
      {note && <span className="muted brief-hint">{note}</span>}
      {save.data && !save.data.ok && 'problems' in save.data && (
        <Problems title="The keywords could not be saved" problems={save.data.problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </form>
  )
}

/**
 * What a character says in its audition takes: its own phrase, or the project's standard one; in a
 * project with several languages, the phrase in `language`, which may be her longest line there
 * until she is given one, or missing.
 */
export function PhraseEditor({
  characterId,
  characterName,
  audition,
  language,
  languageName,
  lines = [],
}: {
  characterId: string
  characterName: string
  audition: AuditionText
  /** The language the phrase is in; left out in a project with one language. */
  language?: string
  languageName?: string
  /** Her lines in the language, to pick a phrase from. */
  lines?: string[]
}) {
  const save = useSetPhrase(characterId, language)
  const [draft, setDraft] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const several = language !== undefined && languageName !== undefined
  const text = draft ?? audition.phrase ?? ''
  const changed = draft !== null && draft.trim() !== (audition.phrase ?? '')
  const note = several ? phraseNote(audition, characterName, languageName) : null
  // A phrase borrowed from a line, or missing, is edited only on asking (Change, Write a phrase).
  const editing = !several || audition.from === 'own' || audition.from === 'standard' || changing
  const done = (result: { ok: boolean }) => {
    if (result.ok) {
      setDraft(null)
      setChanging(false)
    }
  }

  return (
    <form
      className="brief-item"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate(text.trim() || null, { onSuccess: done })
      }}
    >
      <label className="label" htmlFor="phrase">
        Audition phrase
        {several
          ? ''
          : ` · ${audition.from === 'own' ? 'this character’s own' : 'the project’s standard'}`}
      </label>
      {several && audition.phrase === null && !changing ? (
        <>
          <strong>None in {languageName} yet</strong>
          <span className="muted brief-hint">{noPhraseText(characterName, languageName)}</span>
          <button
            className="btn btn-small"
            type="button"
            onClick={() => {
              setChanging(true)
              setTimeout(() => area.current?.focus())
            }}
          >
            Write a phrase
          </button>
        </>
      ) : several && !editing ? (
        <>
          <span lang={language}>“{audition.phrase}”</span>
          <span className="muted brief-hint">
            {note}{' '}
            <button
              className="btn btn-ghost btn-small"
              type="button"
              onClick={() => setChanging(true)}
            >
              Change
            </button>
          </span>
        </>
      ) : (
        <>
          {lines.length > 0 && changing && (
            <select
              aria-label={`Pick one of ${characterName}’s ${languageName} lines`}
              value=""
              onChange={(e) => e.target.value && setDraft(e.target.value)}
            >
              <option value="">Pick one of her lines…</option>
              {lines.map((line) => (
                <option key={line} value={line}>
                  {line.length > 80 ? `${line.slice(0, 80)}…` : line}
                </option>
              ))}
            </select>
          )}
          <textarea
            id="phrase"
            ref={area}
            className="phrase"
            lang={language}
            rows={3}
            value={text}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="keyword-add">
            <button className="btn" type="submit" disabled={!changed || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save phrase'}
            </button>
            {audition.from === 'own' && (
              <button
                className="btn"
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate(null, { onSuccess: done })}
              >
                Use the standard phrase
              </button>
            )}
            {changing && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setDraft(null)
                  setChanging(false)
                }}
              >
                Cancel
              </button>
            )}
          </div>
          {note && <span className="muted brief-hint">{note}</span>}
        </>
      )}
      <span className="muted brief-hint">
        A changed phrase needs new takes.
        {audition.phrase !== null && (
          <>
            {' '}
            Sent to Fish as: <span className="mono">{audition.spoken}</span>
          </>
        )}
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
  language,
  label,
  beneath,
}: {
  characterId: string
  speed: number | null
  projectSpeed: number
  /** The language the speed is of, in a project with several; left out otherwise. */
  language?: string
  /** What the field is called in a project with several languages ("Speed · Deutsch"). */
  label?: string
  /** The other languages' speeds, listed beneath. */
  beneath?: string
}) {
  const save = useSetSpeed(characterId, language)
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
        {label ??
          `Speed · ${speed === null ? `the project’s, ${projectSpeed}` : 'this character’s own'}`}
      </label>
      <div className="keyword-add">
        <input
          id="speed"
          className="style-input mono"
          type="number"
          inputMode="decimal"
          min={SPEED.min}
          max={SPEED.max}
          // Any value in range, as the schema takes it: a step would refuse 0.93 at the submit.
          step="any"
          placeholder={String(projectSpeed)}
          value={shown}
          onChange={(e) => {
            if (save.data || save.error) save.reset()
            // Text the browser cannot read as a number ("1,2" in some locales) comes as an empty
            // value: kept as not a number, so it is never saved as the project's speed.
            setDraft(e.target.validity.badInput ? 'not a number' : e.target.value)
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
      {beneath && <span className="muted brief-hint">{beneath}</span>}
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
