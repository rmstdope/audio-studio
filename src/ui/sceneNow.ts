import type { RowNow } from '../core/sceneEngine'

/** Seconds as the play bar's clock: `0:14`. */
export function clock(seconds: number): string {
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** What is known of a row besides what the engine says. */
export interface NowContext {
  /** The scene's current state's name. */
  state: string
  muted: boolean
  /** Another row is soloed and this one is not. */
  notSoloed: boolean
  /** No take is chosen. */
  silent: boolean
  /** The game no longer has the effect. */
  gone: boolean
  /** The clip could not be loaded. */
  failed: boolean
}

/** What a row says in the Now column, in words; a muted or not soloed row says it too. */
export function nowWords(now: RowNow, ctx: NowContext): string {
  if (ctx.gone) return 'Not played'
  if (ctx.silent) return 'Silent'
  if (ctx.failed) return "Couldn't load the clip"
  const seconds = (n: number) => Math.ceil(n - 1e-9)
  const words =
    now.kind === 'playing'
      ? 'Playing'
      : now.kind === 'in'
        ? `In ${seconds(now.seconds)} s`
        : now.kind === 'next'
          ? `Next in ${seconds(now.seconds)} s`
          : now.kind === 'played'
            ? `Played at ${clock(now.at)}`
            : now.kind === 'waits'
              ? `Waits for ${now.trigger}`
              : `Not in ${ctx.state}`
  return ctx.muted ? `${words}, muted` : ctx.notSoloed ? `${words}, not soloed` : words
}

/** Whether a row is heard: solo wins over mute, and with any solo only soloed rows sound. */
export function audible(key: string, muted: Set<string>, soloed: Set<string>): boolean {
  if (soloed.size > 0) return soloed.has(key)
  return !muted.has(key)
}

/** The play bar's count of muted and soloed rows, or null when there are none. */
export function muteSoloText(muted: number, soloed: number): string | null {
  if (muted === 0 && soloed === 0) return null
  if (soloed === 0) return `Muted: ${muted}`
  return muted === 0 ? `Solo: ${soloed}` : `Solo: ${soloed} · Muted: ${muted}`
}
