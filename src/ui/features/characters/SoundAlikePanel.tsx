import { useState } from 'react'
import { groupsProblem, sameGroups } from '../../../core/soundAlikeEdit'
import { useSetSoundAlike } from '../../api'
import { Problems } from '../../components/Problems'
import { plural } from '../../format'
import {
  addGroup,
  editGroup,
  groupsOf,
  removeGroup,
  startDraft,
  type SoundAlikeDraft,
} from '../../soundAlikeDraft'

/**
 * The project's own words that sound the same, a group each: Whisper writing one for another
 * still counts as heard. Added to the studio's built-in English ones. Edited as a whole and saved
 * at once in the project file; a save is refused if the file's groups changed since editing
 * began, so nobody's change is lost.
 */
export function SoundAlikePanel({
  groups,
  projectFile,
}: {
  groups: string[][]
  projectFile: string
}) {
  const save = useSetSoundAlike()
  const [draft, setDraft] = useState<SoundAlikeDraft | null>(null)
  const rows = draft?.rows ?? startDraft(groups).rows
  const edited = draft ? groupsOf(draft) : groups
  const changed = draft !== null && !sameGroups(edited, draft.base)
  // Someone changed the file since editing began: saving would be refused.
  const moved = draft !== null && !sameGroups(draft.base, groups)
  const problem = groupsProblem(edited)
  const problems = save.data && !save.data.ok ? save.data.problems : []

  const edit = (change: (draft: SoundAlikeDraft) => SoundAlikeDraft) => {
    if (save.data || save.error) save.reset()
    setDraft(change(draft ?? startDraft(groups)))
  }
  const discard = () => {
    save.reset()
    setDraft(null)
  }

  return (
    <section className="panel pronounce" aria-label="Words that sound the same">
      <div className="pronounce-head">
        <div>
          <span className="label">Words that sound the same</span>
          <strong>{groups.length ? plural(groups.length, 'group') : 'None of your own'}</strong>
        </div>
        <span className="muted">
          When Whisper writes one word of a group for another (“Liria” for “Lyria”), it still counts
          as heard, as for the studio’s built-in English ones (“inn” and “in”). Words are separated
          by commas. Counts from the next take on. Saved in{' '}
          <span className="mono">{projectFile}</span>.
        </span>
      </div>
      {/* Edits wait while a save is under way, so none is dropped when it lands. */}
      <fieldset className="pronounce-fields" disabled={save.isPending}>
        {rows.length > 0 && (
          <ol className="pronounce-rows">
            {rows.map(({ id, text }, i) => (
              <li key={id}>
                <input
                  className="mono"
                  aria-label={`Words, group ${i + 1}`}
                  placeholder="Lyria, Liria"
                  value={text}
                  onChange={(e) => edit((d) => editGroup(d, i, e.target.value))}
                />
                <div className="pronounce-actions">
                  <button
                    className="btn"
                    type="button"
                    aria-label={`Remove group ${i + 1}`}
                    onClick={() => edit((d) => removeGroup(d, i))}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </fieldset>
      <div className="pronounce-foot">
        <button
          className="btn"
          type="button"
          disabled={save.isPending}
          onClick={() => edit(addGroup)}
        >
          Add group
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
          disabled={!changed || moved || problem !== null || save.isPending}
          onClick={() =>
            save.mutate(
              { groups: edited, was: draft!.base },
              { onSuccess: (result) => result.ok && setDraft(null) },
            )
          }
        >
          {save.isPending ? 'Saving…' : 'Save words'}
        </button>
      </div>
      {moved && (
        <span className="adopt-error">
          The words that sound the same in the file changed since you began editing. Discard your
          changes to see them, then make yours again.
        </span>
      )}
      {problem && (
        <Problems
          title="The groups need a change"
          problems={[{ file: projectFile, path: 'narration.quality.soundAlike', message: problem }]}
        />
      )}
      {problems.length > 0 && <Problems title="The words could not be saved" problems={problems} />}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </section>
  )
}
