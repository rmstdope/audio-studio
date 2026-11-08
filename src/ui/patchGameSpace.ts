import type { PatchArea } from '../core/imagePatches'
import { cropWindow } from '../core/imagePixels'

/** The picture the large view draws: its size in pixels, and where a marked area of the model's picture falls on it. */
export interface PatchSpace {
  width: number
  height: number
  /** An area of the model's picture in this picture's pixels; it may reach beyond the picture. */
  place: (area: PatchArea) => PatchArea
  /** An area drawn on this picture, in pixels of the model's picture (whole pixels). */
  unplace: (area: PatchArea) => PatchArea
}

/** What the model made, at its full size: areas are where they were marked. */
export function modelSpace(take: { width: number; height: number }): PatchSpace {
  return { width: take.width, height: take.height, place: (area) => area, unplace: (area) => area }
}

/**
 * What the game gets: the model's picture cropped to the game's shape and scaled to its size, so
 * an area lands in the same place of the scene, and one outside the cropped edges falls outside.
 */
export function gameSpace(
  take: { width: number; height: number },
  game: { width: number; height: number },
): PatchSpace {
  const window = cropWindow(take, game)
  const sx = game.width / window.width
  const sy = game.height / window.height
  return {
    width: game.width,
    height: game.height,
    place: (area) => ({
      x: (area.x - window.x) * sx,
      y: (area.y - window.y) * sy,
      width: area.width * sx,
      height: area.height * sy,
    }),
    unplace: (area) => ({
      x: Math.round(area.x / sx + window.x),
      y: Math.round(area.y / sy + window.y),
      width: Math.round(area.width / sx),
      height: Math.round(area.height / sy),
    }),
  }
}
