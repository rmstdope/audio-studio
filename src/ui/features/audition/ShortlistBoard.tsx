import { useEffect, useRef, useState, type FormEvent } from 'react'
import { designGroups, quoted } from '../../../core/design'
import type { AuditionSession } from '../../../core/audition'
import type { CharacterSummary } from '../../../core/summary'
import { providerOf, type VoiceProvider } from '../../../core/voices'
import type { SessionView } from '../../../services/sessions'
import { castInLanguage, shortlistNote, type Language } from '../../castLanguages'
import {
  useCast,
  useElevenAccount,
  useOwnVoices,
  useRuledOut,
  useSessionAction,
  useSitting,
  useSittingActions,
  useTakes,
  type SessionAction,
} from '../../api'
import {
  castEffects,
  droppedRuledOut,
  isRuledOut,
  ownSectionState,
  playsVoice,
  recordable,
  addsVoice,
  slotWaiters,
  slotsLeftFor,
  saveFailedLine,
  stopEffectsFor,
  takesToRecord,
  takeWaits,
  undoFor,
  waitingForCredits,
} from '../../board'
import { useFocusWhenClosed } from '../../components/useFocusWhenClosed'
import { DesignVoice } from './DesignVoice'
import { CheckIcon, CrossIcon, SparkIcon } from '../../components/icons'
import { Confirm } from '../../components/Confirm'
import { Failure } from '../../components/Failure'
import { routeHref } from '../../route'
import { voiceIdFrom } from '../../voiceId'
import { CreditsAsk } from './CreditsAsk'
import { SittingBox, sittingFailure } from './SittingBox'
import { SittingMeter } from './SittingMeter'
import { VoiceSlots } from './VoiceSlots'
import { VoiceCard } from './VoiceCard'

/** What the board is asking about before it acts: casting a voice, or stopping the audition. */
type Asking = { kind: 'cast'; voice: string } | { kind: 'stop' } | null

/**
 * An audition as one board: the shortlist the cast is chosen from, the voices to hear with Drop
 * and Shortlist on each, and ways to bring in more. Takes record by themselves (the audition
 * model is free). A drop can be undone; casting, keeping and stopping say what they do first.
 */
