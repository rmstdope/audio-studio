import { useState } from 'react'
import {
  EDIT_MODEL_IDS,
  editMenuEntry,
  editShortEntry,
  imageWarning,
  type EditModelId,
  type ImageDownload,
} from '../../../core/imageModels'
import { useFigures } from '../../api'
import { openTracking } from '../../components/openTracking'

/**
 * The menu choosing which model makes new patch takes, built like an image's own takes menu: no
 * heading; closed it shows the model's short name and time, open each entry its full name and
 * time, with what is wrong with a model (not on this computer, download incomplete, last take
 * failed) after it. Under it, the same warning for the model it is on.
 */
export function EditModelMenu({
  value,
  onChange,
  downloads,
  failed,
  label,
  disabled,
}: {
  value: EditModelId
  onChange: (model: EditModelId) => void
  downloads: Record<EditModelId, ImageDownload>
  /** The models whose last take failed. */
  failed: EditModelId[]
  /** The menu's name for screen readers. */
  label: string
  disabled: boolean
}) {
  const [listOpen, setListOpen] = useState(false)
  const figures = useFigures()
  const stateOf = (id: EditModelId) => ({ download: downloads[id], failed: failed.includes(id) })
  const warning = imageWarning(stateOf(value))
  return (
    <div className="edit-model">
      <select
        className="takes-model"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value as EditModelId)
          setListOpen(false)
        }}
        {...openTracking(setListOpen)}
      >
        {EDIT_MODEL_IDS.map((id) => (
          // The closed menu shows the label; the open list shows each entry in full.
          <option
            key={id}
            value={id}
            label={id === value && !listOpen ? editShortEntry(id, figures) : undefined}
          >
            {editMenuEntry(id, stateOf(id), figures)}
          </option>
        ))}
      </select>
      {warning && <span className="faint small">{warning}</span>}
    </div>
  )
}
