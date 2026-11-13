import { dirname } from 'node:path'
import { characterVoice, setPronunciations } from '../../services/auditions'
import { providerOf, VOICE_ID } from '../../core/voices'
import { type ElevenLabsClient } from '../../services/elevenlabs'
import { isPaid } from '../../core/sitting'
import { createBudget, spendProblem } from '../../core/spend'
import { readSpending } from '../../services/spending'
import { outcomeOf, summariseSpending } from '../../core/spending'
import { moveCue, moveSceneCue, setCue, setInsideCue, setSceneCue } from '../../services/cues'
import { isRefreshing, refreshDialog } from '../../services/refresh'
import { acceptLine, measureLine, recordLine, removeOrphans } from '../../services/narration'
import { setElevenSettings } from '../../services/models'
import { setSoundAlike } from '../../services/soundAlike'
import { recordTake, takeFile, tryLine } from '../../services/takes'
import { setNote } from '../../services/notes'
import {
  dropLineTake,
  lineTakeFile,
  listLineTakes,
  takeLine,
  useLineTake,
} from '../../services/lineTakes'
import { cloneVoice } from '../../services/cloneVoice'
import { DESIGN_MODEL, DESIGN_PRICE, isDesignId } from '../../core/design'
import {
  castDesign,
  designElevenVoices,
  designVoices,
  designsFor,
  elevenDesignFor,
} from '../../services/designs'
import { ELEVEN_DESIGN_MODEL, elevenDescriptionState } from '../../core/elevenDesign'
import { allowVoices, ruledOutVoices } from '../../services/ruledOut'
import {
  addVoiceById,
  auditionMoney,
  boardVoice,
  castOwnVoice,
  castVoice,
  discardSession,
  moreVoices,
  moveVoice,
  recordSpent,
  refreshOwnVoices,
  sessionFor,
  startAudition,
  undoLastDrop,
  viewOf,
  voiceAdded,
  voicesInUse,
  voicesRemoved,
} from '../../services/sessions'
import { freeVoices, readAddedVoices, voiceToSpeak } from '../../services/elevenVoices'
import { freeableVoices } from '../../core/elevenLibrary'
import { heardFor } from '../../services/heard'
import {
  adoptPart,
  clipFile,
  loadPart,
  loadProject,
  narrationProgress,
  openProject,
} from '../../services/workspace'
import type { RouteContext } from '../context'
import {
  type Given,
  AddBody,
  AmountBody,
  AuditionTakeBody,
  CastOwnBody,
  CharacterBody,
  CueBody,
  DesignBody,
  ElevenTtsBody,
  FreeBody,
  InsideCueBody,
  JobBody,
  MoreBody,
  MoveBody,
  MoveCueBody,
  MoveSceneCueBody,
  NoteBody,
  PronounceBody,
  RecordBody,
  SceneCueBody,
  SoundAlikeBody,
  StartBody,
  TakeLineBody,
  TryBody,
  VoiceBody,
  languageOf,
  fileResponse,
  notFound,
  parseOrNull,
} from '../shared'

