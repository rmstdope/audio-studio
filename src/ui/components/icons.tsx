import type { ReactNode } from 'react'

function Stroke({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** The studio's mark: a waveform. */
export function WaveIcon({ size }: { size?: number }) {
  return (
    <Stroke size={size}>
      <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
    </Stroke>
  )
}

/** Narration workspace. */
export function MicIcon() {
  return (
    <Stroke>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </Stroke>
  )
}

/** Music workspace. */
export function MusicIcon() {
  return (
    <Stroke>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </Stroke>
  )
}

/** Sound effects workspace. */
export function SpeakerIcon() {
  return (
    <Stroke>
      <path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
    </Stroke>
  )
}

/** The project-wide characters view. */
export function PeopleIcon() {
  return (
    <Stroke>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" />
    </Stroke>
  )
}

/** Play a clip. */
export function PlayIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  )
}

/** Stop the clip playing. */
export function PauseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}

/** A list of lines. */
export function ListIcon() {
  return (
    <Stroke>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </Stroke>
  )
}

/** Something done. */
export function CheckIcon() {
  return (
    <Stroke>
      <path d="M20 6 9 17l-5-5" />
    </Stroke>
  )
}

/** Something to look at. */
export function AlertIcon() {
  return (
    <Stroke>
      <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </Stroke>
  )
}
