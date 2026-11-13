import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FineTunesView, UseFineTuneAnswer } from '../../core/imageFineTunes'
import type { ImagePatchesView, PatchArea } from '../../core/imagePatches'
import type { ImageMakingSummary, ImageTakesView, LookRunView } from '../../core/imageTakes'
import type { EditModelId } from '../../core/imageModels'
import type { FineTuneAnswer, FineTuneRequest } from '../../services/imageFineTunes'
import type { ImagePatchAnswer, PatchMakeRequest } from '../../services/imagePatches'
import { takesAreBeingMade } from '../musicTakesText'
import type { AreaBox, StyleField } from '../../core/images'
import type { ImageEditResult } from '../../services/imageEdits'
import type {
  ImageMakeRequest,
  ImageModelStateResult,
  ImagesBatch as ImageBatch,
  ImageTakesAnswer,
} from '../../services/imageTakes'
import type { ModelsChange } from '../../services/models'
import type { ProjectFailure } from '../../services/workspace'

import { useBatch, useMakeAllRequest, useStopAllRequest, type MakeAllMedium } from './batchHooks'
import { getJson } from './core'
import { useTakeAction, type TakeMedium } from './takeHooks'

/**
 * Saves the project's image model in the project file (`was` is the one the page showed), then
 * reloads everything that shows it: the Models panel, an image's Takes section and the checks.
 */
export function useSetImageModel() {
  const client = useQueryClient()
  return useMutation({
    scope: { id: 'models' },
    mutationFn: async ({ model, was }: { model: string; was: string }) => {
      const response = await fetch('/api/image-model', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, was }),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving the image model answered ${response.status}`)
      }
      return (await response.json()) as ModelsChange
    },
    onSettled: () => client.invalidateQueries(),
  })
}

/**
 * Sends one change to the studio's own image words (`PATCH`/`POST` with a JSON body), then reloads
 * the project, whose Images pages show the result. A 404 means the game no longer lists the image.
 * `afterSaved` runs once the reload is done and only when the request did not fail; it is given
 * here, not to `mutate`, whose callbacks are dropped when the page that asked has gone.
 */
function useImageEdit<V>(
  scope: string,
  request: (value: V) => { method: string; path: string; body: unknown },
  afterSaved?: () => void,
) {
  const client = useQueryClient()
  return useMutation({
    scope: { id: scope },
    mutationFn: async (value: V) => {
      const { method, path, body } = request(value)
      const response = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (response.status === 404) {
        throw new Error('The game no longer lists this image; the page shows it as it is now.')
      }
      if (!response.ok && response.status !== 409) {
        throw new Error(`saving answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<ImageEditResult>
    },
    onSettled: async (_data, error) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['project'] }),
        client.invalidateQueries({ queryKey: ['changes'] }),
        // Takes made from other words are marked "earlier words" by the server.
        client.invalidateQueries({ queryKey: ['image-takes'] }),
      ])
      if (!error) afterSaved?.()
    },
  })
}

/** Saves the user's own words for an image (null takes them back). */
export function useSetImageWords(imageId: string) {
  return useImageEdit<string | null>(`image-${imageId}`, (words) => ({
    method: 'PATCH',
    path: `/api/images/${encodeURIComponent(imageId)}`,
    body: { words },
  }))
}

/** Saves the user's own words for a patch the game asks for on an image (null takes them back). */
export function useSetImagePatchWords(imageId: string, patchId: string) {
  return useImageEdit<string | null>(`image-${imageId}`, (words) => ({
    method: 'PATCH',
    path: `/api/images/${encodeURIComponent(imageId)}/game-patches/${encodeURIComponent(patchId)}`,
    body: { words },
  }))
}

/** Saves the box of a named area of an image (null takes it away). */
export function useSetImageAreaBox(imageId: string) {
  return useImageEdit<{ area: string; box: AreaBox | null }>(`image-${imageId}`, (value) => ({
    method: 'PUT',
    path: `/api/images/${encodeURIComponent(imageId)}/areas/${encodeURIComponent(value.area)}`,
    body: { box: value.box },
  }))
}

