import { useId, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { fieldSource, type BriefChange, type BriefField, type TrackRow } from '../../../core/music'
import type { MusicListSummary } from '../../../core/music'
import { Problems } from '../../components/Problems'
import { useKeepMyBrief, useSetTrackBrief } from '../../api'
import { WAIT_FOR_CHANGE } from '../../musicTakesText'
import { off } from '../../off'
import { fieldTag, fieldText, parseField } from '../../musicText'
import type { SaveWordsNow } from '../images/WordsField'

/** The change that puts a field back to the game's value. */
function gameChange(field: BriefField, game: TrackRow['game']): BriefChange {
  if (field === 'brief') return { brief: game.brief }
  if (field === 'seconds') return { seconds: game.seconds }
  if (field === 'bpm') return { bpm: game.bpm }
  return { key: game.key }
}

/**
 * A track's Brief panel: what it should sound like, its kind (set by the game), and its length,
 * tempo and key. Every field is always editable and is saved as it is left.
 */
export function BriefPanel({
  track,
  kind,
  saveNow,
}: {
  track: TrackRow
  kind: MusicListSummary['kind']
  /** Filled with the way to see every field saved. */
  saveNow?: Ref<SaveWordsNow>
}) {
  const [saved, setSaved] = useState(false)
  const fieldSaves = useRef(new Map<BriefField, SaveWordsNow>())
  useImperativeHandle(saveNow, () => () => {
    const saving = [...fieldSaves.current.values()]
      .map((saveField) => saveField())
      .filter((result) => result !== null)
    if (!saving.length) return null
    return Promise.all(saving).then((results) => results.every(Boolean))
  })
  const field = (name: BriefField, label: string, extra: Partial<FieldProps> = {}) => (
    <FieldRow
      key={name}
      field={name}
      label={label}
      track={track}
      kind={kind}
      onSaved={() => setSaved(true)}
      onEdit={() => setSaved(false)}
      saveNow={(saveField) => {
        if (saveField) fieldSaves.current.set(name, saveField)
        else fieldSaves.current.delete(name)
      }}
      {...extra}
    />
  )
  return (
    <section className="panel brief-panel">
      <div className="brief-panel-head">
        <h2>Brief</h2>
        {saved && (
          <span className="saved" role="status">
            Saved
          </span>
        )}
      </div>
      {track.gameChanged && <GameChanged track={track} />}
      {field('brief', 'What it should sound like', { multiline: true })}
      <div className="music-brief-grid">
        <div className="brief-field">
          <span className="label">Kind</span>
          <span className="chip music-kind">
            {kind === 'stingers' ? 'Stinger' : 'Loop'} · set by the game
          </span>
        </div>
        {field('seconds', 'Length (m:ss)')}
        {field('bpm', 'Tempo in bpm', { inputMode: 'numeric' })}
        {field('key', 'Key', { placeholder: 'e.g. D minor' })}
      </div>
    </section>
  )
}

/**
 * The notice on a track whose brief the game changed since the studio's was written: the game's
 * brief now, with Use the game's (the studio's brief goes) and Keep mine (it stays, over the
 * game's new brief), as the sound effects and images say it.
 */
function GameChanged({ track }: { track: TrackRow }) {
  const save = useSetTrackBrief(track.id)
  const keep = useKeepMyBrief(track.id)
  const busy = save.isPending || keep.isPending
  const error = save.error ?? keep.error
  const failed = [save.data, keep.data].find((data) => data && !data.ok && 'problems' in data)
  return (
    <section className="notice notice-warn" aria-label="The game's brief changed">
      <div className="notice-text">
        <strong>The game&apos;s brief changed since you changed yours.</strong>
        <span className="muted">
          Yours is still the one used. The game&apos;s now says: {track.game.brief}
        </span>
      </div>
      <div className="notice-actions">
        {failed && 'problems' in failed && (
          <Problems title="The brief could not be changed" problems={failed.problems} />
        )}
        {error && <span className="adopt-error">{error.message}</span>}
        <button
          className="btn"
          type="button"
          {...off(busy && WAIT_FOR_CHANGE)}
          onClick={() => save.mutate({ brief: track.game.brief })}
        >
          Use the game&apos;s
        </button>
        <button
          className="btn"
          type="button"
          {...off(busy && WAIT_FOR_CHANGE)}
          onClick={() => keep.mutate()}
        >
          Keep mine
        </button>
      </div>
    </section>
  )
}

/** What one brief field is given. */
interface FieldProps {
  field: BriefField
  label: string
  track: TrackRow
  kind: MusicListSummary['kind']
  multiline?: boolean
  placeholder?: string
  inputMode?: 'numeric'
  /** The field was saved. */
  onSaved: () => void
  /** The person began changing the field. */
  onEdit: () => void
  /** Filled with the way to see the field saved. */
  saveNow: Ref<SaveWordsNow>
}

/** One field of the panel: its label, where its value comes from, and its input. */
function FieldRow({
  field,
  label,
  track,
  kind,
  multiline,
  placeholder,
  inputMode,
  onSaved,
  onEdit,
  saveNow,
}: FieldProps) {
  // One save per field: a refusal or a draft belongs to the field it was typed in.
  const save = useSetTrackBrief(track.id)
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const shown = fieldText(track, field)
  const source = fieldSource(track, field)
  const text = draft ?? shown
  const clear = () => {
    setDraft(null)
    setProblem(null)
  }
  // Set the moment the field is left: a press that left it comes before any render.
  const saving = useRef<Promise<boolean> | null>(null)
  const send = (change: BriefChange) => {
    const sent = save
      .mutateAsync(change, {
        onSuccess: (result) => {
          if (!result.ok) return
          clear()
          onSaved()
        },
      })
      .then(
        (result) => result.ok,
        () => false,
      )
    saving.current = sent
    void sent.then(() => {
      if (saving.current === sent) saving.current = null
    })
    return sent
  }
  const leave = () => {
    if (draft === null) return null
    if (draft.trim() === shown) {
      clear()
      return null
    }
    const parsed = parseField(field, draft, kind)
    if (!parsed.ok) {
      setProblem(parsed.message)
      return Promise.resolve(false)
    }
    setProblem(null)
    return send(parsed.change)
  }
  useImperativeHandle(saveNow, () => () => saving.current ?? leave())
  const change = (value: string) => {
    onEdit()
    setProblem(null)
    if (save.data || save.error) save.reset()
    setDraft(value)
  }
  return (
    <div className="brief-field">
      <div className="brief-field-head">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        {source === 'changed' ? (
          <span className="field-tag changed">
            changed here ·{' '}
            <button
              className="link-button"
              type="button"
              onClick={() => {
                clear()
                onEdit()
                send(gameChange(field, track.game))
              }}
            >
              use the game&apos;s
            </button>
          </span>
        ) : (
          <span className="field-tag">{fieldTag(source)}</span>
        )}
      </div>
      {multiline ? (
        <textarea
          id={id}
          className="brief-input"
          rows={3}
          value={text}
          onChange={(e) => change(e.target.value)}
          onBlur={leave}
          aria-invalid={problem ? true : undefined}
        />
      ) : (
        <input
          id={id}
          className="brief-input"
          value={text}
          placeholder={placeholder}
          inputMode={inputMode}
          onChange={(e) => change(e.target.value)}
          onBlur={leave}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-invalid={problem ? true : undefined}
        />
      )}
      {problem && <span className="adopt-error">{problem}</span>}
      {save.data && !save.data.ok && 'problems' in save.data && (
        <Problems title="The brief could not be saved" problems={save.data.problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </div>
  )
}