/** The narration routes. */
export function narrationRoutes(c: RouteContext) {
  const {
    admit,
    admitBoth,
    admitCredits,
    answer,
    budgets,
    busyRefusal,
    changeCharacter,
    creditBudgets,
    creditOf,
    creditSittings,
    creditsInFlight,
    elevenFor,
    elevenHeld,
    elevenWork,
    encode,
    endGiven,
    endSitting,
    fishFor,
    fishWork,
    flightIn,
    freshSitting,
    fromOwnPage,
    guard,
    holdCredits,
    inFlight,
    jobs,
    languageFor,
    loggedOne,
    planFor,
    projectFile,
    reserved,
    ruledOut,
    saveToAccount,
    shownAccount,
    forgetShownAccount,
    sittingAnswer,
    sittingKey,
    sittings,
    spendLog,
    transcriberFor,
    unknownUse,
    whileGoing,
  } = c
  return {
    '/api/narration/progress': {
      GET: guard(async (request) =>
        Response.json(await narrationProgress(projectFile, languageOf(request))),
      ),
    },
    '/api/parts/:part': {
      GET: guard(async (request) => {
        const result = await loadPart(projectFile, request.params.part, languageOf(request))
        return result ? Response.json(result) : notFound()
      }),
    },
    '/api/parts/:part/adopt': {
      POST: fromOwnPage(async (request) => {
        const result = await adoptPart(
          projectFile,
          request.params.part,
          new Date(),
          languageOf(request),
        )
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/parts/:part/lines/:key/heard': {
      GET: guard(async (request) => {
        const result = await heardFor(
          projectFile,
          request.params.part,
          request.params.key,
          languageOf(request),
        )
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/parts/:part/lines/:key/note': {
      PATCH: fromOwnPage(async (request) => {
        const body = NoteBody.safeParse(await request.json().catch(() => null))
        if (!body.success) return Response.json({ error: 'expected { note }' }, { status: 400 })
        const { part, key } = request.params
        const result = await setNote(projectFile, part, key, body.data.note, languageOf(request))
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/parts/:part/lines/:key/check': {
      POST: fromOwnPage(async (request) => {
        const { part, key } = request.params
        const transcriber = await transcriberFor()
        const result = await measureLine(projectFile, part, key, {
          transcriber,
          again: true,
          language: languageOf(request),
        })
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/parts/:part/lines/:key/accept': {
      POST: fromOwnPage(async (request) => {
        const result = await acceptLine(
          projectFile,
          request.params.part,
          request.params.key,
          languageOf(request),
        )
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/parts/:part/lines/:key/record': {
      POST: fromOwnPage(async (request) => {
        const { part, key } = request.params
        const text = await request.text()
        const body = RecordBody.safeParse(parseOrNull(text || '{}'))
        if (!body.success) {
          return Response.json({ error: 'expected { confirmedCost?, stage? }' }, { status: 400 })
        }
        // Fails closed: without a plan, nothing is priced, so nothing is recorded.
        const planned = await planFor(part, undefined, true, body.data.stage, languageOf(request))
        if (!planned) return notFound()
        if (!planned.ok) return Response.json(planned, { status: 409 })
        const admitted = await admitBoth(planned, [key], body.data)
        if ('problem' in admitted) {
          return Response.json({ ok: false, ...admitted.problem }, { status: 409 })
        }
        try {
          const result = await whileGoing('part', part, () =>
            loggedOne(planned, part, admitted, async () =>
              recordLine(projectFile, part, key, fishFor, {
                encode,
                limiter: fishWork,
                elevenLimiter: elevenWork,
                elevenlabs: elevenFor,
                transcriber: await transcriberFor(),
                stage: body.data.stage,
                budget: admitted.budget,
                credits: admitted.credits,
                language: languageOf(request),
              }),
            ),
          )
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        } finally {
          admitted.release()
        }
      }),
    },
    '/api/parts/:part/plan': {
      GET: guard(async (request) => {
        const query = new URL(request.url).searchParams
        const speaker = query.get('speaker') || undefined
        const stage = query.get('stage') === 'final' ? 'final' : 'draft'
        const plan = await planFor(
          request.params.part,
          speaker,
          query.get('weak') === '1',
          stage,
          languageOf(request),
        )
        if (!plan) return notFound()
        if (!plan.ok || !plan.plan.eleven) return Response.json(plan)
        // What the plan has left, beside what its ElevenLabs lines take and what running
        // recordings and auditions hold.
        return Response.json({
          ...plan,
          elevenAccount: await shownAccount(),
          elevenHeld: elevenHeld(),
        })
      }),
    },
    '/api/parts/:part/jobs': {
      POST: fromOwnPage(async (request) => {
        const body = JobBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json(
            {
              error:
                'expected { kind, stage, speaker, keys, orphans, retakeWeak, confirmedCost, confirmedCredits }',
            },
            { status: 400 },
          )
        }
        const { part } = request.params
        const { retakeWeak } = body.data
        const { stage } = body.data
        const language = await languageFor(request)
        const planned = await planFor(
          part,
          body.data.speaker ?? undefined,
          retakeWeak,
          stage,
          language,
        )
        if (!planned) return notFound()
        if (!planned.ok) return Response.json(planned, { status: 409 })
        const { plan, parallel } = planned
        const shownKeys = new Set(body.data.keys)
        const shownOrphans = new Set(body.data.orphans)
        const { kind } = body.data
        // Measuring and checking again use Whisper alone: no new audio, nothing spent.
        const measuring = kind !== 'record'
        const offered = { record: plan.keys, measure: plan.unmeasured, check: plan.recheck }[kind]
        const keys = offered.filter((key) => shownKeys.has(key))
        const orphans = measuring ? [] : plan.orphans.filter((key) => shownOrphans.has(key))
        if (!keys.length && !orphans.length) {
          return Response.json({ error: 'There is nothing to do.' }, { status: 409 })
        }
        const admitted = measuring
          ? {
              budget: createBudget({ model: planned.model, dollars: 0 }),
              credits: createBudget({ model: planned.elevenModel, dollars: 0 }),
              release: () => undefined,
            }
          : await admitBoth(planned, keys, body.data)
        if ('problem' in admitted) {
          const { problem } = admitted
          return Response.json({ error: problem.message, ...problem }, { status: 409 })
        }
        const { budget, credits, release } = admitted
        // Checked with no await before the job starts, so a refresh cannot slip in between.
        if (isRefreshing(projectFile, part)) {
          release()
          return Response.json(
            { error: 'The dialog is being refreshed; generate when it is done.' },
            { status: 409 },
          )
        }
        // Set once the job has started; `onEnd` only runs after the job's first await, so it is set.
        let jobId = ''
        const progress = () => {
          const state = jobs.get(jobId)
          return { lines: state ? state.done - state.skipped - state.failed.length : 0 }
        }
        const followed = measuring
          ? null
          : spendLog.follow({
              part,
              ...planned,
              planned: keys.length,
              budget,
              credits,
              progress,
            })
        const job = jobs.start({
          kind: body.data.kind,
          part,
          language,
          speaker: body.data.speaker,
          keys,
          orphans,
          parallel,
          record: async (key) =>
            measuring
              ? measureLine(projectFile, part, key, {
                  transcriber: await transcriberFor(),
                  again: kind === 'check',
                  onlyIfNeeded: true,
                  language,
                })
              : recordLine(projectFile, part, key, fishFor, {
                  encode,
                  limiter: fishWork,
                  elevenLimiter: elevenWork,
                  elevenlabs: elevenFor,
                  onlyIfNeeded: true,
                  retakeWeak,
                  stage,
                  budget,
                  credits,
                  transcriber: await transcriberFor(),
                  language,
                }),
          removeOrphans: (keys) => removeOrphans(projectFile, part, keys, language),
          onEnd: () => {
            release()
            const state = jobs.get(jobId)
            if (!followed || !state || state.status === 'running') return
            void followed.end({
              lines: progress().lines,
              outcome: outcomeOf({
                status: state.status === 'done' ? 'done' : 'cancelled',
                failed: state.failed.length,
              }),
            })
          },
        })
        // Not started (another job runs for the part): nothing is held back for it.
        if ('error' in job) {
          release()
          void followed?.end({ lines: 0, outcome: 'error' })
        } else jobId = job.id
        return Response.json(job, { status: 'error' in job ? 409 : 200 })
      }),
    },
    '/api/parts/:part/jobs/latest': {
      GET: guard(async (request) =>
        Response.json(jobs.latest(request.params.part, await languageFor(request))),
      ),
    },
    '/api/parts/:part/clips/:file': {
      GET: guard(async (request) => {
        const file = await clipFile(
          projectFile,
          request.params.part,
          request.params.file,
          languageOf(request),
        )
        return fileResponse(file)
      }),
    },
    '/api/characters/:id': {
      PATCH: fromOwnPage(async (request) => {
        const body = CharacterBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json(
            {
              error:
                'expected { keywords: string[] }, { phrase: string | null }, { style: string } or { speed: number | null }',
            },
            { status: 400 },
          )
        }
        const { id } = request.params
        const result = await changeCharacter(id, body.data, languageOf(request))
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/parts/:part/refresh': {
      POST: fromOwnPage(async (request) => {
        // A job reads the dialog as it records: refreshing under it would fail its lines.
        if (jobs.running(request.params.part)) {
          const message = 'A generation is running for this part; refresh when it is done.'
          return Response.json({ ok: false, reason: 'busy', message }, { status: 409 })
        }
        const result = await refreshDialog(projectFile, request.params.part)
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/parts/:part/cues/:key/move': {
      POST: fromOwnPage(async (request) => {
        const body = MoveCueBody.safeParse(await request.json().catch(() => null))
        if (!body.success) return Response.json({ error: 'expected { to }' }, { status: 400 })
        const { part, key } = request.params
        const result = await moveCue(projectFile, part, key, body.data.to, languageOf(request))
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/spending': {
      GET: guard(async () => {
        const [project, saved] = await Promise.all([
          loadProject(projectFile),
          readSpending(projectFile),
        ])
        if (!saved.ok) return Response.json({ ok: false, problems: saved.problems })
        // The acts, and the stingers once a stinger take cost something: a take's list is one.
        const stingers = saved.music.some((take) => take.part === 'stingers')
        const parts = project.ok
          ? [
              ...project.summary.parts.map((p) => ({ id: p.id, title: p.title })),
              ...(stingers ? [{ id: 'stingers', title: 'Stingers' }] : []),
            ]
          : []
        return Response.json({
          ok: true,
          ...summariseSpending(
            saved.recordings,
            spendLog.running(),
            parts,
            saved.music,
            saved.tries,
          ),
          languages: project.ok ? project.summary.languages.length : 1,
        })
      }),
    },
    '/api/credit': {
      GET: guard(async () => Response.json(await creditOf())),
    },
    '/api/pronounce': {
      PATCH: fromOwnPage(async (request) => {
        const body = PronounceBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { table, was }' }, { status: 400 })
        }
        const result = await setPronunciations(
          projectFile,
          body.data.table,
          body.data.was,
          languageOf(request),
        )
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/sound-alike': {
      PATCH: fromOwnPage(async (request) => {
        const body = SoundAlikeBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { groups, was }' }, { status: 400 })
        }
        const result = await setSoundAlike(
          projectFile,
          body.data.groups,
          body.data.was,
          languageOf(request),
        )
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/elevenlabs/account': {
      GET: guard(async () => Response.json({ account: await shownAccount(), held: elevenHeld() })),
    },
    '/api/elevenlabs/voices/freeable': {
      // The voices the studio added from the library that nothing uses: their slots can be freed.
      GET: guard(async () => {
        const added = await readAddedVoices(projectFile)
        // Nothing the studio added: nothing to offer, whatever can be read.
        if (!added.added.length) return Response.json({ ok: true, voices: [] })
        const used = await voicesInUse(projectFile)
        if (!used) return unknownUse()
        const voices = freeableVoices(added, used)
        return Response.json({
          ok: true,
          voices: voices.map(({ voice, name, character }) => ({ voice, name, character })),
        })
      }),
    },
    '/api/elevenlabs/voices/free': {
      POST: fromOwnPage(async (request) => {
        const body = FreeBody.safeParse(await request.json().catch(() => null))
        if (!body.success) return Response.json({ error: 'expected { voices }' }, { status: 400 })
        const used = await voicesInUse(projectFile)
        if (!used) return unknownUse()
        const result = await freeVoices(
          projectFile,
          async () => {
            const opened = await openProject(projectFile)
            return opened.ok ? elevenFor(dirname(projectFile), opened.project) : null
          },
          body.data.voices,
          used,
        )
        // Slots were freed: the board asks for the account afresh, and a take or cast of a
        // voice removed adds it again.
        forgetShownAccount()
        if (result.ok) await voicesRemoved(projectFile, result.libraries)
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/elevenlabs/tts': {
      PUT: fromOwnPage(async (request) => {
        const body = ElevenTtsBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { tts, was }' }, { status: 400 })
        }
        const busy = await busyRefusal('narration.generate.elevenlabs')
        if (busy) return busy
        const result = await setElevenSettings(projectFile, body.data.tts, body.data.was)
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/parts/:part/lines/:key/takes': {
      GET: guard(async (request) => {
        const { part, key } = request.params
        const result = await listLineTakes(projectFile, part, key, languageOf(request))
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
      POST: fromOwnPage(async (request) => {
        const { part, key } = request.params
        const text = await request.text()
        const body = TakeLineBody.safeParse(parseOrNull(text || '{}'))
        if (!body.success) {
          return Response.json({ error: 'expected { confirmedCost? }' }, { status: 400 })
        }
        // Fails closed, as recording does: a take is priced for one request per piece.
        const planned = await planFor(part, undefined, false, 'draft', languageOf(request))
        if (!planned) return notFound()
        if (!planned.ok) return Response.json(planned, { status: 409 })
        const admitted = await admitBoth(planned, [key], body.data, 1)
        if ('problem' in admitted) {
          return Response.json({ ok: false, ...admitted.problem }, { status: 409 })
        }
        try {
          const result = await whileGoing('part', part, () =>
            loggedOne(planned, part, admitted, async () =>
              takeLine(projectFile, part, key, fishFor, {
                limiter: fishWork,
                elevenLimiter: elevenWork,
                transcriber: await transcriberFor(),
                budget: admitted.budget,
                credits: admitted.credits,
                language: languageOf(request),
                elevenlabs: elevenFor,
              }),
            ),
          )
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        } finally {
          admitted.release()
        }
      }),
    },
    '/api/parts/:part/lines/:key/takes/:file': {
      GET: guard(async (request) => {
        const { part, key, file } = request.params
        const id = /^([0-9a-f]{16})\.wav$/.exec(file)?.[1]
        const found = id
          ? await lineTakeFile(projectFile, part, key, id, languageOf(request))
          : null
        return found ? new Response(Bun.file(found)) : notFound()
      }),
      DELETE: fromOwnPage(async (request) => {
        const { part, key, file } = request.params
        if (!/^[0-9a-f]{16}$/.test(file)) return notFound()
        const result = await dropLineTake(projectFile, part, key, file, languageOf(request))
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/parts/:part/lines/:key/takes/:id/use': {
      POST: fromOwnPage(async (request) => {
        const { part, key, id } = request.params
        if (!/^[0-9a-f]{16}$/.test(id)) return notFound()
        const result = await useLineTake(projectFile, part, key, id, {
          encode,
          language: languageOf(request),
        })
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/parts/:part/lines/:key/try': {
      POST: fromOwnPage(async (request) => {
        const body = TryBody.safeParse(await request.json().catch(() => null))
        if (!body.success) return Response.json({ error: 'expected { cue }' }, { status: 400 })
        const { part, key } = request.params
        const result = await whileGoing('part', part, () =>
          tryLine(
            projectFile,
            part,
            key,
            body.data.cue,
            fishFor,
            fishWork,
            languageOf(request),
            body.data.at,
            { elevenlabs: elevenFor, elevenLimiter: elevenWork },
          ),
        )
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/parts/:part/cues/:key/inside': {
      PATCH: fromOwnPage(async (request) => {
        const body = InsideCueBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { at, cue, text }' }, { status: 400 })
        }
        const { part, key } = request.params
        const result = await setInsideCue(projectFile, part, key, body.data, languageOf(request))
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/parts/:part/cues/:key': {
      PATCH: fromOwnPage(async (request) => {
        const body = CueBody.safeParse(await request.json().catch(() => null))
        if (!body.success) return Response.json({ error: 'expected { cue }' }, { status: 400 })
        const { part, key } = request.params
        const result = await setCue(projectFile, part, key, body.data.cue, languageOf(request))
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/parts/:part/scene-cues': {
      PATCH: fromOwnPage(async (request) => {
        const body = SceneCueBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { scene, cue }' }, { status: 400 })
        }
        const { scene, cue } = body.data
        const result = await setSceneCue(
          projectFile,
          request.params.part,
          scene,
          cue,
          languageOf(request),
        )
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/parts/:part/scene-cues/move': {
      POST: fromOwnPage(async (request) => {
        const body = MoveSceneCueBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { from, to }' }, { status: 400 })
        }
        const { from, to } = body.data
        const result = await moveSceneCue(
          projectFile,
          request.params.part,
          from,
          to,
          languageOf(request),
        )
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/characters/:id/takes': {
      POST: fromOwnPage(async (request) => {
        const body = AuditionTakeBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { voice, board? }' }, { status: 400 })
        }
        const { id } = request.params
        const { voice, board } = body.data
        const sitting = await sittingKey(id, request)
        const budget = board ? sittings.get(sitting) : undefined
        // An ElevenLabs voice's board take is paid from the sitting's credits instead.
        const credits =
          board && providerOf(voice) === 'elevenlabs' ? creditSittings.get(sitting) : undefined
        // A voice of ElevenLabs' library is added to the user's voices at its first take.
        const onBoard = credits
          ? await boardVoice(projectFile, id, voice, languageOf(request))
          : undefined
        const result = await whileGoing('character', id, () =>
          recordTake(
            projectFile,
            id,
            voice,
            fishFor,
            fishWork,
            {
              board,
              budget,
              open: () => budget !== undefined && sittings.get(sitting) === budget,
              flight: (dollars) => (budget ? flightIn(inFlight, budget, dollars) : () => undefined),
              charged: async (dollars) =>
                void (await recordSpent(projectFile, id, dollars, languageOf(request))),
              elevenlabs: elevenFor,
              elevenLimiter: elevenWork,
              ...(onBoard?.library && {
                speakAs: async (client: ElevenLabsClient) => {
                  const spoken = await voiceToSpeak(projectFile, async () => client, onBoard, id)
                  await voiceAdded(projectFile, id, voice, languageOf(request))
                  // It may have taken a voice slot: the board asks for the account afresh.
                  forgetShownAccount()
                  return spoken
                },
              }),
              ...(credits && {
                credits,
                open: () => creditSittings.get(sitting) === credits,
                flight: (spent: number) => flightIn(creditsInFlight, credits, spent),
              }),
            },
            languageOf(request),
          ),
        )
        if (!result) return notFound()
        return Response.json(result, { status: 'problems' in result ? 409 : 200 })
      }),
    },
    '/api/auditions/:id': {
      GET: guard(async (request) => {
        const { id } = request.params
        const language = languageOf(request)
        const result = await sessionFor(projectFile, id, language)
        return result
          ? Response.json(await viewOf(projectFile, id, result, { language }))
          : notFound()
      }),
      DELETE: fromOwnPage(async (request) => {
        const { id } = request.params
        const language = languageOf(request)
        const discarded = await discardSession(projectFile, id, language)
        if (!discarded) return notFound()
        if (discarded !== true) return Response.json(discarded, { status: 409 })
        endSitting(await sittingKey(id, request))
        return Response.json(
          await viewOf(projectFile, id, { ok: true, session: null }, { language }),
        )
      }),
    },
    '/api/auditions/:id/start': {
      POST: fromOwnPage(async (request) => {
        const body = StartBody.safeParse(await request.json().catch(() => ({})))
        if (!body.success)
          return Response.json({ error: 'expected { spendUpTo?, creditsUpTo? }' }, { status: 400 })
        const { id } = request.params
        const money = await auditionMoney(projectFile, id, languageOf(request))
        if (!money) return notFound()
        if (!money.ok) return Response.json(money, { status: 409 })
        // A paid audition model starts with a sitting: no amount, no audition. Credits for
        // ElevenLabs voices' takes are the sitting's other half, given when asked for.
        const key = await sittingKey(id, request)
        const { spendUpTo, creditsUpTo } = body.data
        let given: Given = {}
        if (isPaid(money.model, new Date()) || creditsUpTo !== undefined) {
          const fresh = await freshSitting(key, money, {
            amount: spendUpTo,
            credits: creditsUpTo,
          })
          if ('problem' in fresh) return sittingAnswer(request, id, fresh.problem)
          given = fresh
        }
        const started = await whileGoing('character', id, () =>
          startAudition(projectFile, id, fishFor, languageOf(request), elevenFor),
        )
        // An audition that did not start has no sitting: this start's, not one set since.
        if (!started?.ok) endGiven(key, given)
        return answer(id, Promise.resolve(started), { language: languageOf(request) })
      }),
    },
    '/api/auditions/:id/sitting': {
      GET: guard((request) => sittingAnswer(request, request.params.id)),
      POST: fromOwnPage(async (request) => {
        const body = AmountBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { amount?, credits? }' }, { status: 400 })
        }
        const { id } = request.params
        const money = await auditionMoney(projectFile, id, languageOf(request))
        if (!money) return notFound()
        if (!money.ok) return Response.json(money, { status: 409 })
        const fresh = await freshSitting(await sittingKey(id, request), money, body.data)
        if ('problem' in fresh) return sittingAnswer(request, id, fresh.problem)
        return sittingAnswer(request, id)
      }),
      DELETE: fromOwnPage(async (request) => {
        endSitting(await sittingKey(request.params.id, request))
        return sittingAnswer(request, request.params.id)
      }),
    },
    '/api/auditions/:id/sitting/add': {
      POST: fromOwnPage(async (request) => {
        const body = AddBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { amount } or { credits }' }, { status: 400 })
        }
        const { id } = request.params
        const key = await sittingKey(id, request)
        if ('credits' in body.data) {
          const more = body.data.credits
          const credits = creditSittings.get(key)
          if (credits) {
            const problem = await holdCredits(more, () => credits.add(more))
            return sittingAnswer(request, id, problem)
          }
          // None yet: the board gives the sitting its credits, beside any dollars it has.
          const money = await auditionMoney(projectFile, id, languageOf(request))
          if (!money) return notFound()
          if (!money.ok) return Response.json(money, { status: 409 })
          if (!money.going) {
            return sittingAnswer(request, id, {
              reason: 'confirm-credits',
              ceiling: 0,
              message: 'There is no audition to give credits to; start one.',
            })
          }
          const got = await admitCredits(money.eleven.model, more, more)
          if ('problem' in got) return sittingAnswer(request, id, got.problem)
          // Two at once: the first given stays, and the second holds nothing.
          if (creditSittings.has(key)) creditBudgets.delete(got.budget)
          else creditSittings.set(key, got.budget)
          return sittingAnswer(request, id)
        }
        const budget = sittings.get(key)
        if (!budget) {
          return sittingAnswer(request, id, {
            reason: 'confirm',
            ceiling: 0,
            message: 'There is no sitting to add to; resume the audition.',
          })
        }
        const heldWhenAsked = new Set(budgets)
        const credit = await creditOf()
        const free = credit.ok ? credit.credit - reserved(heldWhenAsked) : null
        const { amount } = body.data
        const problem = spendProblem({ ceiling: amount, confirmed: amount, credit: free })
        if (problem) return sittingAnswer(request, id, problem)
        budget.add(amount)
        return sittingAnswer(request, id)
      }),
    },
    '/api/auditions/:id/own': {
      POST: fromOwnPage((request) =>
        answer(
          request.params.id,
          refreshOwnVoices(projectFile, request.params.id, fishFor, languageOf(request)),
          { language: languageOf(request) },
        ),
      ),
    },
    '/api/auditions/:id/move': {
      POST: fromOwnPage(async (request) => {
        const body = MoveBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json(
            { error: "expected { voice, move: 'shortlist' | 'unlist' | 'drop' }" },
            { status: 400 },
          )
        }
        const { voice, move } = body.data
        const { id } = request.params
        const language = languageOf(request)
        return answer(id, moveVoice(projectFile, id, voice, move, language), {
          recorded: false,
          language,
        })
      }),
    },
    '/api/auditions/:id/undo': {
      POST: fromOwnPage((request) =>
        answer(
          request.params.id,
          undoLastDrop(projectFile, request.params.id, languageOf(request)),
          { recorded: false, language: languageOf(request) },
        ),
      ),
    },
    '/api/auditions/:id/more': {
      POST: fromOwnPage(async (request) => {
        // No body is Fish's library, as before there was a choice.
        const text = await request.text()
        const body = MoreBody.safeParse(
          text ? await Promise.try(() => JSON.parse(text)).catch(() => null) : {},
        )
        if (!body.success) {
          return Response.json({ error: 'expected { provider? }' }, { status: 400 })
        }
        const { provider } = body.data
        return answer(
          request.params.id,
          whileGoing('character', request.params.id, () =>
            moreVoices(projectFile, request.params.id, fishFor, languageOf(request), {
              provider,
              elevenFor,
            }),
          ),
          { language: languageOf(request) },
        )
      }),
    },
    '/api/auditions/:id/add': {
      POST: fromOwnPage(async (request) => {
        const body = VoiceBody.safeParse(await request.json().catch(() => null))
        if (!body.success) return Response.json({ error: 'expected { voice }' }, { status: 400 })
        const { id } = request.params
        const language = languageOf(request)
        return answer(
          id,
          whileGoing('character', id, () =>
            addVoiceById(projectFile, id, body.data.voice, fishFor, language, elevenFor),
          ),
          {
            language,
          },
        )
      }),
    },
    '/api/characters/:id/clone-voice': {
      POST: fromOwnPage(async (request) => {
        const form = await request.formData().catch(() => null)
        const title = form?.get('title')
        if (!form || typeof title !== 'string') {
          return Response.json({ error: 'expected a form with title and voices' }, { status: 400 })
        }
        const voices = form.getAll('voices').filter((v): v is File => v instanceof File)
        const files = await Promise.all(
          voices.map(async (v) => ({
            name: v.name,
            type: v.type || 'application/octet-stream',
            bytes: new Uint8Array(await v.arrayBuffer()),
          })),
        )
        const result = await cloneVoice(projectFile, request.params.id, { title, files }, fishFor)
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/characters/:id/designs': {
      GET: guard(async (request) => {
        const result = await designsFor(projectFile, request.params.id, languageOf(request))
        if (!result) return notFound()
        if (!result.ok) return Response.json(result, { status: 409 })
        // What a design with ElevenLabs would say and cost, for its confirm.
        const plan = await elevenDesignFor(projectFile, request.params.id, languageOf(request))
        return Response.json({
          ...result,
          eleven: plan?.ok ? { text: plan.text, credits: plan.credits } : null,
        })
      }),
    },
    '/api/characters/:id/design': {
      POST: fromOwnPage(async (request) => {
        const body = DesignBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { description, spendUpTo? }' }, { status: 400 })
        }
        const { id } = request.params
        if ((await designsFor(projectFile, id, languageOf(request))) === null) return notFound()
        if (body.data.provider === 'elevenlabs') {
          // A description ElevenLabs would refuse costs no account read and holds nothing.
          const state = elevenDescriptionState(body.data.description)
          if (!state.canSend) {
            const message = state.tooLong ?? 'Describe the voice you want in 20 characters or more.'
            return Response.json({ ok: false, reason: 'invalid', message }, { status: 409 })
          }
          const plan = await elevenDesignFor(projectFile, id, languageOf(request))
          if (!plan) return notFound()
          if (!plan.ok) return Response.json(plan, { status: 409 })
          // Held back from the plan while ElevenLabs designs, as the credits confirmed.
          const got = await admitCredits(ELEVEN_DESIGN_MODEL, plan.credits, body.data.creditsUpTo)
          if ('problem' in got) {
            return Response.json({ ok: false, ...got.problem }, { status: 409 })
          }
          try {
            const result = await designElevenVoices(
              projectFile,
              id,
              body.data.description,
              elevenFor,
              languageOf(request),
              undefined,
              // The text whose credits were confirmed and held, not one made again since.
              { text: plan.text },
            )
            if (!result) return notFound()
            return Response.json(result, { status: 'added' in result ? 200 : 409 })
          } finally {
            creditBudgets.delete(got.budget)
          }
        }
        // Held back from the credit while Fish designs; Fish bills a request that works.
        const got = await admit(DESIGN_MODEL, DESIGN_PRICE, body.data.spendUpTo)
        if ('problem' in got) return Response.json({ ok: false, ...got.problem }, { status: 409 })
        try {
          const result = await designVoices(
            projectFile,
            id,
            body.data.description,
            fishFor,
            encode,
            languageOf(request),
          )
          if (!result) return notFound()
          return Response.json(result, { status: 'added' in result ? 200 : 409 })
        } finally {
          budgets.delete(got.budget)
        }
      }),
    },
    '/api/characters/:id/cast-voice': {
      POST: fromOwnPage(async (request) => {
        const body = CastOwnBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { voice, name }' }, { status: 400 })
        }
        const { voice, name } = body.data
        const result = await castOwnVoice(
          projectFile,
          request.params.id,
          { id: voice, name },
          languageOf(request),
        )
        if (!result) return notFound()
        if (result.ok) endSitting(await sittingKey(request.params.id, request))
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/auditions/:id/cast': {
      POST: fromOwnPage(async (request) => {
        const body = VoiceBody.safeParse(await request.json().catch(() => null))
        if (!body.success) return Response.json({ error: 'expected { voice }' }, { status: 400 })
        const { voice } = body.data
        const language = languageOf(request)
        // A designed voice is saved to the account first; Fish makes no voice from a design.
        const result = isDesignId(voice)
          ? await castDesign(projectFile, request.params.id, voice, fishFor, language, elevenFor)
          : await castVoice(projectFile, request.params.id, voice, language, (shown) =>
              saveToAccount(shown, request.params.id),
            )
        if (!result) return notFound()
        if (result.ok) endSitting(await sittingKey(request.params.id, request))
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/characters/:id/ruled-out': {
      GET: guard(async (request) =>
        ruledOut(ruledOutVoices(projectFile, request.params.id, languageOf(request))),
      ),
      DELETE: fromOwnPage((request) =>
        ruledOut(allowVoices(projectFile, request.params.id, 'all', languageOf(request))),
      ),
    },
    '/api/characters/:id/ruled-out/:voice': {
      DELETE: fromOwnPage(async (request) => {
        const { id, voice } = request.params
        if (!VOICE_ID.test(voice))
          return Response.json({ error: 'not a voice id' }, { status: 400 })
        return ruledOut(allowVoices(projectFile, id, [voice], languageOf(request)))
      }),
    },
    '/api/takes/:file': {
      GET: guard(async (request) => {
        const key = /^([0-9a-f]{16})\.mp3$/.exec(request.params.file)?.[1]
        const file = key ? await takeFile(projectFile, key) : null
        if (!file) return notFound()
        // Fish's takes are MP3; ElevenLabs' are WAV, kept under the same name.
        const head = new Uint8Array(await Bun.file(file).slice(0, 4).arrayBuffer())
        const wav = String.fromCharCode(...head) === 'RIFF'
        return new Response(
          Bun.file(file),
          wav ? { headers: { 'content-type': 'audio/wav' } } : undefined,
        )
      }),
    },
    '/api/characters/:id/voice': {
      GET: guard(async (request) => {
        const result = await characterVoice(
          projectFile,
          request.params.id,
          fishFor,
          languageOf(request),
          elevenFor,
        )
        return result ? Response.json(result) : notFound()
      }),
    },
  }
}
