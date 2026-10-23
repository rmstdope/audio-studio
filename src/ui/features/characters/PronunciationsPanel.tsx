import { useState } from 'react'
import { sameTable, type Pronunciation } from '../../../core/pronounce'
import { useSetPronunciations } from '../../api'
import { Problems } from '../../components/Problems'
import { plural } from '../../format'

/**
 * The project's pronunciation table: how words are said, applied to every line in the order
 * listed. Edited as a whole and saved at once; lines whose words as said change show as stale.
 */
export function PronunciationsPanel({
  table,
  castPath,
}: {
  table: Pronunciation[]
  castPath: string
}) {
  const save = useSetPronunciations()
  const [draft, setDraft] = useState<Pronunciation[] | null>(null)
  const rows = draft ?? table
  const changed = draft !== null && !sameTable(draft, table)
  const problems = save.data && !save.data.ok && 'problems' in save.data ? save.data.problems : []

  const edit = (next: Pronunciation[]) => {
    if (save.data || save.error) save.reset()
    setDraft(next)
  }
  const setCell = (row: number, side: 0 | 1, value: string) =>
    edit(
      rows.map((r, i): Pronunciation => (i === row ? (side ? [r[0], value] : [value, r[1]]) : r)),
    )
  const move = (row: number, by: -1 | 1) => {
    const next = [...rows]
    const [taken] = next.splice(row, 1)
    next.splice(row + by, 0, taken!)
    edit(next)
  }

  return (
    <section className="panel pronounce" aria-label="Pronunciations">
      <div className="pronounce-head">
        <div>
          <span className="label">Pronunciations</span>
          <strong>{table.length ? plural(table.length, 'entry') : 'None yet'}</strong>
        </div>
        <span className="muted">
          Applied to every line in this order before it is sent, so a name is said the same
          everywhere. Saved in <span className="mono">{castPath}</span>.
        </span>
      </div>
      {rows.length > 0 && (
        <ol className="pronounce-rows">
          {rows.map(([written, said], i) => (
            <li key={i}>
              <input
                className="mono"
                aria-label={`Written, entry ${i + 1}`}
                placeholder="Written"
                value={written}
                onChange={(e) => setCell(i, 0, e.target.value)}
              />
              <span className="muted" aria-hidden="true">
                →
              </span>
              <input
                className="mono"
                aria-label={`Said, entry ${i + 1}`}
                placeholder="Said"
                value={said}
                onChange={(e) => setCell(i, 1, e.target.value)}
              />
              <div className="pronounce-actions">
                <button
                  className="btn"
                  type="button"
                  aria-label={`Move entry ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  className="btn"
                  type="button"
                  aria-label={`Move entry ${i + 1} down`}
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => edit(rows.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="pronounce-foot">
        <button className="btn" type="button" onClick={() => edit([...rows, ['', '']])}>
          Add entry
        </button>
        <span className="spacer" />
        {changed && (
          <button
            className="btn"
            type="button"
            onClick={() => {
              save.reset()
              setDraft(null)
            }}
          >
            Discard changes
          </button>
        )}
        <button
          className="btn btn-primary"
          type="button"
          disabled={!changed || save.isPending}
          onClick={() =>
            save.mutate(
              { table: rows, was: table },
              { onSuccess: (result) => result.ok && setDraft(null) },
            )
          }
        >
          {save.isPending ? 'Saving…' : 'Save pronunciations'}
        </button>
      </div>
      {changed && (
        <span className="muted">
          Lines whose words as said change will show as stale until generated again.
        </span>
      )}
      {problems.length > 0 && (
        <Problems title="The pronunciations could not be saved" problems={problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </section>
  )
}
