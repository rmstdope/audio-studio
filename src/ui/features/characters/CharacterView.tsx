import { useEffect, useRef, useState } from 'react'
import type { AuditionSession } from '../../../core/audition'
import { designStart } from '../../../core/design'
import { FREE_MODELS } from '../../../core/project'
import type { SittingView } from '../../../core/sitting'
import { usd } from '../../../core/spend'
import {
  sharesVoiceWith,
  type CharacterLanguage,
  type CharacterSummary,
  type ProjectSummary,
} from '../../../core/summary'
import {
  castTab,
  isMultilingual,
  languageShown,
  nameOf,
  queryLanguage,
  noVoiceText,
  otherVoices,
  speedInLanguage,
  startBlocked,
  type Language,
} from '../../castLanguages'
import { LanguageSwitch } from '../lines/LanguageSwitch'
import {
  clipUrl,
  takeUrl,
  useAuditionsGoingOn,
  useCharacterVoice,
  useOtherVoiceTitles,
  usePart,
  useParts,
  useRuledOut,
  useSession,
  useSessionAction,
  useSitting,
  useSittingActions,
  useTakes,
  type Voiced,
} from '../../api'
import { sampleClip, stopEffectsFor, takeClip } from '../../board'
import { Confirm } from '../../components/Confirm'
import { Failure } from '../../components/Failure'
import { AlertIcon, HeadphonesIcon, PauseIcon, PlayIcon, SparkIcon } from '../../components/icons'
import { Problems } from '../../components/Problems'
import { StatusBar } from '../../components/StatusBar'
import { useClipPlayer } from '../../components/useClipPlayer'
import { compact, plural, separatorBefore, shortTitle, tintFor, voiceLabel } from '../../format'
import { routeHref } from '../../route'
import { inGameState, recordedLinesOf } from '../../inGame'
import type { Clip } from '../../player'
import { partLinesSummary, speakerCounts, STATUS } from '../../status'
import { isAbout, takeToRecord } from '../../takes'
import { needsResumeBox } from '../../sitting'
import { providerWords, voiceUrl } from '../../voiceId'
import { providerOf } from '../../../core/voices'
import { speedProblem } from '../../../core/elevenSpeech'
import { DesignVoice } from '../audition/DesignVoice'
import { RuledOutPanel } from '../audition/RuledOutPanel'
import { SittingBox, sittingFailure } from '../audition/SittingBox'
import { useFocusWhenClosed } from '../../components/useFocusWhenClosed'
import { CloneVoice } from './CloneVoice'
import { KeywordsEditor, PhraseEditor, SpeedEditor, StyleEditor } from './BriefEditors'

/**
 * A character's page, the one place about it: its cast voice (Fish's details, its take and
 * sample), its lines per part, its delivery and casting brief, the voices ruled out for it, and
 * its audition: started, resumed or stopped from here.
 */
