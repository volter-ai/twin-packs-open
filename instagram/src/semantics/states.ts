// Instagram's state machines and state rulings, each transition cited (architecture, "State"): an IG Container's
// publishing status. A media's flags (comments enabled, shared to feed, its AI label) and its types are what its owner
// set or what it is, not a lifecycle.
import type { StateField } from '@volter/world-core';

const CONTAINER = 'https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container';
const ERRORS = 'https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes';

/** An IG Container's `status_code`: made IN_PROGRESS while Instagram fetches its media, FINISHED or ERROR when the
 *  fetch ends, PUBLISHED by media_publish, EXPIRED 24 hours after it was made when still unpublished. Each refusal of
 *  media_publish is its own transition, by the state it meets (error codes 9007 and 24; their subcodes 2207027 and
 *  2207008 are added by the handler, the refusal's body naming no subcode). */
const containerStatus: StateField = {
  initial: 'IN_PROGRESS',
  transitions: [
    { actor: 'vendor', from: ['IN_PROGRESS'], to: 'FINISHED', source: `${CONTAINER} "The container and its media object are ready to be published."` },
    { actor: 'vendor', from: ['IN_PROGRESS'], to: 'ERROR', source: `${CONTAINER} "The container failed to complete the publishing process."` },
    { actor: 'vendor', from: ['FINISHED'], to: 'EXPIRED', source: `${CONTAINER} "The container was not published within 24 hours and has expired."` },
    { operation: 'publishUserMedia', from: ['FINISHED'], to: 'PUBLISHED', source: `${CONTAINER} "media object has been published."` },
    { operation: 'publishUserMedia', from: ['IN_PROGRESS'], refusal: { status: 400, code: 9007, message: 'The media is not ready for publishing, please wait for a moment' }, source: `${ERRORS} "The media is not ready for publishing, please wait for a moment"` },
    { operation: 'publishUserMedia', from: ['ERROR', 'EXPIRED', 'PUBLISHED'], refusal: { status: 400, code: 24, message: 'The media builder with creation id = {id} does not exist or has been expired.' }, source: `${ERRORS} "does not exist or has been expired."` },
  ],
};

const container = { state: { status_code: containerStatus }, notState: ['status'] };
const media = { notState: ['media_type', 'media_product_type', 'is_comment_enabled', 'is_shared_to_feed', 'is_ai_generated'] };

export const states = { container, media };