/** Settles a patch whose game words changed under the user's words. */
export function useImagePatchCompare(imageId: string, patchId: string) {
  return useImageEdit<'keep' | 'game'>(`image-${imageId}`, (choice) => ({
    method: 'POST',
    path: `/api/images/${encodeURIComponent(imageId)}/game-patches/${encodeURIComponent(patchId)}/compare`,
    body: { choice },
  }))
}

/** Saves whether an image uses its act's style addition. */
export function useSetImageActStyle(imageId: string) {
  return useImageEdit<{ on: boolean } | { from: string | null }>(`image-${imageId}`, (body) => ({
    method: 'PATCH',
    path: `/api/images/${encodeURIComponent(imageId)}/act-style`,
    body,
  }))
}

/** Settles an image whose game description changed under the user's words. */
export function useImageCompare(imageId: string) {
  return useImageEdit<'keep' | 'game'>(`image-${imageId}`, (choice) => ({
    method: 'POST',
    path: `/api/images/${encodeURIComponent(imageId)}/compare`,
    body: { choice },
  }))
}

/** Sets the style's look or what is kept out (null or empty: none, which the look refuses). */
export function useSetStyleField(field: StyleField) {
  return useImageEdit<string | null>(`image-style-${field}`, (words) => ({
    method: 'PATCH',
    path: '/api/image-style',
    body: { [field]: words },
  }))
}

/** An image's takes as its page shows them; polled while any is being made. */
export function useImageTakes(imageId: string) {
  const client = useQueryClient()
  return useQuery({
    queryKey: ['image-takes', imageId],
    queryFn: async () => {
      const view = await getJson<ImageTakesView | ProjectFailure>(
        `/api/images/${encodeURIComponent(imageId)}/takes`,
      )
      // Every read of the takes may carry a take just finished, which is a new time figure.
      void client.invalidateQueries({ queryKey: ['image-take-times'] })
      return view
    },
    refetchInterval: (query) => {
      const view = query.state.data
      if (view && 'takes' in view && view.takes.some((t) => t.look === 'bringing')) return 1000
      return view && 'making' in view && takesAreBeingMade(view.making) ? 3000 : false
    },
  })
}

/** The run that brings the images to the game's new look; polled while it goes, so a reload picks it up. */
export function useLookRun() {
  return useQuery({
    queryKey: ['look-run'],
    queryFn: () => getJson<LookRunView | null>('/api/images/bring-all'),
    refetchInterval: (query) => (query.state.data?.running ? 1000 : false),
  })
}