export function ShortlistBoard({
  characterId,
  character,
  languages,
  language,
  name,
  lines,
  designStart,
  view,
  playing,
  toggle,
  stop,
  cast,
  titles,
}: {
  characterId: string
  character: CharacterSummary
  /** Every declared language. */
  languages: Language[]
  /** The language of the audition, in a project with several; null in a project with one. */
  language: Language | null
  /** The character's name. */
  name: string
  /** The character's lines in every part (in the language). */
  lines: number
  /** The text the design box starts with when nothing was sent before. */
  designStart: string
  view: Extract<SessionView, { ok: true }> & { session: AuditionSession }
  playing: string | null
  toggle: (id: string, url: string) => void
  /** Stops what plays: a dropped voice is not heard on after its card is gone. */
  stop: () => void
  /** Casting, owned by the page so its result outlives the board. */
  cast: ReturnType<typeof useCast>
  /** Short part titles by id, for saying where lines go stale. */
  titles: Map<string, string>
}) {
  const { session, takes, audition } = view
  const act = useSessionAction(characterId, language?.id)
  const sittingQuery = useSitting(characterId, true, language?.id)
  const recorder = useTakes(characterId, true, language?.id)
  const sittingActions = useSittingActions(characterId, language?.id)
  const ruledOut = useRuledOut(characterId, language?.id)
  const own = useOwnVoices(characterId, language?.id)
  const page = routeHref({
    view: 'character',
    character: characterId,
    ...(language ? { language: language.id } : {}),
  })
  const [asking, setAsking] = useState<Asking>(null)
  // The voice this page dropped last; its drop can be undone while it is the last one.
  const [droppedHere, setDroppedHere] = useState<string | null>(null)
  const [voiceId, setVoiceId] = useState('')
  // Whose voice the id is: Fish's ids and ElevenLabs' look alike, so the user says.
  const [provider, setProvider] = useState<VoiceProvider>('fish')
  // Whose library Bring in more searches.
  const [from, setFrom] = useState<VoiceProvider>('fish')
  const [idError, setIdError] = useState<string | null>(null)
  // Bring in more was pressed with no keywords to search: it asks nothing and says so.
  const [noKeywords, setNoKeywords] = useState(false)
  const [designing, setDesigning] = useState(false)
  const designButton = useRef<HTMLButtonElement>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  // The library Bring in more is searching, while it does.
  const searching =
    act.isPending && act.variables?.action === 'more'
      ? ((act.variables.body as { provider?: VoiceProvider } | undefined)?.provider ?? 'fish')
      : null
  // An audition with nothing to hear yet opens on the way to bring voices in.
  useEffect(() => {
    if (!session.heard) moreButton.current?.focus()
    // Once, when the board opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const refocusDesign = useFocusWhenClosed(designing, designButton)

  // Every take is asked for once per phrase, so a take the cache cannot show is not asked again.
  const asked = useRef(new Set<string>())
  // The money of a paid audition: takes wait for its sitting (a read of it, once known).
  const money = sittingQuery.data?.ok ? sittingQuery.data : null
  const paid = money?.paid ?? false
  const sitting = money?.sitting ?? null
  // ElevenLabs voices' takes are paid in credits: without them they wait, and the board asks.
  const credits = money?.eleven.sitting ?? null
  // The plan's voice slots matter once library voices are on the board, or are being searched for.
  const showsSlots =
    from === 'elevenlabs' || Object.values(session.voices).some((voice) => voice.library)
  const account = useElevenAccount(showsSlots)
  const slots =
    account.data?.account.ok && account.data.account.account.voiceSlots.limit > 0
      ? account.data.account.account.voiceSlots
      : null
  // Whether a voice's take would add it to the user's ElevenLabs voices, using a slot.
  const adds = (id: string) => addsVoice(session, takes, id)
  // Library voices whose take would add them wait while no slot is free for them; a take that
  // may have added one counts until the account is read again.
  const slotWaiting = slotWaiters(
    session,
    takes,
    // While the account is being read, none is known to be free.
    account.isPending ? 0 : slotsLeftFor(slots, recorder.mayHaveAdded, account.dataUpdatedAt),
    new Set(Object.keys(recorder.errors)),
  )
  const onBoard = recordable(session, credits !== null, slotWaiting)
  // While a paid model's dollars are asked for, so are the credits after them: the dollars'
  // fresh sitting would end credits given before.
  const wantCredits =
    money && !credits && !(paid && !sitting) ? waitingForCredits(session, takes) : []
  // Unknown money counts as free: the server refuses a paid take that has no sitting anyway.
  const ready = !sittingQuery.isPending && (!paid || sitting !== null)
  const missing =
    audition?.phrase != null && ready
      ? takesToRecord(onBoard, takes, recorder.recording, recorder.errors).filter(
          (v) => !asked.current.has(`${audition.spoken}\n${v}`),
        )
      : []
  useEffect(() => {
    for (const voice of missing) {
      asked.current.add(`${audition?.spoken}\n${voice}`)
      void recorder.record(voice, adds(voice))
    }
    // `missing` is new on every render; what it holds is what matters.
  }, [missing.join(',')])

  // Money added to the sitting: the voices that waited for it get their takes.
  // Only a change of a total is new money, and only for the voices it pays for.
  useEffect(() => {
    if (sitting && !sitting.usedUp) recorder.retryWaiting('fish')
  }, [sitting?.dollars])
  useEffect(() => {
    if (credits && !credits.usedUp) recorder.retryWaiting('elevenlabs', adds)
  }, [credits?.dollars])
  const waitingIn = (provider: VoiceProvider) =>
    [...recorder.waiting].filter((v) => providerOf(v) === provider).length
  // The account's own voices are fetched when the board opens (a start, or a resume).
  useEffect(() => own.fetch(), [])

  // Nothing of the board plays on once it is gone (the audition stopped or a voice cast).
  useEffect(() => stop, [])

  const run = (action: SessionAction, onDone?: () => void) => {
    setAsking(null)
    act.mutate(action, { onSuccess: (result) => result.ok && onDone?.() })
  }
  const move = (voice: string, to: 'shortlist' | 'unlist' | 'drop') => {
    // At once, not when the drop is saved: Drop says the voice has been heard enough.
    if (to === 'drop' && playsVoice(playing, voice)) stop()
    run({ action: 'move', body: { voice, move: to } }, () =>
      setDroppedHere(to === 'drop' ? voice : null),
    )
  }
  const undoable = undoFor(droppedHere, session.dropped)
  const title = (id: string) => session.voices[id]?.title || 'Untitled voice'
  const current = session.current ? title(session.current) : null
  const ruledIds = ruledOut.data?.ok ? ruledOut.data.voices.map((v) => v.id) : null
  // Dropped and still ruled out: one allowed again from the list since is not counted.
  const dropped = droppedRuledOut(session.dropped, ruledIds, session.current).length

  const addById = (event: FormEvent) => {
    event.preventDefault()
    const id = voiceIdFrom(voiceId, provider)
    if (!id) {
      return setIdError(
        provider === 'fish'
          ? 'That is not a Fish voice id or voice URL.'
          : 'That is not an ElevenLabs voice id.',
      )
    }
    setIdError(null)
    run({ action: 'add', body: { voice: id } }, () => {
      setDroppedHere(null)
      setVoiceId('')
    })
  }

  const card = (id: string, listed: boolean) => {
    const voice = session.voices[id]
    if (!voice) return null
    const isCurrent = id === session.current
    const designed = voice.design !== undefined
    // Saving a design to the Fish account takes a while: its card says so, and a failure stays on it.
    // A library voice not yet in the user's ElevenLabs voices is added when it is cast.
    const saving = (designed || adds(id)) && cast.isPending && cast.variables === id
    const saveFailed =
      (designed || voice.library) &&
      cast.data &&
      !cast.data.ok &&
      'reason' in cast.data &&
      cast.data.reason === 'save' &&
      cast.data.voice === id
        ? cast.data.message
        : null
    return (
      <VoiceCard
        key={id}
        voice={voice}
        candidate={session.matched[id] ? { voice, matched: session.matched[id] } : undefined}
        keywordCount={session.keywords.length}
        note={
          language
            ? shortlistNote(character, languages, language.id, id)
            : isCurrent
              ? 'Cast now'
              : undefined
        }
        playing={playing}
        toggle={toggle}
        take={takes[id] ?? null}
        recording={recorder.recording.has(id)}
        onRecord={() => void recorder.record(id, adds(id))}
        waits={takeWaits(id, {
          credits: credits !== null,
          waiting: recorder.waiting,
          take: Boolean(takes[id]),
          slot: slotWaiting.has(id),
        })}
        listed={listed}
        error={
          saveFailed
            ? saveFailedLine(saveFailed, voice.design?.generated ? 'eleven-design' : providerOf(id))
            : (recorder.errors[id] ?? null)
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-drop"
              disabled={act.isPending}
              onClick={() => move(id, 'drop')}
            >
              <CrossIcon /> Drop
            </button>
            {listed ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={act.isPending}
                  onClick={() => move(id, 'unlist')}
                >
                  Unlist
                </button>
                <button
                  type="button"
                  className={`btn${isCurrent ? '' : ' btn-primary'}`}
                  disabled={cast.isPending}
                  onClick={() => setAsking({ kind: 'cast', voice: id })}
                >
                  {saving
                    ? designed && !voice.design?.generated
                      ? 'Saving to your Fish account…'
                      : designed
                        ? 'Saving to your ElevenLabs voices…'
                        : 'Adding to your ElevenLabs voices…'
                    : designed
                      ? `Save and cast as ${name}`
                      : isCurrent
                        ? 'Keep this voice'
                        : `Cast as ${name}`}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-shortlist"
                disabled={act.isPending}
                onClick={() => move(id, 'shortlist')}
              >
                <CheckIcon /> Shortlist
              </button>
            )}
          </>
        }
      />
    )
  }

  // A failed add is shown by the meter (or bar) it was asked from.
  const creditsFailure =
    sittingActions.add.variables && 'credits' in sittingActions.add.variables
      ? sittingFailure(sittingActions.add.data)
      : undefined
  const ownState = ownSectionState(session, own)
  const designs = designGroups(session)
  const casting = asking?.kind === 'cast' ? asking.voice : null
  const keeping = casting !== null && casting === session.current
  const inLanguage =
    language && casting !== null
      ? castInLanguage(
          title(casting),
          name,
          languages,
          language.id,
          (view.recorded ?? []).map((a) => ({
            title: titles.get(a.part) ?? a.part,
            lines: a.lines,
          })),
        )
      : null
  const castingDesign = casting !== null && session.voices[casting]?.design !== undefined
  const castingLibrary = casting !== null ? session.voices[casting]?.library : undefined
  const castingAdds = Boolean(castingLibrary && !castingLibrary.added && !takes[casting!])

  return (
    <div className="board">
      <div className="board-bar">
        <span className="chips">
          <span className="chip chip-ok">{session.shortlist.length} shortlisted</span>
          <span className="chip">{session.toHear.length} to hear</span>
          {session.queue.length > 0 && (
            <span className="chip">{session.queue.length} more waiting</span>
          )}
          {session.dropped.length > 0 && (
            <span className="chip chip-danger">{session.dropped.length} dropped</span>
          )}
        </span>
        <span className="spacer" />
        <a
          className="btn btn-ghost"
          href={page}
          // A paused audition keeps no money: Resume asks again.
          onClick={() => (sitting || credits) && sittingActions.end.mutate()}
        >
          Pause
        </a>
        <button className="btn" type="button" onClick={() => setAsking({ kind: 'stop' })}>
          Stop audition…
        </button>
      </div>

      {money && ((paid && sitting) || credits) && (
        // The meters stay at the top as the board scrolls; the taller credits bar below does not.
        <div className="sitting-meters">
          {paid && sitting && (
            <SittingMeter
              model={money.model}
              money={sitting}
              waiting={waitingIn('fish')}
              suggested={money.suggested}
              busy={sittingActions.add.isPending}
              failure={
                sittingActions.add.variables && 'amount' in sittingActions.add.variables
                  ? sittingFailure(sittingActions.add.data)
                  : undefined
              }
              onAdd={(amount) => sittingActions.add.mutate({ amount })}
            />
          )}
          {credits && (
            <SittingMeter
              unit="credits"
              model={money.eleven.model}
              money={credits}
              waiting={waitingIn('elevenlabs')}
              suggested={money.eleven.suggested}
              busy={sittingActions.add.isPending}
              failure={creditsFailure}
              onAdd={(given) => sittingActions.add.mutate({ credits: given })}
            />
          )}
        </div>
      )}
      {money && !credits && wantCredits.length > 0 && (
        <CreditsAsk
          model={money.eleven.model}
          perTake={money.eleven.perTake}
          suggested={money.eleven.suggested}
          waiting={wantCredits.length}
          busy={sittingActions.add.isPending}
          failure={creditsFailure}
          onGive={(given) => sittingActions.add.mutate({ credits: given })}
        />
      )}
      {money && paid && !sitting && (
        // Reached without a sitting (the studio was closed meanwhile): it asks again.
        <SittingBox
          kind="resume"
          view={money}
          busy={sittingActions.resume.isPending}
          failure={sittingFailure(sittingActions.resume.data)}
          onPay={(amount) => sittingActions.resume.mutate(amount)}
          onCancel={() => {
            window.location.hash = page
          }}
        />
      )}

      {casting !== null && (
        // One per voice: asked about another voice, it opens (and comes into view) anew.
        <Confirm
          key={casting}
          title={
            language
              ? keeping
                ? `Keep ${title(casting)} as ${name}’s ${language.name} voice?`
                : inLanguage!.title
              : keeping
                ? `Keep ${title(casting)} as ${name}’s voice?`
                : `Cast ${title(casting)} as ${name}?`
          }
          effects={castEffects({
            name,
            current,
            replacing: !keeping,
            recorded: view.recorded ?? [],
            titles,
            dropped,
            unheard: session.toHear.length + session.queue.length,
            ...(language ? { language: language.name, stale: inLanguage?.stale } : {}),
            saves:
              castingDesign && session.voices[casting!]?.design?.generated
                ? 'elevenlabs'
                : castingDesign,
            adds: castingAdds,
          })}
          {...(language ? { back: 'Cancel' } : {})}
          onBack={() => setAsking(null)}
        >
          <button
            className="btn btn-primary"
            type="button"
            disabled={cast.isPending}
            onClick={() => cast.mutate(casting, { onSettled: () => setAsking(null) })}
          >
            {cast.isPending
              ? castingDesign
                ? session.voices[casting!]?.design?.generated
                  ? 'Saving to your ElevenLabs voices…'
                  : 'Saving to your Fish account…'
                : castingAdds
                  ? 'Adding to your ElevenLabs voices…'
                  : 'Casting…'
              : keeping
                ? 'Keep it'
                : castingDesign
                  ? `Save and cast as ${name}`
                  : `Cast ${title(casting)}`}
          </button>
        </Confirm>
      )}
      {asking?.kind === 'stop' && (
        <Confirm
          title="Stop without casting?"
          effects={stopEffectsFor(session, { name, lines, ruledOut: ruledIds })}
          onBack={() => setAsking(null)}
          note="To come back to it later instead, pause: the audition stays as it is."
        >
          <a className="btn" href={page}>
            Pause instead
          </a>
          <button
            className="btn btn-primary"
            type="button"
            disabled={act.isPending}
            onClick={() => run({ action: 'discard' })}
          >
            Stop audition
          </button>
        </Confirm>
      )}

      <section className="panel board-shortlist" aria-label="Shortlist">
        <div className="section-head">
          <h2 className="section-title">Shortlist</h2>
          <span className="muted">
            {session.shortlist.length
              ? 'Cast one of them; casting ends the audition.'
              : 'Shortlist the voices worth comparing, then cast one.'}
          </span>
        </div>
        {session.shortlist.length > 0 && (
          <div className="cards">{session.shortlist.map((id) => card(id, true))}</div>
        )}
      </section>

      {designs.length > 0 && (
        <section className="section" id="designed" aria-label={`Designed for ${name}`}>
          <div className="section-head">
            <h2 className="section-title">Designed for {name}</h2>
            <span className="muted">
              Not saved to your Fish account or ElevenLabs voices until you cast one.
            </span>
          </div>
          {designs.map((group) => (
            <div className="design-group" key={group.at}>
              <p className="design-group-heading" title={group.description}>
                {quoted(group.description)}
              </p>
              <div className="cards">{group.voices.map((id) => card(id, false))}</div>
            </div>
          ))}
        </section>
      )}

      <section className="section" aria-label="Your voices">
        <div className="section-head">
          <h2 className="section-title">Your voices</h2>
          {ownState !== 'none' && (
            <span className="muted">
              The voices on your own Fish account. They’re here whatever the keywords.
            </span>
          )}
        </div>
        {own.error && (
          <div className="own-error" role="alert">
            <span className="adopt-error">
              Fish didn’t send your own voices: {own.error.replace(/\.$/, '')}.
            </span>
            <button
              className="btn btn-small"
              type="button"
              disabled={own.pending}
              onClick={own.fetch}
            >
              Try again
            </button>
          </div>
        )}
        {ownState === 'loading' && <p className="muted">Getting your voices from Fish…</p>}
        {ownState === 'none' && (
          <p className="muted">
            No voices on your Fish account yet. Voices you clone or make on Fish show up here.
          </p>
        )}
        {ownState === 'allUsed' && (
          <p className="muted">All your voices are on the shortlist or ruled out for {name}.</p>
        )}
        {ownState === 'cards' && (
          <div className="cards">{session.yours.map((id) => card(id, false))}</div>
        )}
      </section>

      <section className="section" aria-label="To hear">
        <div className="section-head">
          <h2 className="section-title">To hear</h2>
          <span className="muted">
            Best match first. A dropped voice leaves the board and never comes back for {name}.
          </span>
        </div>
        {session.toHear.length > 0 ? (
          <div className="cards">{session.toHear.map((id) => card(id, false))}</div>
        ) : (
          <div className="empty-state">
            <strong>{session.heard ? 'No voices to hear' : 'No voices to hear yet'}</strong>
            {!session.heard && session.keywords.length === 0 ? (
              <span>
                {name} has no search keywords. Add some on <a href={page}>{name}’s page</a>, then
                stop this audition and start again; or bring in a specific voice or a design below.
              </span>
            ) : (
              <span>
                {session.heard
                  ? 'Bring in more voices matching the keywords, or a specific voice.'
                  : 'Choose where they come from below: the keywords in Fish Audio’s or ElevenLabs’ library, a specific voice, or a design.'}
              </span>
            )}
          </div>
        )}
      </section>

      {designing && (
        <DesignVoice
          characterId={characterId}
          language={language?.id}
          name={name}
          start={designStart}
          auditioning
          onClose={() => {
            setDesigning(false)
            refocusDesign()
          }}
          onDone={() => {
            setDesigning(false)
            refocusDesign()
            // The designs join the board when it is read again; bring the section into view then.
            setTimeout(() => document.getElementById('designed')?.scrollIntoView(), 300)
          }}
        />
      )}

      <div className="panel board-more">
        <span className="muted">Bring in more from</span>
        <div className="stage-switch" role="radiogroup" aria-label="Whose library">
          {(['fish', 'elevenlabs'] as const).map((library) => (
            <label key={library} className={from === library ? 'on' : ''}>
              <input
                type="radio"
                name={`more-from-${characterId}`}
                checked={from === library}
                onChange={() => setFrom(library)}
              />
              {library === 'fish' ? 'Fish Audio' : 'ElevenLabs'}
            </label>
          ))}
        </div>
        <button
          ref={moreButton}
          className="btn"
          type="button"
          disabled={act.isPending}
          onClick={() => {
            const none = session.keywords.length === 0
            setNoKeywords(none)
            if (none) return
            run({ action: 'more', body: { provider: from } }, () => setDroppedHere(null))
          }}
        >
          {searching
            ? `Searching ${searching === 'elevenlabs' ? 'ElevenLabs' : 'Fish Audio'}…`
            : 'Bring in more'}
        </button>
        <button
          ref={designButton}
          className="btn"
          type="button"
          disabled={designing}
          onClick={() => setDesigning(true)}
        >
          <SparkIcon /> Design a voice…
        </button>
        <span className="spacer" />
        <form className="add-voice" onSubmit={addById}>
          <label htmlFor="voice-id" className="muted">
            Bring in a specific voice
          </label>
          <select
            aria-label="Whose voice"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as VoiceProvider)
              setIdError(null)
            }}
          >
            <option value="fish">Fish Audio</option>
            <option value="elevenlabs">ElevenLabs</option>
          </select>
          <input
            id="voice-id"
            className="search"
            placeholder={provider === 'fish' ? 'Fish voice id or URL' : 'ElevenLabs voice id'}
            value={voiceId}
            onChange={(e) => {
              setVoiceId(e.target.value)
              setIdError(null)
            }}
          />
          <button className="btn" type="submit" disabled={!voiceId.trim() || act.isPending}>
            Bring in
          </button>
        </form>
        {idError && <span className="adopt-error">{idError}</span>}
        {noKeywords && (
          <span className="adopt-error">
            {name} has no search keywords. Add some on <a href={page}>{name}’s page</a>, then stop
            this audition and start again.
          </span>
        )}
        {showsSlots && (
          <VoiceSlots
            slots={slots}
            unread={account.isError && account.data ? account.error.message : undefined}
            onRetry={() => void account.refetch()}
          />
        )}
        <Failure title="The audition could not go on" result={act.data} />
        <Failure
          title="The voice could not be cast"
          result={
            cast.data && 'reason' in cast.data && cast.data.reason === 'save'
              ? undefined
              : cast.data
          }
        />
        {(act.isError || cast.isError) && (
          <span className="adopt-error">{(act.error ?? cast.error)?.message}</span>
        )}
      </div>

      {undoable && (
        <div className="toast" role="status">
          <span>
            Dropped <strong>{title(undoable)}</strong>.
            {isRuledOut(undoable, ruledIds, session.current)
              ? ` It won’t come back for ${name}.`
              : ''}
          </span>
          <button
            className="btn btn-small"
            type="button"
            disabled={act.isPending}
            onClick={() => run({ action: 'undo' }, () => setDroppedHere(null))}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}