export function CharacterView({
  summary,
  characterId,
  asked,
}: {
  summary: ProjectSummary
  characterId: string
  /** The language the address names, if any. */
  asked?: string
}) {
  const character = summary.characters.find((c) => c.id === characterId)
  const several = isMultilingual(summary.languages)
  const language = languageShown(summary.languages, asked)
  const languageName = nameOf(summary.languages, language)
  const casting = character?.languages[language]
  // Every hook of the page and its panels asks with the same language, or none in a project with one.
  const queried = queryLanguage(summary.languages, asked)
  const session = useSession(characterId, Boolean(character), queried)
  const voice = useCharacterVoice(characterId, casting?.voice ?? null, Boolean(character), queried)
  const start = useSessionAction(characterId, queried)
  const going = useAuditionsGoingOn(
    characterId,
    summary.languages.map((l) => l.id),
    Boolean(character) && several,
  )
  const sittingQuery = useSitting(characterId, Boolean(character), queried)
  const sittingActions = useSittingActions(characterId, queried)
  // Which question is open: starting an audition on a paid model, or carrying one on.
  const [asking, setAsking] = useState<'start' | 'resume' | null>(null)
  const [designing, setDesigning] = useState(false)
  const designButton = useRef<HTMLButtonElement>(null)
  const refocusDesign = useFocusWhenClosed(designing, designButton)
  const player = useClipPlayer()
  const { playing, toggle } = player
  const appearances = casting?.appearances ?? []
  // Her lines in this language, to pick an audition phrase from.
  const loadedParts = useParts(
    appearances.map((a) => a.part),
    queried,
  )
  const lineTexts = [
    ...new Set(
      loadedParts.flatMap((query) =>
        query.data?.ok
          ? query.data.part.lines
              .filter((l) => l.speaker === characterId && l.text)
              .map((l) => l.text)
          : [],
      ),
    ),
  ]

  if (!character) {
    return (
      <div className="empty-state">
        <strong>No character called “{characterId}”</strong>
        <a
          className="btn"
          href={routeHref({ view: 'characters', ...(queried ? { language: queried } : {}) })}
          style={{ alignSelf: 'center' }}
        >
          All characters
        </a>
      </div>
    )
  }

  const titles = new Map(summary.parts.map((p) => [p.id, shortTitle(p.title)]))
  const view = session.data?.ok ? session.data : null
  const inProgress = view?.session ?? null
  // An answer about the voice cast now: one about an earlier voice is not shown.
  const answer = voice.data?.ok && isAbout(voice.data, casting?.voice ?? null) ? voice.data : null
  const audition = routeHref({
    view: 'audition',
    character: character.id,
    ...(several ? { language } : {}),
  })
  const blocked = answer ? startBlocked(answer.audition, languageName) : null
  const inLanguage: Language | null = several ? { id: language, name: languageName } : null
  const money = sittingQuery.data?.ok ? sittingQuery.data : null
  /** Starts the audition, after asking what it may spend when its model is paid. */
  const beginAudition = () =>
    money?.paid
      ? setAsking('start')
      : start.mutate(
          { action: 'start' },
          { onSuccess: (result) => result.ok && (window.location.hash = audition) },
        )

  return (
    <>
      <header className="page-header">
        <div className="audition-who">
          <div className="avatar" style={tintFor(character.id)} aria-hidden="true">
            {character.name.charAt(0)}
          </div>
          <div>
            <span className="crumbs">
              <a
                href={routeHref({ view: 'characters', ...(queried ? { language: queried } : {}) })}
              >
                Characters
              </a>{' '}
              / {character.name}
            </span>
            <h1>{character.name}</h1>
            <span className="muted">
              {appearances.length
                ? `${plural(casting?.totalLines ?? 0, 'line')} in ${plural(appearances.length, summary.partLabel.toLowerCase())}`
                : 'No lines yet'}{' '}
              · {several ? 'one voice per language in every' : 'one voice in every'}{' '}
              {summary.partLabel.toLowerCase()}
            </span>
          </div>
        </div>
        {several && (
          <LanguageSwitch
            tabs={summary.languages.map((l) => {
              const tab = castTab(character, l, going[l.id] ?? false)
              return {
                id: l.id,
                name: l.name,
                count: going[l.id] === null ? null : tab.count,
                title: tab.title,
                dimmed: tab.dimmed,
              }
            })}
            active={language}
            onChoose={(id) => {
              window.location.hash = routeHref({
                view: 'character',
                character: character.id,
                language: id,
              })
            }}
          />
        )}
        <div className="header-actions">
          <button
            ref={designButton}
            className="btn"
            type="button"
            // Only once it is known whether an audition is going on: paying starts one if not.
            disabled={!view || designing || blocked !== null}
            title={blocked ?? undefined}
            onClick={() => setDesigning(true)}
          >
            <SparkIcon /> Design a voice…
          </button>
          {inProgress ? (
            // On a paid model, with no money left in this sitting, Resume asks for more first.
            needsResumeBox(money) ? (
              <button className="btn btn-primary" type="button" onClick={() => setAsking('resume')}>
                <HeadphonesIcon /> Resume…
              </button>
            ) : (
              <a className="btn btn-primary" href={audition}>
                <HeadphonesIcon /> Resume audition
              </a>
            )
          ) : (
            // Only once it is known that no audition is going on: starting would replace one.
            view && (
              <button
                className="btn btn-primary"
                type="button"
                // While the audition is read again, one may have been started elsewhere.
                disabled={
                  start.isPending ||
                  session.isFetching ||
                  sittingQuery.isPending ||
                  blocked !== null
                }
                title={blocked ?? undefined}
                onClick={beginAudition}
              >
                <HeadphonesIcon /> {start.isPending ? 'Starting…' : 'Start audition'}
              </button>
            )
          )}
        </div>
      </header>
      {designing && (
        <DesignVoice
          characterId={character.id}
          language={queried}
          name={character.name}
          start={designStart(character.keywords, character.style)}
          auditioning={inProgress !== null}
          onClose={() => {
            setDesigning(false)
            refocusDesign()
          }}
          onDone={() => {
            setDesigning(false)
            // The designs are in the audition going on; with none, paying starts one.
            if (inProgress) window.location.hash = audition
            else beginAudition()
          }}
        />
      )}
      {session.isError && (
        <span className="adopt-error">Could not read the audition: {session.error.message}</span>
      )}
      {session.data && !session.data.ok && 'problems' in session.data && (
        <Problems title="The audition could not be read" problems={session.data.problems} />
      )}
      {money && asking && (
        <SittingBox
          kind={asking}
          view={money}
          busy={start.isPending || sittingActions.resume.isPending}
          failure={
            asking === 'start'
              ? start.data && !start.data.ok && 'message' in start.data
                ? start.data.message
                : undefined
              : sittingFailure(sittingActions.resume.data)
          }
          onPay={(amount) =>
            asking === 'start'
              ? start.mutate(
                  { action: 'start', body: { spendUpTo: amount } },
                  { onSuccess: (result) => result.ok && (window.location.hash = audition) },
                )
              : sittingActions.resume.mutate(amount, {
                  onSuccess: (answer) => answer.ok && (window.location.hash = audition),
                })
          }
          onCancel={() => setAsking(null)}
        />
      )}
      <Failure title="The audition could not start" result={asking ? undefined : start.data} />
      {start.isError && <span className="adopt-error">{start.error.message}</span>}
      {voice.isError && (
        <span className="adopt-error">Could not load the voice: {voice.error.message}</span>
      )}
      {voice.data && !voice.data.ok && 'problems' in voice.data && (
        <Problems title="The cast could not be read" problems={voice.data.problems} />
      )}

      <div className="audition">
        <div className="audition-main">
          <VoicePanel
            character={character}
            casting={casting}
            languages={summary.languages}
            language={inLanguage}
            answer={answer}
            playing={playing}
            toggle={toggle}
            sharedWith={sharesVoiceWith(
              summary.characters,
              character.id,
              several ? language : undefined,
            )}
            paidModel={money?.paid ? money.model : null}
            parts={appearances.map((a) => ({
              id: a.part,
              title: titles.get(a.part) ?? a.part,
            }))}
            inProgress={inProgress}
            sessionKnown={view !== null && !session.isFetching}
          />
          <section className="panel character-lines" aria-label="Lines">
            <div className="section-head">
              <h2 className="section-title">Lines</h2>
              {inLanguage && <span className="muted">in {languageName}</span>}
            </div>
            {listedParts(character, summary.languages, summary.parts).length ? (
              listedParts(character, summary.languages, summary.parts).map((part) => {
                const lines = appearances.find((a) => a.part === part)?.lines ?? 0
                return lines ? (
                  <PartLines
                    key={part}
                    partId={part}
                    title={titles.get(part) ?? part}
                    speaker={character.id}
                    lines={lines}
                    language={inLanguage ? language : undefined}
                  />
                ) : (
                  <div key={part} className="part-lines">
                    <strong>{titles.get(part) ?? part}</strong>
                    <span className="muted">no {languageName} dialog yet</span>
                  </div>
                )
              })
            ) : (
              <span className="muted">
                {character.name} has no lines in any {summary.partLabel.toLowerCase()} yet.
              </span>
            )}
          </section>
          {appearances.length > 0 && (
            <InTheGame
              speaker={character.id}
              name={character.name}
              parts={appearances.map((a) => ({
                id: a.part,
                title: titles.get(a.part) ?? a.part,
              }))}
              language={inLanguage?.id}
              player={player}
            />
          )}
        </div>

        <aside className="audition-brief">
          {inProgress && (
            <InProgress
              characterId={character.id}
              name={character.name}
              lines={casting?.totalLines ?? 0}
              session={inProgress}
              href={audition}
              language={inLanguage}
              money={money}
              onResume={() => setAsking('resume')}
            />
          )}
          <section className="panel brief-panel" aria-label="Delivery">
            {inLanguage && <span className="label">Delivery</span>}
            <StyleEditor characterId={character.id} style={character.style} />
            {inLanguage && <span className="muted brief-hint">The same in every language.</span>}
            {(() => {
              const speed = speedInLanguage(character, summary.languages, language, summary.speed)
              return (
                <SpeedEditor
                  characterId={character.id}
                  speed={inLanguage ? (casting?.speed ?? null) : character.speed}
                  projectSpeed={summary.speed}
                  language={inLanguage ? language : undefined}
                  label={inLanguage ? speed.label : undefined}
                  beneath={inLanguage ? speed.others : undefined}
                />
              )
            })()}
            {(() => {
              // ElevenLabs takes a narrower range of speeds than the editor allows: say so.
              const voice = casting?.voice ?? null
              const own = inLanguage ? (casting?.speed ?? null) : character.speed
              const slow =
                voice && providerOf(voice) === 'elevenlabs'
                  ? speedProblem(own ?? summary.speed)
                  : null
              return (
                slow && (
                  <p className="status-note">
                    <AlertIcon />
                    <span>{slow}</span>
                  </p>
                )
              )
            })()}
          </section>
          <section className="panel brief-panel" aria-label="Casting brief">
            {inLanguage && <span className="label">Casting brief · {languageName}</span>}
            <KeywordsEditor
              characterId={character.id}
              keywords={character.keywords}
              note={
                inLanguage
                  ? `The same in every language; the search looks only at ${languageName} voices.`
                  : undefined
              }
            />
            {answer && (
              <PhraseEditor
                key={language}
                characterId={character.id}
                characterName={character.name}
                audition={answer.audition}
                language={inLanguage?.id}
                languageName={inLanguage?.name}
                lines={lineTexts}
              />
            )}
            {answer && (
              <div className="brief-item">
                <span className="label">Language</span>
                <span className="mono">{answer.language}</span>
              </div>
            )}
          </section>
          <section className="panel brief-panel" aria-label="Ruled out">
            <RuledOutPanel
              characterId={character.id}
              name={character.name}
              language={inLanguage?.id}
              languageName={inLanguage?.name}
            />
          </section>
        </aside>
      </div>
    </>
  )
}

