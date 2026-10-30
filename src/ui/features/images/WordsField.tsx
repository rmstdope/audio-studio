import type { UseMutationResult } from '@tanstack/react-query'
import { useId, useState, type Ref } from 'react'
import type { ImageEditResult } from '../../../services/imageEdits'
import { Problems } from '../../components/Problems'

/** The save of a field of the user's own words: `useSetImageWords` or `useSetStyleField`. */
export type WordsSave = UseMutationResult<NonNullable<ImageEditResult>, Error, string | null>

/**
 * A field of the user's own words over the game's: labelled "from the game", or "changed here ·
 * use the game's" in warn colour; saved when left. An emptied field takes the user's words back,
 * as does the game's own text typed back (the server decides which).
 */
export function WordsField({
  label,
  words,
  changed,
  save,
  onSaved,
  onEdit,
  inputRef,
}: {
  label: string
  words: string
  changed: boolean
  save: WordsSave
  /** The words were saved. */
  onSaved: () => void
  /** The person began changing the field. */
  onEdit: () => void
  inputRef?: Ref<HTMLTextAreaElement>
}) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? words
  const send = (value: string | null) =>
    save.mutate(value, {
      onSuccess: (result) => {
        if (!result.ok) return
        setDraft(null)
        onSaved()
      },
    })
  const leave = () => {
    if (draft === null) return
    if (draft.trim() === words) return setDraft(null)
    send(draft.trim() === '' ? null : draft)
  }
  return (
    <div className="brief-field">
      <div className="brief-field-head">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        {changed ? (
          <span className="field-tag changed">
            changed here ·{' '}
            <button
              className="link-button"
              type="button"
              onClick={() => {
                onEdit()
                send(null)
              }}
            >
              use the game&apos;s
            </button>
          </span>
        ) : (
          <span className="field-tag">from the game</span>
        )}
      </div>
      <textarea
        id={id}
        ref={inputRef}
        className="brief-input"
        rows={Math.max(3, Math.ceil(text.length / 70))}
        value={text}
        onChange={(e) => {
          onEdit()
          if (save.data || save.error) save.reset()
          setDraft(e.target.value)
        }}
        onBlur={leave}
      />
      {save.data && !save.data.ok && 'problems' in save.data && (
        <Problems title="Could not be saved" problems={save.data.problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </div>
  )
}
