import type { DerivedManifest } from '@volter/world-core';
export const manifest: DerivedManifest = {
  // the vendor's one store: a generated image's file is minted as the openai unit mints it (../../src/manifest.ts)
  vendor: 'openai', service: 'openai', ids: { template: '{prefix}-{ksuid:24}' }, time: 'unix',
  body: { json: 'always' }, error: { error: { message: '{message}', type: 'invalid_request_error', param: null, code: null } },
  notFound: { status: 404, message: 'No image available at this URL.' },
  gap: { status: 404, message: 'No image available at this URL.' },
  readOnly: { status: 403, message: 'This World is read only.' }, deleted: {},
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 20, max: 100 } },
  // source: https://raw.githubusercontent.com/openai/openai-cookbook/0eac1447d4e24d06e47c459ca5e98f248b9413cf/examples/dalle/Image_generations_edits_and_variations_with_DALL-E.ipynb "img-ced13hkOk3lXkccQgW1fAQjm.png"
  resources: { _generated_image: { storedAs: '_generated_image', idPrefix: 'img' } },
  discovery: { twinOf: 'The opaque generated image download URL', stores: 'image bytes made by the parent API' },
};
