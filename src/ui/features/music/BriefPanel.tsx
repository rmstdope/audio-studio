import { useId, useState } from 'react'
import { fieldSource, type BriefChange, type BriefField, type TrackRow } from '../../../core/music'
import type { MusicListSummary } from '../../../core/music'
import { Problems } from '../../components/Problems'
import { useSetTrackBrief } from '../../api'
import { fieldTag, fieldText, parseField } from '../../musicText'

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
export function BriefPanel({ track, kind }: { track: TrackRow; kind: MusicListSummary['kind'] }) {
  const [saved, setSaved] = useState(false)
  const field = (name: BriefField, label: string, extra: Partial<FieldProps> = {}) => (
    <FieldRow
      key={name}
      field={name}
      label={label}
      track={track}
      kind={kind}
      onSaved={() => setSaved(true)}
      onEdit={() => setSaved(false)}
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
  const send = (change: BriefChange) =>
    save.mutate(change, {
      onSuccess: (result) => {
        if (!result.ok) return
        clear()
        onSaved()
      },
    })
  const leave = () => {
    if (draft === null) return
    if (draft.trim() === shown) return clear()
    const parsed = parseField(field, draft, kind)
    if (!parsed.ok) return setProblem(parsed.message)
    setProblem(null)
    send(parsed.change)
  }
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
