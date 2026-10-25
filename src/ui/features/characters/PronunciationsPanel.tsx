import { useState } from 'react'
import {
  cleanPronunciations,
  pronounceProblem,
  sameTable,
  spaceNote,
  type Pronunciation,
} from '../../../core/pronounce'
import { useSetPronunciations } from '../../api'
import { Problems } from '../../components/Problems'
import { plural } from '../../format'
import {
  addRow,
  editRow,
  moveRow,
  removeRow,
  startDraft,
  tableOf,
  type PronounceDraft,
} from '../../pronounceDraft'

/**
 * The project's pronunciation table: how words are said, applied to every line in the order
 * listed. Edited as a whole and saved at once; lines whose words as said change show as stale.
 * A save is refused if the file's table changed since editing began, so nobody's change is lost.
 */
export function PronunciationsPanel({
  table,
  castPath,
  language = null,
}: {
  table: Pronunciation[]
  castPath: string
  /** A language besides the source, whose own table this is; null: the source language's. */
  language?: { id: string; name: string } | null
}) {
  const save = useSetPronunciations(language?.id)
  const [draft, setDraft] = useState<PronounceDraft | null>(null)
  const rows = draft?.rows ?? startDraft(table).rows
  const edited = cleanPronunciations(draft ? tableOf(draft) : table)
  const changed = draft !== null && !sameTable(edited, draft.base)
  // Someone changed the file since editing began: saving would be refused.
  const moved = draft !== null && !sameTable(draft.base, table)
  // A problem in the table being edited (or, before editing, the file's), shown before Save.
  const tableProblem = pronounceProblem(edited)
  const problems = save.data && !save.data.ok && 'problems' in save.data ? save.data.problems : []

  const edit = (change: (draft: PronounceDraft) => PronounceDraft) => {
    if (save.data || save.error) save.reset()
    setDraft(change(draft ?? startDraft(table)))
  }
  const discard = () => {
    save.reset()
    setDraft(null)
  }

  return (
    <section className="panel pronounce" aria-label="Pronunciations">
      <div className="pronounce-head">
        <div>
          <span className="label">Pronunciations{language ? ` · ${language.name}` : ''}</span>
          <strong>{table.length ? plural(table.length, 'entry') : 'None yet'}</strong>
        </div>
        <span className="muted">
          Applied to every {language ? `${language.name} ` : ''}line, in the order the studio
          applies them, before it is sent; spaces count, so “Al ” is not in “Alice”. Saved in{' '}
          <span className="mono">{castPath}</span>.
        </span>
      </div>
      {/* Edits wait while a save is under way, so none is dropped when it lands. */}
      <fieldset className="pronounce-fields" disabled={save.isPending}>
        {rows.length > 0 && (
          <ol className="pronounce-rows">
            {rows.map(({ id, entry: [written, said] }, i) => {
              const note = [spaceNote(written), spaceNote(said)]
              return (
                <li key={id}>
                  <input
                    className="mono"
                    aria-label={`Written, entry ${i + 1}`}
                    placeholder="Written"
                    value={written}
                    onChange={(e) => edit((d) => editRow(d, i, 0, e.target.value))}
                  />
                  <span className="muted" aria-hidden="true">
                    →
                  </span>
                  <input
                    className="mono"
                    aria-label={`Said, entry ${i + 1}`}
                    placeholder="Said (empty: left out)"
                    value={said}
                    onChange={(e) => edit((d) => editRow(d, i, 1, e.target.value))}
                  />
                  <div className="pronounce-actions">
                    <button
                      className="btn"
                      type="button"
                      aria-label={`Move entry ${i + 1} up`}
                      disabled={i === 0}
                      onClick={() => edit((d) => moveRow(d, i, -1))}
                    >
                      ↑
                    </button>
                    <button
                      className="btn"
                      type="button"
                      aria-label={`Move entry ${i + 1} down`}
                      disabled={i === rows.length - 1}
                      onClick={() => edit((d) => moveRow(d, i, 1))}
                    >
                      ↓
                    </button>
                    <button
                      className="btn"
                      type="button"
                      aria-label={`Remove entry ${i + 1}`}
                      onClick={() => edit((d) => removeRow(d, i))}
                    >
                      Remove
                    </button>
                  </div>
                  {(note[0] || note[1]) && (
                    <span className="muted pronounce-note">
                      {[note[0] && `Written ${note[0]}`, note[1] && `said ${note[1]}`]
                        .filter(Boolean)
                        .join('; ')}
                      .
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </fieldset>
      <div className="pronounce-foot">
        <button
          className="btn"
          type="button"
          disabled={save.isPending}
          onClick={() => edit(addRow)}
        >
          Add entry
        </button>
        <span className="spacer" />
        {draft && (
          <button className="btn" type="button" onClick={discard}>
            Discard changes
          </button>
        )}
        <button
          className="btn btn-primary"
          type="button"
          disabled={!changed || moved || tableProblem !== null || save.isPending}
          onClick={() =>
            save.mutate(
              { table: edited, was: draft!.base },
              { onSuccess: (result) => result.ok && setDraft(null) },
            )
          }
        >
          {save.isPending ? 'Saving…' : 'Save pronunciations'}
        </button>
      </div>
      {moved ? (
        <span className="adopt-error">
          The pronunciations in the file changed since you began editing. Discard your changes to
          see them, then make yours again.
        </span>
      ) : (
        changed && (
          <span className="muted">
            Lines whose words as said change will show as stale until generated again.
          </span>
        )
      )}
      {tableProblem && (
        <Problems
          title="The table needs a change"
          problems={[
            {
              file: castPath,
              path: language ? `languages.${language.id}.pronounce` : 'pronounce',
              message: tableProblem,
            },
          ]}
        />
      )}
      {problems.length > 0 && (
        <Problems title="The pronunciations could not be saved" problems={problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </section>
  )
}
