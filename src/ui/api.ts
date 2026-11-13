/**
 * The client's calls to the studio's API and the hooks over them, one file per medium in
 * `api/`; this file re-exports them all, so a caller imports from here.
 */
export * from './api/effects'
export * from './api/images'
export * from './api/music'
export * from './api/narration'
export * from './api/scenes'
export * from './api/core'