/**
 * The cast voice: Fish's details of it, its take of the audition phrase (recorded by itself if
 * missing, as the audition model is free) and Fish's sample, its id and its page on Fish.
 */
function VoicePanel({
  character,
  casting,
  languages,
  language,
  answer,
  playing,
  toggle,
  sharedWith,
  paidModel,
  parts,
  inProgress,
  sessionKnown,
}: {
  character: CharacterSummary
  /** Her casting in the language shown. */
  casting: CharacterLanguage | undefined
  languages: Language[]
  /** The language shown, in a project with several; null in a project with one. */
  language: Language | null
  /** What the server says about the voice cast now; null until it has. */
  answer: Voiced | null
  playing: string | null
  toggle: (id: string, url: string) => void
  /** The other characters cast with this voice. */
  sharedWith: CharacterSummary[]
  /** The audition model when it is a paid one: the cast voice's take is on the free model all the same. */
  paidModel: string | null
  /** The character's parts, for what casting a cloned voice makes stale. */
  parts: { id: string; title: string }[]
  /** The audition going on, if any. */
  inProgress: AuditionSession | null
  /** Whether the audition has been read: only then is it known whether one is going on. */
  sessionKnown: boolean
}) {
  const recorder = useTakes(character.id, false, language?.id)
  const id = casting?.voice ?? null
  // Without a voice here, her other voices are named as Fish names them.
  const others = !id && language ? otherVoices(character, languages, language.id) : []
  const titles = useOtherVoiceTitles(
    character.id,
    others.map((v) => ({ id: v.id, language: v.first })),
  )
  // The take is asked for once per phrase, so one the page cannot show is not asked again.
  const asked = useRef(new Set<string>())
  const wanted = answer ? takeToRecord(answer, id) : null
  const { record } = recorder
  useEffect(() => {
    if (!wanted || !id || asked.current.has(wanted)) return
    asked.current.add(wanted)
    void record(id)
  }, [wanted, id, record])

  const clone = (
    <CloneVoice
      characterId={character.id}
      name={character.name}
      language={language?.id}
      languageName={language?.name}
      languages={languages}
      currentTitle={
        id
          ? answer?.voice?.title || voiceLabel({ voice: id, voiceName: casting?.voiceName ?? null })
          : null
      }
      parts={parts}
      inProgress={inProgress}
      sessionKnown={sessionKnown}
      playing={playing}
      toggle={toggle}
    />
  )
  if (!id) {
    return (
      <section className="panel voice-panel" aria-label="Voice">
        <span className="label">Voice{language ? ` · ${language.name}` : ''}</span>
        <strong>{language ? `No ${language.name} voice yet` : 'No voice yet'}</strong>
        <span className="muted">
          {language
            ? noVoiceText(character, languages, language.id, titles)
            : `Start an audition to find one, or clone one from recordings you have. Until then ${character.name}’s lines cannot be recorded.`}
        </span>
        {clone}
      </section>
    )
  }
  const voice = answer?.voice ?? null
  const sample = voice?.sample ?? null
  const take = answer?.take ?? null
  const page = voiceUrl(id)
  // An ElevenLabs voice makes no takes yet (§12 step 14.10); ElevenLabs' preview is how it is heard.
  const eleven = providerOf(id) === 'elevenlabs'
  const words = providerWords(id)
  return (
    <section className="panel voice-panel" aria-label="Voice">
      <div className="section-head">
        <span className="label">Voice{language ? ` · ${language.name}` : ''}</span>
        <span className="chip chip-ok">Cast</span>
      </div>
      <div className="voice-name">
        <strong>
          {voice?.title || voiceLabel({ voice: id, voiceName: casting?.voiceName ?? null })}
        </strong>
        {voice && (
          <span className="muted">
            {eleven ? (
              'ElevenLabs voice'
            ) : (
              <>
                {voice.author ? `by ${voice.author} · ` : ''}
                {compact(voice.uses)} uses · {compact(voice.likes)} likes
              </>
            )}
          </span>
        )}
      </div>
      {voice?.description && <p className="voice-description">{voice.description}</p>}
      {voice && voice.tags.length > 0 && (
        <div className="chips">
          {voice.tags.slice(0, 8).map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </div>
      )}
      {answer?.lookup && (
        <span className="muted">
          {words.name} could not give this voice’s details: {answer.lookup.message}
        </span>
      )}
      {sharedWith.length > 0 && (
        <p className="status-note shared-voice">
          <AlertIcon />
          <span>
            Also the {language ? `${language.name} ` : ''}voice of{' '}
            {sharedWith.map((other, i) => (
              <span key={other.id}>
                {separatorBefore(i, sharedWith.length)}
                <a
                  href={routeHref({
                    view: 'character',
                    character: other.id,
                    ...(language ? { language: language.id } : {}),
                  })}
                >
                  {other.name}
                </a>
              </span>
            ))}
            . Characters in one voice are hard to tell apart in a scene.
          </span>
        </p>
      )}
      <div className="voice-listen">
        {eleven ? (
          <div className="listen-box">
            <span className="muted">No takes with ElevenLabs voices yet: hear its preview.</span>
          </div>
        ) : (
          <div className="listen-box">
            {take ? (
              <button
                type="button"
                className="icon-btn take-play"
                aria-label={playing === takeClip(id) ? 'Stop' : 'Play the take'}
                onClick={() => toggle(takeClip(id), takeUrl(take))}
              >
                {playing === takeClip(id) ? <PauseIcon /> : <PlayIcon />}
              </button>
            ) : (
              <button
                className="btn btn-small"
                type="button"
                disabled={
                  recorder.recording.has(id) || !answer || answer.lookup?.reason === 'no-key'
                }
                onClick={() => void record(id)}
              >
                {recorder.recording.has(id) ? 'Recording…' : 'Record'}
              </button>
            )}
            <span>
              <strong>Take {paidModel && <span className="chip">free model</span>}</strong>
              <span className="muted">The audition phrase, in {character.name}’s style</span>
              {paidModel && (
                <span className="muted">
                  Recorded with {FREE_MODELS[0]}. Auditions use {paidModel}.
                </span>
              )}
            </span>
          </div>
        )}
        <div className="listen-box">
          {sample && (
            <button
              type="button"
              className="icon-btn"
              aria-label={playing === sampleClip(id) ? 'Stop' : words.play}
              onClick={() => toggle(sampleClip(id), sample.audio)}
            >
              {playing === sampleClip(id) ? <PauseIcon /> : <PlayIcon />}
            </button>
          )}
          <span>
            <strong>{words.sample}</strong>
            <span className="muted sample-text" title={sample?.text}>
              {!answer
                ? '…'
                : sample
                  ? sample.text
                    ? `“${sample.text}”`
                    : words.ownClip
                  : words.none}
            </span>
          </span>
        </div>
        {clone}
      </div>
      {recorder.errors[id] && <span className="adopt-error">{recorder.errors[id]}</span>}
      <div className="voice-foot">
        <span className="mono muted voice-id">{id}</span>
        {page && (
          <a href={page} target="_blank" rel="noreferrer">
            Open on Fish Audio ↗
          </a>
        )}
      </div>
    </section>
  )
}

/**
 * The character's recorded lines, as the game plays them: each with its part and cue, played one
 * by one or all in turn, the first few shown until asked for all.
 */
function InTheGame({
  speaker,
  name,
  parts,
  language,
  player,
}: {
  speaker: string
  name: string
  parts: { id: string; title: string }[]
  /** The language whose recorded lines are heard; left out in a project with one. */
  language?: string
  player: ReturnType<typeof useClipPlayer>
}) {
  const loaded = useParts(
    parts.map((p) => p.id),
    language,
  )
  const [all, setAll] = useState(false)
  const listed = parts.map((p, i) => {
    const query = loaded[i]
    const data = query?.data
    const state = data?.ok ? 'loaded' : query?.isPending ? 'pending' : 'failed'
    return { ...p, state, lines: data?.ok ? data.part.lines : null } as const
  })
  const lines = recordedLinesOf(listed, speaker)
  const view = inGameState(listed, lines, all)
  const clips: Clip[] = lines.map((l) => ({ id: l.id, url: clipUrl(l.part, l.file, language) }))
  return (
    <section className="panel in-game" aria-label="Hear it in the game">
      <div className="section-head">
        <h2 className="section-title">Hear it in the game</h2>
        <span className="muted">
          {lines.length > 0 && `${plural(lines.length, 'recorded line')}, as the game plays them`}
          {lines.length > 0 && view.loading && ' · '}
          {view.loading}
          {view.empty && `None of ${name}’s lines is recorded yet.`}
        </span>
      </div>
      {view.failed.length > 0 && (
        <span className="adopt-error">
          Could not load the lines of{' '}
          {view.failed.map((p, i) => (
            <span key={p.id}>
              {i > 0 && (i === view.failed.length - 1 ? ' and ' : ', ')}
              <a href={routeHref({ view: 'lines', part: p.id, ...(language ? { language } : {}) })}>
                {p.title}
              </a>
            </span>
          ))}
          ; they are left out here. Open {view.failed.length === 1 ? 'it' : 'them'} to see why.
        </span>
      )}
      {view.shown.length > 0 && (
        <ol className="in-game-lines">
          {view.shown.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className="icon-btn"
                aria-label={player.playing === l.id ? 'Stop' : `Play “${l.text}”`}
                onClick={() => player.toggle(l.id, clipUrl(l.part, l.file, language))}
              >
                {player.playing === l.id ? <PauseIcon /> : <PlayIcon />}
              </button>
              <span className="in-game-text">
                <span>{l.text}</span>
                <span className="muted mono">
                  {l.title}
                  {l.cue ? ` · ${l.cue}` : ''}
                </span>
              </span>
              <span
                className="badge"
                style={{ color: STATUS[l.status].color, background: STATUS[l.status].bg }}
              >
                {STATUS[l.status].label}
              </span>
            </li>
          ))}
        </ol>
      )}
      {lines.length > 0 && (
        <div className="in-game-actions">
          {(view.more > 0 || all) && (
            <button className="btn btn-ghost" type="button" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `All ${lines.length} lines`}
            </button>
          )}
          <button
            className="btn"
            type="button"
            disabled={!player.inTurn && !view.canPlayAll}
            onClick={() => {
              if (player.inTurn) return player.stop()
              // Every line shows while they play, and stays shown after.
              setAll(true)
              player.playInTurn(clips)
            }}
          >
            {player.inTurn ? 'Stop' : 'Play all in turn'}
          </button>
        </div>
      )}
    </section>
  )
}

