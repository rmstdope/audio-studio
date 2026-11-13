import { useLatestSave } from '../../useAfterSaved'
import type { UseMutationResult } from '@tanstack/react-query'
import { useId, useImperativeHandle, useState, type Ref } from 'react'
import type { ImageEditResult } from '../../../services/imageEdits'
import { Problems } from '../../components/Problems'

/** The save of a field of the user's own words: `useSetImageWords`, `useSetStyleField` or `useSetEffectDescription`. */
export type WordsSave = UseMutationResult<NonNullable<ImageEditResult>, Error, string | null>

/**
 * Sees the field's words saved before something that reads them: answers whether they were, once
 * the save under way or begun now is over, or null when there is nothing to save.
 */
export type SaveWordsNow = () => Promise<boolean> | null

/**
 * A field of the user's own words over the game's: labelled "from the game", or "changed here ·
 * use the game's" in warn colour; saved when left. An emptied field takes the user's words back,
 * as does the game's own text typed back (the server decides which). Without `changed` the words
 * are the studio's own (the style), and the field has no label of where they are from.
 */
export function WordsField({
  label,
  words,
  changed,
  save,
  onSaved,
  onEdit,
  saveNow,
  inputRef,
  failTitle = 'Could not be saved',
}: {
  label: string
  words: string
  /** The user's words are over the game's; absent for words with no game's to go back to. */
  changed?: boolean
  save: WordsSave
  /** The words were saved. */
  onSaved: () => void
  /** The person began changing the field. */
  onEdit: () => void
  /** Filled with the way to see the words saved. */
  saveNow?: Ref<SaveWordsNow>
  inputRef?: Ref<HTMLTextAreaElement>
  /** The heading over the problems a failed save reports. */
  failTitle?: string
}) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? words
  // Set the moment the field is left: a press that left it comes before any render.
  const saving = useLatestSave()
  const send = (value: string | null) => {
    const saved = save
      .mutateAsync(value, {
        onSuccess: (result) => {
          if (!result.ok) return
          setDraft(null)
          onSaved()
        },
      })
      .then(
        (result) => result.ok,
        () => false,
      )
    return saving.track(saved)
  }
  const leave = () => {
    if (draft === null) return null
    if (draft.trim() === words) {
      setDraft(null)
      return null
    }
    return send(draft.trim() === '' ? null : draft)
  }
  useImperativeHandle(saveNow, () => () => saving.current() ?? leave())
  return (
    <div className="brief-field">
      <div className="brief-field-head">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        {changed === undefined ? null : changed ? (
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
        <Problems title={failTitle} problems={save.data.problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </div>
  )
}
