// LinkedIn's state machines and state rulings (docs/contributing/architecture.md, "The semantics layer"): a post's
// lifecycle, an image's and a video's processing status, and an access token's invalidation; per resource, the
// candidates that are not state, each with its reason. The manifest takes each resource's whole.
import type { StateField } from '@volter/world-core';

const SCHEMA = 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema?view=li-lms-2026-09';
const IMAGES = 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09';
const VIDEOS = 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09';
const OAUTH = 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow';

/** A post's `lifecycleState`: "PUBLISHED is the only accepted field during creation", so every create starts there; a
 *  post whose video or image is still processing is answered as "submitted for publishing but is not yet ready for
 *  rendering" (PUBLISH_REQUESTED), and "The content will be published asynchronously once the processing has
 *  successfully completed": LinkedIn's own move to PUBLISHED, or to PUBLISH_FAILED when the media's processing fails
 *  (the post-api-schema page). DRAFT is a state only LinkedIn's own composer makes: no operation of the Posts API
 *  creates a draft, so no move here reaches it. */
const postLifecycle: StateField = {
  initial: 'PUBLISHED',
  transitions: [
    { operation: 'createPost', from: ['PUBLISHED'], to: 'PUBLISH_REQUESTED', source: SCHEMA },
    { actor: 'vendor', from: ['PUBLISH_REQUESTED'], to: 'PUBLISHED', source: SCHEMA },
    { actor: 'vendor', from: ['PUBLISH_REQUESTED'], to: 'PUBLISH_FAILED', source: SCHEMA },
  ],
};

/** An image's `status`: WAITING_UPLOAD until the bytes are PUT to its upload URL, then PROCESSING, then AVAILABLE, or
 *  PROCESSING_FAILED for a file LinkedIn will not take ("unsupported file format", more than 36,152,320 pixels). The
 *  move out of PROCESSING is LinkedIn's, as time passes. Where the documentation stops: how long processing takes is
 *  not documented; the twin's is a second. A second upload to an image that already has its bytes is the documented
 *  400 for an invalid request; the words are the twin's. */
const imageStatus: StateField = {
  initial: 'WAITING_UPLOAD',
  transitions: [
    { operation: 'uploadImage', from: ['WAITING_UPLOAD'], to: 'PROCESSING', source: IMAGES },
    { operation: 'uploadImage', from: ['PROCESSING', 'AVAILABLE', 'PROCESSING_FAILED'], refusal: { status: 400, code: 'INVALID_VALUE_FOR_FIELD', message: 'Image {id} has already been uploaded' }, source: IMAGES },
    { actor: 'time', from: ['PROCESSING'], to: 'AVAILABLE', source: IMAGES },
    { actor: 'time', from: ['PROCESSING'], to: 'PROCESSING_FAILED', source: IMAGES },
  ],
};

/** A video's `status`: WAITING_UPLOAD while its parts are PUT, PROCESSING once finalizeUpload links them, then
 *  AVAILABLE, or PROCESSING_FAILED for a file that is not an MP4 or whose length is outside three seconds to 30
 *  minutes. A video is finalized once. Where the documentation stops: processing's length is the twin's (three
 *  seconds), and the refusal's words are the twin's, in the documented 400 for an invalid request. */
const videoStatus: StateField = {
  initial: 'WAITING_UPLOAD',
  transitions: [
    { operation: 'finalizeVideoUpload', from: ['WAITING_UPLOAD'], to: 'PROCESSING', source: VIDEOS },
    { operation: 'finalizeVideoUpload', from: ['PROCESSING', 'AVAILABLE', 'PROCESSING_FAILED'], refusal: { status: 400, code: 'INVALID_VALUE_FOR_FIELD', message: 'Video {id} has already been finalized' }, source: VIDEOS },
    { actor: 'time', from: ['PROCESSING'], to: 'AVAILABLE', source: VIDEOS },
    { actor: 'time', from: ['PROCESSING'], to: 'PROCESSING_FAILED', source: VIDEOS },
  ],
};

/** An access token's `invalidated`: "If you request a different scope than the previously granted scope, all the
 *  previous access tokens are invalidated" (the Authorization Code Flow page): the member's act on LinkedIn's token
 *  generator or consent screen. Its expiry is not a state: the token's `expires_at` against the World clock. */
const tokenInvalidated: StateField = {
  initial: false,
  transitions: [{ actor: 'external', from: ['false'], to: 'true', source: OAUTH }],
};

export const states = {
  Post: {
    state: { lifecycleState: postLifecycle },
    // visibility is chosen at create and never moved by the Posts API (its update takes commentary, the call to action,
    // the landing page, lifecycleState and adContext); a call to action is a label, not a state
    notState: ['visibility', 'contentCallToActionLabel'],
  },
  Image: { state: { status: imageStatus } },
  Video: { state: { status: videoStatus } },
  // an organization's type, primary type and size are the page's descriptions of itself, set on its page, never moved
  Organization: { notState: ['organizationType', 'primaryOrganizationType', 'staffCountRange'] },
  _access_token: { state: { invalidated: tokenInvalidated } },
};