/** One part's lines of the character: how many, how they stand, and a link to the part's lines. */
function PartLines({
  partId,
  title,
  speaker,
  lines,
  language,
}: {
  partId: string
  title: string
  speaker: string
  lines: number
  language?: string
}) {
  const part = usePart(partId, true, language)
  const loaded = part.data?.ok ? part.data.part : null
  const counts = loaded ? speakerCounts(loaded.lines, speaker) : null
  return (
    <a
      className="part-lines"
      href={routeHref({ view: 'lines', part: partId, ...(language ? { language } : {}) })}
    >
      <strong>{title}</strong>
      {counts ? <StatusBar counts={counts} height={6} /> : <span className="muted">…</span>}
      <span className="muted">
        {plural(lines, 'line')}
        {counts ? ` · ${partLinesSummary(counts)}` : ''}
      </span>
    </a>
  )
}

/** The audition in progress: how far it got, Resume, and Stop after saying what it means. */
function InProgress({
  characterId,
  name,
  lines,
  session,
  href,
  language,
  money,
  onResume,
}: {
  characterId: string
  name: string
  lines: number
  session: AuditionSession
  href: string
  language: Language | null
  /** The audition's money, once known. */
  money: SittingView | null
  /** Opens the box that asks what the audition may spend as it goes on. */
  onResume: () => void
}) {
  const act = useSessionAction(characterId, language?.id)
  const ruledOut = useRuledOut(characterId, language?.id)
  const [asking, setAsking] = useState(false)
  const ruledIds = ruledOut.data?.ok ? ruledOut.data.voices.map((v) => v.id) : null
  return (
    <section className="panel in-progress" aria-label="Audition in progress">
      <span className="label">Audition in progress</span>
      <span>
        {plural(session.shortlist.length, 'voice')} shortlisted, {session.toHear.length} to hear.
      </span>
      {money?.paid && (
        <span className="muted">
          {usd(money.spentBefore)} spent so far · {money.model}
        </span>
      )}
      {asking ? (
        <Confirm
          title="Stop without casting?"
          effects={stopEffectsFor(session, { name, lines, ruledOut: ruledIds })}
          back="Keep it"
          onBack={() => setAsking(false)}
        >
          <button
            className="btn btn-primary"
            type="button"
            disabled={act.isPending}
            onClick={() => act.mutate({ action: 'discard' })}
          >
            Stop audition
          </button>
        </Confirm>
      ) : (
        <div className="confirm-actions">
          <button className="btn btn-ghost" type="button" onClick={() => setAsking(true)}>
            Stop…
          </button>
          {needsResumeBox(money) ? (
            <button className="btn btn-primary" type="button" onClick={onResume}>
              Resume…
            </button>
          ) : (
            <a className="btn btn-primary" href={href}>
              Resume
            </a>
          )}
        </div>
      )}
      <Failure title="The audition could not be stopped" result={act.data} />
      {act.isError && <span className="adopt-error">{act.error.message}</span>}
    </section>
  )
}

/**
 * The parts to list under Lines: those she speaks in, in any language, in the project's order, so
 * a language without lines in one says so.
 */
function listedParts(
  character: CharacterSummary,
  languages: Language[],
  parts: { id: string }[],
): string[] {
  const spoken = new Set(
    languages.flatMap((l) => character.languages[l.id]?.appearances.map((a) => a.part) ?? []),
  )
  return parts.map((p) => p.id).filter((part) => spoken.has(part))
}
