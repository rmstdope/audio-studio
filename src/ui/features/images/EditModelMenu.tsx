import {
  EDIT_MODEL_IDS,
  editMenuEntry,
  editShortEntry,
  imageWarning,
  type EditModelId,
  type ImageDownload,
} from '../../../core/imageModels'
import { useFigures } from '../../api'
import { off } from '../../off'
import { MenuFace } from '../../components/MenuFace'

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
  why,
}: {
  value: EditModelId
  onChange: (model: EditModelId) => void
  downloads: Record<EditModelId, ImageDownload>
  /** The models whose last take failed. */
  failed: EditModelId[]
  /** The menu's name for screen readers. */
  label: string
  /** Why the menu is off; null or false when it is on. */
  why?: string | false | null
}) {
  const figures = useFigures()
  const stateOf = (id: EditModelId) => ({ download: downloads[id], failed: failed.includes(id) })
  const warning = imageWarning(stateOf(value))
  return (
    <div className="edit-model">
      <MenuFace text={editShortEntry(value, figures)}>
        <select
          className="takes-model"
          aria-label={label}
          value={value}
          {...off(why)}
          onChange={(event) => onChange(event.target.value as EditModelId)}
        >
          {EDIT_MODEL_IDS.map((id) => (
            <option key={id} value={id}>
              {editMenuEntry(id, stateOf(id), figures)}
            </option>
          ))}
        </select>
      </MenuFace>
      {warning && <span className="faint small">{warning}</span>}
    </div>
  )
}
