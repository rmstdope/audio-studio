import { useState } from 'react'
import { useAllowVoices, useRuledOut } from '../../api'
import { plural } from '../../format'

/** How many ruled-out voices are listed before "Show all". */
const SHOWN = 3

/**
 * The voices ruled out for a character: dropped in its auditions and left out of every later
 * search for it. Each can be allowed again, or all forgotten so every voice is in the running.
 */
export function RuledOutPanel({
  characterId,
  name,
  language,
  languageName,
}: {
  characterId: string
  name: string
  /** The language whose list this is, in a project with several; left out otherwise. */
  language?: string
  languageName?: string
}) {
  const ruledOut = useRuledOut(characterId, language)
  const allow = useAllowVoices(characterId, language)
  const [all, setAll] = useState(false)
  // Forget all asks once more first: the list cannot be got back.
  const [confirming, setConfirming] = useState(false)
  const voices = ruledOut.data?.ok ? ruledOut.data.voices : []
  const shown = all ? voices : voices.slice(0, SHOWN)
  // The voice being allowed again (null: all of them), while it is.
  const pending = allow.isPending ? allow.variables : undefined

  return (
    <div className="brief-item">
      <span className="label">
        Ruled out · {languageName ?? (voices.length ? plural(voices.length, 'voice') : 'none')}
      </span>
      <span className="muted brief-hint">
        Voices you dropped. They are left out of every new search for {name}
        {languageName ? ` in ${languageName}` : ''}.
      </span>
      {languageName && ruledOut.data?.ok && voices.length === 0 && (
        <span className="muted">No voices ruled out in {languageName}.</span>
      )}
      {shown.length > 0 && (
        <ul className="ruled-out">
          {shown.map((voice) => (
            <li key={voice.id}>
              <span title={voice.id}>{voice.title || 'Untitled voice'}</span>
              <button
                className="btn btn-ghost btn-small"
                type="button"
                disabled={allow.isPending}
                onClick={() => allow.mutate(voice.id)}
              >
                {pending === voice.id ? 'Allowing…' : 'Allow again'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {voices.length > SHOWN && (
        <button className="btn btn-ghost btn-small" type="button" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${voices.length}`}
        </button>
      )}
      {voices.length > 0 &&
        (confirming ? (
          <div className="keyword-add">
            <button
              className="btn"
              type="button"
              disabled={allow.isPending}
              onClick={() => allow.mutate(null, { onSettled: () => setConfirming(false) })}
            >
              {pending === null ? 'Forgetting…' : `Forget all ${voices.length}`}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setConfirming(false)}>
              Keep them
            </button>
          </div>
        ) : (
          <button
            className="btn"
            type="button"
            disabled={allow.isPending}
            onClick={() => setConfirming(true)}
          >
            Forget all ruled-out voices
          </button>
        ))}
      {ruledOut.isError && <span className="adopt-error">{ruledOut.error.message}</span>}
      {allow.isError && <span className="adopt-error">{allow.error.message}</span>}
    </div>
  )
}
