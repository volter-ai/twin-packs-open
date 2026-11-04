// TikTok's state machines, shared by its lanes (architecture, "State"; a lane imports its vendor's states): a post's
// status, whether it came through the Content Posting API (the open lane) or the API for Business (the business lane).
// Its transitions name no operation: each is the vendor's move whichever lane's call it follows.
import type { StateField } from '@volter/world-core';

const STATUS = 'https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status';

/** A post's `status`: an upload begins PROCESSING_UPLOAD ("Indicates that the upload is in process"), a pull from URL
 *  PROCESSING_DOWNLOAD (written so at the post's start); the vendor finishes it when the last chunk arrives or the pull
 *  ends. Not made by the twin: a post the creator makes from an inbox draft (PUBLISH_COMPLETE after SEND_TO_USER_INBOX,
 *  the creator's move in the app), a moderation that fails a post, and a cancelled pull (the cancel is unmodeled). */
const publishStatus: StateField = {
  initial: 'PROCESSING_UPLOAD',
  transitions: [
    { actor: 'vendor', from: ['PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD'], to: 'PUBLISH_COMPLETE', source: `${STATUS} "it indicates that the content has been posted"` },
    { actor: 'vendor', from: ['PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD'], to: 'SEND_TO_USER_INBOX', source: `${STATUS} "Indicates that a notification has been sent to creator's inbox to complete the draft post using TikTok's editing flow."` },
    { actor: 'vendor', from: ['PROCESSING_DOWNLOAD'], to: 'FAILED', source: `${STATUS} "Indicates that an error has occurred and the entire process has failed."` },
  ],
};

export const publish = { state: { status: publishStatus }, notState: ['fail_reason', 'reason'] };

export const states = { publish };