/** Starts bringing every image and take with an old look to the new one (from the model's stored pictures). */
export function useBringAll() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/images/bring-all', { method: 'POST' })
      if (!response.ok && response.status !== 409) {
        throw new Error(`bringing the images to the new look answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<ImageTakesAnswer>
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['look-run'] }),
        client.invalidateQueries({ queryKey: ['project'] }),
      ]),
  })
}

/** What is being made for each image of the project, for the lists' status; polled meanwhile. */
export function useImageMaking() {
  return useQuery({
    queryKey: ['image-making'],
    queryFn: () => getJson<Record<string, ImageMakingSummary>>('/api/images/making'),
    refetchInterval: (query) =>
      Object.values(query.state.data ?? {}).some((m) => m.takes > 0) ? 3000 : false,
  })
}

/** Setup's image model, how each model stands, and whether images can be made now. */
export function useImageModelState() {
  return useQuery({
    queryKey: ['image-model-state'],
    queryFn: () => getJson<ImageModelStateResult>('/api/images/model-state'),
  })
}

/**
 * What one press of Make takes on an act remembers (the studio keeps it, so every tab and a
 * reload see it): how many takes the server queued, for which images, for each of those how many
 * of its takes had failed and been stopped before the press, and whether any is still going.
 */
export type ImagesBatch = ImageBatch

/** Where Make all keeps its press and its requests for one act. */
const imagesMakeAllMedium = (actId: string): MakeAllMedium => ({
  base: `/api/image-acts/${encodeURIComponent(actId)}`,
  batchKey: ['images-batch', actId],
  makingKey: ['image-making'],
  stop: 'stop',
  tolerated: [],
})

/**
 * An act's latest press of Make takes, or null, and `dismiss` (Close), which clears it for every
 * tab. `busy` says that takes are being made in the act.
 */
export function useImagesBatch(
  actId: string,
  busy = false,
): { batch: ImagesBatch | null; dismiss: () => void } {
  const { batch, close } = useBatch<ImagesBatch>(imagesMakeAllMedium(actId), busy)
  return { batch, dismiss: close }
}

/**
 * Asks for four takes of every image of an act with no chosen take. The studio remembers the
 * press; the page reads what is being made and the press afterwards. A refusal is an error:
 * nothing was made.
 */
export function useImagesMakeAll(actId: string) {
  return useMakeAllRequest<void, { ok: boolean }>(
    imagesMakeAllMedium(actId),
    () => undefined,
    (answer) => {
      if (!answer.ok) throw new Error('asking for takes was refused')
    },
  )
}

/** Stops every take of an act that waits or is being made. */
export function useImagesStopAll(actId: string) {
  return useStopAllRequest<unknown>(imagesMakeAllMedium(actId))
}

/**
 * A change to an image's takes: sends `request` to the image's route, answers what the server
 * said (a refusal is an answer, not an error), then reloads its takes, what is being made and,
 * when `project` is set, the project, whose Images pages show the image's status.
 */
function useImageTakesChange<Input>(
  imageId: string,
  request: (input: Input) => { path: string; method: string; body?: unknown },
  project: boolean,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: Input) => {
      const { path, method, body } = request(input)
      const response = await fetch(`/api/images/${encodeURIComponent(imageId)}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`changing the takes answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<ImageTakesAnswer>
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['image-takes', imageId] }),
        // The patches lie on the image's chosen take, which a choice, un-choice or drop may change.
        client.invalidateQueries({ queryKey: ['image-patches', imageId] }),
        // So do the fine-tunes: they belong to the picture in the game.
        client.invalidateQueries({ queryKey: ['image-fine-tunes', imageId] }),
        client.invalidateQueries({ queryKey: ['image-making'] }),
        ...(project ? [client.invalidateQueries({ queryKey: ['project'] })] : []),
      ]),
  })
}

/** The images whose patches this page load has read. */
const loadedPatches = new Set<string>()

/** The patches the game asks for on an image, with their takes on its chosen take; polled while any is being made. */
export function useImagePatches(imageId: string) {
  const client = useQueryClient()
  return useQuery({
    queryKey: ['image-patches', imageId],
    queryFn: async () => {
      // The first read after the page loads says so, so a finished press's summary is not shown again.
      const fresh = !loadedPatches.has(imageId)
      loadedPatches.add(imageId)
      const view = await getJson<ImagePatchesView | ProjectFailure>(
        `/api/images/${encodeURIComponent(imageId)}/patches${fresh ? '?fresh=1' : ''}`,
      )
      void client.invalidateQueries({ queryKey: ['image-take-times'] })
      return view
    },
    refetchInterval: (query) => {
      const view = query.state.data
      return view &&
        'patches' in view &&
        (view.patches.some((p) => p.making.length > 0) || view.remake.press?.running)
        ? 1000
        : false
    },
  })
}

/**
 * A change to a patch's takes: sends `request` to the patch's route, answers what the server said
 * (a refusal is an answer, not an error), then reloads the image's patches.
 */
function usePatchTakesChange<Input>(
  imageId: string,
  patchId: string,
  request: (input: Input) => { path: string; method: string; body?: unknown },
  /** Whether the change alters which takes are chosen, so the images rows reload too. */
  choice = false,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: Input) => {
      const { path, method, body } = request(input)
      const response = await fetch(
        `/api/images/${encodeURIComponent(imageId)}/patches/${encodeURIComponent(patchId)}${path}`,
        {
          method,
          ...(body === undefined
            ? {}
            : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        },
      )
      if (!response.ok && response.status !== 409) {
        throw new Error(`changing the patch's takes answered ${response.status}`)
      }
      return (await response.json()) as NonNullable<ImagePatchAnswer>
    },
    // The rows of the images pages say which patch takes are chosen (and overlap), so they reload too.
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['image-patches', imageId] }),
        ...(choice ? [client.invalidateQueries({ queryKey: ['project'] })] : []),
      ]),
  })
}

