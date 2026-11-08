import type { ImageRow } from '../../../core/images'
import { areasCountText } from '../../imagesText'

/**
 * The named areas the game wants placed on an image: its title and id, and whether it is placed.
 * Read only; nothing on the page when the game names none.
 */
export function NamedAreasPanel({ row }: { row: ImageRow }) {
  if (row.areas.length === 0) return null
  const placed = row.areas.filter((area) => area.placed).length
  return (
    <section className="panel named-areas" aria-label="Named areas">
      <div className="brief-panel-head named-areas-head">
        <h2>Named areas</h2>
        <span className="muted">{areasCountText(placed, row.areas.length)}</span>
      </div>
      <p className="muted named-areas-intro">
        The parts of this picture the game names, so that a player can click them.
      </p>
      <ul className="named-area-list">
        {row.areas.map((area) => (
          <li key={area.id} className="named-area">
            <span className="named-area-text">
              <b>{area.title}</b>
              <span className="mono muted">{area.id}</span>
            </span>
            {area.placed ? (
              <span className="chip chip-ok">Placed</span>
            ) : (
              <span className="chip chip-attention">To place</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
