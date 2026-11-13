import { describe, expect, it } from 'bun:test'
import {
  judgeHubDownload,
  MFLUX_NEEDS,
  WEIGHTS_ONLY_NEEDS,
  type HubCacheView,
  type HubNeeds,
} from './hubDownload'

/** A cache with one finished weights file, and these changes. */
const cache = (change: Partial<HubCacheView> = {}): HubCacheView => ({
  files: ['model.safetensors'],
  broken: false,
  shardIndexes: [],
  modelIndexes: [],
  unfinishedBlob: false,
  ...change,
})

/** The files of a part that is finished, in a listing-less cache. */
const finishedPart = (name: string) => [`${name}/config.json`, `${name}/model.safetensors`]

/** The repository listing of a model of four parts, and the files in the snapshot for each. */
const TOKENIZER = ['merges.txt', 'tokenizer.json', 'vocab.json'].map((f) => `tokenizer/${f}`)
const WEIGHTED = ['text_encoder', 'transformer', 'vae'].flatMap((n) => [
  `${n}/config.json`,
  `${n}/diffusion_pytorch_model.safetensors`,
])
const SNAPSHOT = [...WEIGHTED, ...TOKENIZER]
const LISTING = [
  'README.md',
  'flux.safetensors',
  'scheduler/scheduler_config.json',
  'transformer/README.md',
  ...SNAPSHOT,
]

interface Row {
  state: string
  view: HubCacheView | undefined
  needs?: HubNeeds
  expected: 'absent' | 'partial' | 'whole'
}

const ROWS: Row[] = [
  { state: 'no folder', view: undefined, expected: 'absent' },
  { state: 'weights, nothing unfinished', view: cache(), expected: 'whole' },
  { state: 'no weights', view: cache({ files: [] }), expected: 'partial' },
  { state: 'a link to a missing blob', view: cache({ broken: true }), expected: 'partial' },
  {
    state: 'an unfinished blob with no finished one beside it',
    view: cache({ unfinishedBlob: true }),
    expected: 'partial',
  },
  {
    state: 'an unfinished blob, vouched for by a shard index',
    view: cache({
      files: ['a.safetensors.index.json', 'a-00001-of-00001.safetensors'],
      shardIndexes: [
        { path: 'a.safetensors.index.json', shards: ['a-00001-of-00001.safetensors'] },
      ],
      unfinishedBlob: true,
    }),
    expected: 'whole',
  },
  {
    state: 'a shard the index names is missing',
    view: cache({
      files: ['a.safetensors.index.json', 'a-00001-of-00002.safetensors'],
      shardIndexes: [
        {
          path: 'a.safetensors.index.json',
          shards: ['a-00001-of-00002.safetensors', 'a-00002-of-00002.safetensors'],
        },
      ],
    }),
    expected: 'partial',
  },
  {
    state: 'a shard index that cannot be read',
    view: cache({
      files: ['a.safetensors.index.json', 'x.safetensors'],
      shardIndexes: [{ path: 'a.safetensors.index.json', shards: null }],
    }),
    expected: 'partial',
  },
  {
    state: 'a part with shards and no index yet',
    view: cache({
      files: [...finishedPart('text_encoder'), 'transformer/model-00001-of-00002.safetensors'],
    }),
    expected: 'partial',
  },
  {
    state: 'a part with only its config',
    view: cache({ files: [...finishedPart('text_encoder'), 'vae/config.json'] }),
    expected: 'partial',
  },
  {
    state: 'a part model_index.json lists with no files yet',
    view: cache({
      files: [...finishedPart('text_encoder'), 'model_index.json'],
      modelIndexes: [{ folder: '', parts: ['text_encoder', 'vae'] }],
    }),
    expected: 'partial',
  },
  {
    state: 'every part model_index.json lists is there',
    view: cache({
      files: [...finishedPart('text_encoder'), ...finishedPart('vae'), 'model_index.json'],
      modelIndexes: [{ folder: '', parts: ['text_encoder', 'vae'] }],
    }),
    expected: 'whole',
  },
  {
    state: 'a model_index.json that cannot be read',
    view: cache({
      files: ['model_index.json', 'model.safetensors'],
      modelIndexes: [{ folder: '', parts: null }],
    }),
    expected: 'partial',
  },
  {
    state: 'a listing, and every file the model fetches there',
    view: cache({ files: SNAPSHOT, listing: LISTING }),
    needs: MFLUX_NEEDS,
    expected: 'whole',
  },
  {
    state: 'a listing, and a part with weights has lost its folder',
    view: cache({ files: SNAPSHOT.filter((p) => !p.startsWith('vae/')), listing: LISTING }),
    needs: MFLUX_NEEDS,
    expected: 'partial',
  },
  {
    state: 'a listing, and the tokenizer has lost some files',
    view: cache({ files: SNAPSHOT.filter((p) => p !== 'tokenizer/vocab.json'), listing: LISTING }),
    needs: MFLUX_NEEDS,
    expected: 'partial',
  },
  {
    state: 'a listing, and a part with weights has lost its config',
    view: cache({ files: SNAPSHOT.filter((p) => p !== 'vae/config.json'), listing: LISTING }),
    needs: MFLUX_NEEDS,
    expected: 'partial',
  },
  {
    state: 'a listing naming a file this model never fetches',
    view: cache({ files: SNAPSHOT, listing: [...LISTING, 'vae/extra.json'] }),
    needs: WEIGHTS_ONLY_NEEDS,
    expected: 'whole',
  },
  {
    state: 'no listing, so the listing says nothing',
    view: cache({ files: SNAPSHOT.filter((p) => !p.startsWith('vae/')) }),
    needs: MFLUX_NEEDS,
    expected: 'whole',
  },
]

describe('judgeHubDownload', () => {
  it.each(ROWS)('$state: $expected', ({ view, needs, expected }) => {
    expect(judgeHubDownload(view, needs ?? WEIGHTS_ONLY_NEEDS)).toBe(expected)
  })
})