/** Asks for takes of a patch: new ones of a marked area, or a failed one again. */
export function useMakePatchTakes(imageId: string, patchId: string) {
  return usePatchTakesChange<PatchMakeRequest>(imageId, patchId, (body) => ({
    path: '/takes',
    method: 'POST',
    body,
  }))
}

/**
 * Asks for takes of every patch of the image that needs making again and has none on the take in
 * the game. Answers what the server said (a refusal is an answer); reloads the image's patches.
 */
export function useRemakePatches(imageId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      count: number
      marks: Record<string, PatchArea>
      model: EditModelId
    }) => {
      const response = await fetch(`/api/images/${encodeURIComponent(imageId)}/patches/remake`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`remaking the patches answered ${response.status}`)
      }
      return (await response.json()) as { ok: boolean }
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['image-patches', imageId] }),
  })
}

/** Chooses a take of a patch. */
export function useChoosePatchTake(imageId: string, patchId: string) {
  return usePatchTakesChange<number>(
    imageId,
    patchId,
    (n) => ({
      path: '/choose',
      method: 'POST',
      body: { n },
    }),
    true,
  )
}

/** Takes back a patch's chosen take. */
export function useUnchoosePatchTake(imageId: string, patchId: string) {
  return usePatchTakesChange<void>(
    imageId,
    patchId,
    () => ({
      path: '/unchoose',
      method: 'POST',
    }),
    true,
  )
}

/** Takes a take off a patch's board. */
export function useDropPatchTake(imageId: string, patchId: string) {
  return usePatchTakesChange<number>(
    imageId,
    patchId,
    (n) => ({
      path: `/takes/${n}`,
      method: 'DELETE',
    }),
    true,
  )
}

/** Stops the patch's takes (the one being made and those waiting). */
export function useStopPatchTakes(imageId: string, patchId: string) {
  return usePatchTakesChange<void>(imageId, patchId, () => ({ path: '/stop', method: 'POST' }))
}

/** Records that a take of a patch has been laid over the picture once. */
export function useMarkPatchTakeSeen(imageId: string, patchId: string) {
  return usePatchTakesChange<number>(imageId, patchId, (n) => ({
    path: `/takes/${n}/seen`,
    method: 'POST',
  }))
}

/** The fine-tunes of an image's picture in the game; polled while any is being made. */
export function useFineTunes(imageId: string) {
  return useQuery({
    queryKey: ['image-fine-tunes', imageId],
    queryFn: () =>
      getJson<FineTunesView | ProjectFailure>(
        `/api/images/${encodeURIComponent(imageId)}/fine-tunes`,
      ),
    refetchInterval: (query) => {
      const view = query.state.data
      return view && 'making' in view && view.making.length > 0 ? 1000 : false
    },
  })
}

/**
 * A change to an image's fine-tunes: sends `request` to the fine-tune route, answers what the
 * server said (a refusal is an answer, not an error), then reloads the fine-tunes. `used` also
 * reloads what a used fine-tune changes: the takes, the patches and the project.
 */
