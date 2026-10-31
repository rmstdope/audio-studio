import { useRef } from 'react'
import type { ImageRow } from '../../../core/images'
import { Problems } from '../../components/Problems'
import { useSetImageActStyle } from '../../api'

/**
 * The tick box of an image's page that adds its act's style to the prompt: ticked is how every
 * image is. A change is saved at once; the box shows what the project says, so a failed save
 * leaves it as it was and says why under it.
 */
export function ActStyleBox({
  imageId,
  actName,
  actStyle,
  onSaved,
  onEdit,
}: {
  imageId: string
  actName: string
  actStyle: NonNullable<ImageRow['actStyle']>
  /** The choice was saved. */
  onSaved: () => void
  /** The person changed the box. */
  onEdit: () => void
}) {
  const save = useSetImageActStyle(imageId)
  /** A save is on its way: set at the click, since the render that shows it may come later. */
  const saving = useRef(false)
  return (
    <div className="brief-field">
      <label className="act-style-box">
        <input
          type="checkbox"
          checked={actStyle.on}
          onChange={(e) => {
            // not disabled while saving: a disabled box would lose focus
            if (saving.current) return
            saving.current = true
            onEdit()
            if (save.data || save.error) save.reset()
            save.mutate(e.target.checked, {
              onSettled: () => (saving.current = false),
              onSuccess: (result) => {
                if (result.ok) onSaved()
              },
            })
          }}
        />
        <span>
          <span>Add {actName}&apos;s style to this image</span>
          <br />
          <span className={actStyle.on ? 'muted' : 'act-style-off'}>{actStyle.text}</span>
        </span>
      </label>
      {save.data && !save.data.ok && 'problems' in save.data && (
        <Problems title="Could not be saved" problems={save.data.problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </div>
  )
}
