import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { PatchArea } from '../../../core/imagePatches'
import { Problems } from '../../components/Problems'
import { useImagePatches, useMakeImagePatch } from '../../api'
import { areaFromDrag, sameArea } from '../../imagePatchArea'

/** Where an area lies on a picture of this size, in the percentages the page draws with. */
function placed(area: PatchArea, take: { width: number; height: number }): CSSProperties {
  return {
    left: `${(area.x / take.width) * 100}%`,
    top: `${(area.y / take.height) * 100}%`,
    width: `${(area.width / take.width) * 100}%`,
    height: `${(area.height / take.height) * 100}%`,
  }
}

/**
 * The patch experiment on an image's page: drag over the chosen take to mark an area, say what
 * should change there, and judge the patch laid over the take, switching it off and on. Every try
 * is kept and can be picked again; nothing here reaches the game.
 */
export function PatchesSection({ imageId }: { imageId: string }) {
  const patches = useImagePatches(imageId)
  const make = useMakeImagePatch(imageId)
  const [area, setArea] = useState<PatchArea | null>(null)
  const [instruction, setInstruction] = useState('')
  const [picked, setPicked] = useState<number | null>(null)
  const [showing, setShowing] = useState(true)
  const start = useRef<{ x: number; y: number } | null>(null)
  const view = patches.data
  if (!view) return null
  if ('ok' in view) {
    return <Problems title={`${view.file} cannot be used`} problems={view.problems} />
  }
  const { take } = view
  if (!take) return null
  const shown = view.patches.find((p) => p.n === picked) ?? view.patches.at(-1) ?? null
  const overlaid = showing ? shown : null
  const making = view.making !== null || make.isPending
  const canMake = area !== null && instruction.trim() !== '' && !making

  const dragTo = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const marked = areaFromDrag(
      start.current,
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
      take,
    )
    setArea(marked)
  }

  return (
    <section className="panel patches" aria-label="Patches">
      <h2>Patches</h2>
      <p className="muted">
        Drag over the chosen take to mark an area, then say what should change there. The whole take
        is edited and only the marked area is kept, with a soft edge. An experiment: nothing here
        reaches the game.
      </p>
      <div
        className="patch-stage"
        style={{ aspectRatio: `${take.width} / ${take.height}` }}
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          start.current = { x: event.clientX, y: event.clientY }
          setArea(null)
        }}
        onPointerMove={dragTo}
        onPointerUp={(event) => {
          dragTo(event)
          start.current = null
        }}
      >
        <img
          className="patch-take"
          src={`/api/images/${encodeURIComponent(imageId)}/takes/${take.n}`}
          alt="The chosen take"
          draggable={false}
        />
        {overlaid && (
          <img
            className="patch-over"
            src={`/api/images/${encodeURIComponent(imageId)}/patches/${overlaid.n}`}
            alt={`Patch ${overlaid.n}`}
            draggable={false}
          />
        )}
        {area && !(overlaid && sameArea(area, overlaid.area)) && (
          <div className="patch-mark" style={placed(area, take)} />
        )}
      </div>
      <label className="patch-toggle">
        <input
          className="patch-switch"
          type="checkbox"
          checked={showing}
          disabled={!shown}
          onChange={(event) => setShowing(event.target.checked)}
        />
        Show the patch
      </label>
      <label className="label" htmlFor={`patch-instruction-${imageId}`}>
        What should change in the marked area
      </label>
      <textarea
        id={`patch-instruction-${imageId}`}
        rows={2}
        value={instruction}
        placeholder="The bucket is gone, only cobblestones there."
        onChange={(event) => setInstruction(event.target.value)}
      />
      <div className="patch-actions">
        <button
          className="btn btn-primary patch-make"
          type="button"
          disabled={!canMake}
          onClick={() => {
            if (!area) return
            setPicked(null)
            setShowing(true)
            make.mutate({ area, instruction: instruction.trim() })
          }}
        >
          Make patch
        </button>
        {making && <span role="status">Making the patch…</span>}
        {!area && !making && <span className="muted">Drag over the picture to mark an area.</span>}
      </div>
      {view.failed && <p className="adopt-error">{view.failed.message}</p>}
      {make.error && <p className="adopt-error">{make.error.message}</p>}
      {make.data && !make.data.ok && 'message' in make.data && (
        <p className="adopt-error">{make.data.message}</p>
      )}
      {view.patches.length > 0 && (
        <ul className="patch-tries">
          {[...view.patches].reverse().map((p) => (
            <li key={p.n}>
              <button
                className="btn"
                type="button"
                aria-pressed={p.n === shown?.n}
                onClick={() => {
                  setPicked(p.n)
                  setShowing(true)
                  setArea(p.area)
                }}
              >
                {p.n}. {p.instruction}
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="muted">
        Saved in <span className="mono">{view.folder}</span>
      </span>
    </section>
  )
}
