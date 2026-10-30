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

/** Images workspace. */
export function ImageIcon() {
  return (
    <Stroke>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m21 16-5-5-8 9" />
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

/** Uncommitted changes: a branch with a change on it. */
export function ChangesIcon() {
  return (
    <Stroke>
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M6 7.5v9M8.3 6.2c4.4 1 7.1 2.9 7.6 3.9" />
    </Stroke>
  )
}

/** Spending: a coin with a dollar sign. */
export function SpendingIcon() {
  return (
    <Stroke>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.8 9.2c-.4-.9-1.4-1.4-2.8-1.4-1.6 0-2.7.8-2.7 2 0 3 5.6 1.5 5.6 4.3 0 1.2-1.1 2-2.9 2-1.5 0-2.6-.6-3-1.6M12 6.3v1.5M12 16.2v1.5" />
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

/** Stop the clip playing (a square). */
export function StopIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
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

/** Listen: auditions. */
export function HeadphonesIcon() {
  return (
    <Stroke size={14}>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" />
    </Stroke>
  )
}

/** Drop, remove. */
export function CrossIcon() {
  return (
    <Stroke size={14}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Stroke>
  )
}

/** Design a voice from a description. */
export function SparkIcon() {
  return (
    <Stroke size={14}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    </Stroke>
  )
}
