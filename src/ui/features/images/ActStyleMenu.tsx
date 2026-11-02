import { useId, useRef } from 'react'
import type { ImageRow } from '../../../core/images'
import { Problems } from '../../components/Problems'
import { useSetImageActStyle } from '../../api'
import { shortTitle } from '../../format'

/**
 * The menu of a shared image's page that picks the act whose style is added to its prompt (or
 * None), in place of the tick box. One pick holds for every act that lists the image; it is saved
 * at once, and shows what the project says, so a failed save leaves it as it was and says why.
 */
export function ActStyleMenu({
  imageId,
  actStyle,
  onSaved,
  onEdit,
}: {
  imageId: string
  actStyle: NonNullable<ImageRow['actStyle']>
  /** The pick was saved. */
  onSaved: () => void
  /** The person changed the menu. */
  onEdit: () => void
}) {
  const save = useSetImageActStyle(imageId)
  const id = useId()
  /** A save is on its way: set at the change, since the render that shows it may come later. */
  const saving = useRef(false)
  return (
    <div className="brief-field">
      <label htmlFor={id} className="label">
        Act style for this image
      </label>
      <select
        id={id}
        className="act-style-menu"
        value={actStyle.pick ?? ''}
        onChange={(e) => {
          if (saving.current) return
          saving.current = true
          onEdit()
          if (save.data || save.error) save.reset()
          save.mutate(
            { from: e.target.value === '' ? null : e.target.value },
            {
              onSettled: () => (saving.current = false),
              onSuccess: (result) => {
                if (result.ok) onSaved()
              },
            },
          )
        }}
      >
        {actStyle.choices?.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {shortTitle(choice.title)}&apos;s — {choice.text}
          </option>
        ))}
        <option value="">None</option>
      </select>
      <span className="muted images-act-style-note">
        One act&apos;s style is used for this image in every act.
      </span>
      {save.data && !save.data.ok && 'problems' in save.data && (
        <Problems title="Could not be saved" problems={save.data.problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </div>
  )
}