function useFineTuneChange<Input, Answer>(
  imageId: string,
  request: (input: Input) => { path: string; method: string; body?: unknown },
  used = false,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: Input) => {
      const { path, method, body } = request(input)
      const response = await fetch(`/api/images/${encodeURIComponent(imageId)}/fine-tunes${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`changing the fine-tunes answered ${response.status}`)
      }
      return (await response.json()) as Answer
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['image-fine-tunes', imageId] }),
        ...(used
          ? [
              client.invalidateQueries({ queryKey: ['image-takes', imageId] }),
              client.invalidateQueries({ queryKey: ['image-patches', imageId] }),
              client.invalidateQueries({ queryKey: ['image-making'] }),
              client.invalidateQueries({ queryKey: ['project'] }),
            ]
          : []),
      ]),
  })
}

/** Asks for fine-tunes of the picture in the game: new ones, or a failed one again. */
export function useMakeFineTunes(imageId: string) {
  return useFineTuneChange<FineTuneRequest, NonNullable<FineTuneAnswer>>(imageId, (body) => ({
    path: '',
    method: 'POST',
    body,
  }))
}

/** Stops the fine-tunes that are waiting or being made. */
export function useStopFineTunes(imageId: string) {
  return useFineTuneChange<void, unknown>(imageId, () => ({ path: '/stop', method: 'POST' }))
}

/** Takes a fine-tune off the board. */
export function useDropFineTune(imageId: string) {
  return useFineTuneChange<number, NonNullable<FineTuneAnswer>>(imageId, (n) => ({
    path: `/${n}`,
    method: 'DELETE',
  }))
}

/** Records that a fine-tune has been laid over the picture once. */
export function useMarkFineTuneSeen(imageId: string) {
  return useFineTuneChange<number, NonNullable<FineTuneAnswer>>(imageId, (n) => ({
    path: `/${n}/seen`,
    method: 'POST',
  }))
}

/** Uses a fine-tune: it becomes the image's next take, chosen. */
export function useUseFineTune(imageId: string) {
  return useFineTuneChange<number, UseFineTuneAnswer>(
    imageId,
    (n) => ({ path: '/use', method: 'POST', body: { n } }),
    true,
  )
}

/** Where images keep their takes' queries, for the hooks every medium with takes shares. */
const imageTakeMedium: TakeMedium = {
  base: (id) => `/api/images/${encodeURIComponent(id)}`,
  takesKey: 'image-takes',
  makingKey: 'image-making',
  // The patches lie on the image's chosen take, and the fine-tunes on the picture in the game.
  alsoStale: (id) => [
    ['image-patches', id],
    ['image-fine-tunes', id],
  ],
}

/** Asks for takes of an image (new ones, or a failed one again). */
export function useMakeImageTakes(imageId: string) {
  return useTakeAction<ImageMakeRequest, NonNullable<ImageTakesAnswer>>(
    imageTakeMedium,
    imageId,
    (a) => a.make,
  )
}

/** Makes a take the image the game uses. */
export function useChooseImageTake(imageId: string) {
  return useImageTakesChange<number>(
    imageId,
    (n) => ({ path: '/choose', method: 'POST', body: { n } }),
    true,
  )
}

/** Takes the image's chosen take back (its picture is deleted from the game). */
export function useUnchooseImageTake(imageId: string) {
  return useTakeAction<void, NonNullable<ImageTakesAnswer>>(
    imageTakeMedium,
    imageId,
    (a) => a.unchoose,
  )
}

/**
 * Accepts an image's changed words or style: its chosen take is kept and counts as made from them.
 */
export function useAcceptImageChange(imageId: string) {
  return useTakeAction<void, NonNullable<ImageTakesAnswer>>(
    imageTakeMedium,
    imageId,
    (a) => a.accept,
  )
}

/** Takes a take off the image's board. */
export function useDropImageTake(imageId: string) {
  return useImageTakesChange<number>(
    imageId,
    (n) => ({ path: `/takes/${n}`, method: 'DELETE' }),
    // The patches chosen on the dropped take can no longer be brought back: the rows say so.
    true,
  )
}

/** Stops the image's takes (the one being made and those waiting). */
export function useStopImageTakes(imageId: string) {
  return useTakeAction<void, NonNullable<ImageTakesAnswer>>(imageTakeMedium, imageId, (a) => a.stop)
}

/** Records that a take has been shown on the right once. */
export function useMarkImageTakeSeen(imageId: string) {
  return useImageTakesChange<number>(
    imageId,
    (n) => ({ path: `/takes/${n}/seen`, method: 'POST' }),
    false,
  )
}
