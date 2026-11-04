// YouTube's state machines and state rulings, each transition cited (architecture, "State"): a video's upload status,
// a live broadcast's life cycle, a live stream's status and a comment's moderation status.
import type { StateField } from '@volter/world-core';

const VIDEOS = 'https://developers.google.com/youtube/v3/docs/videos';
const BROADCASTS = 'https://developers.google.com/youtube/v3/live/docs/liveBroadcasts';
const TRANSITION = 'https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition';
const BIND = 'https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/bind';
const STREAMS = 'https://developers.google.com/youtube/v3/live/docs/liveStreams';
const MODERATION = 'https://developers.google.com/youtube/v3/docs/comments/setModerationStatus';

/** A video's `status.uploadStatus`: the upload's last byte makes it `uploaded`, and YouTube then processes it, or fails
 *  it (an empty file). Not made by the twin: `rejected` (a claim, a policy) and `deleted` (videos.delete is the gap). */
export const uploadStatus: StateField = {
  initial: 'uploaded',
  transitions: [
    { actor: 'vendor', from: ['uploaded'], to: 'processed', source: `${VIDEOS} "The status of the uploaded video."` },
    { actor: 'vendor', from: ['uploaded'], to: 'failed', source: `${VIDEOS} "This value explains why a video failed to upload. This property is only present if the uploadStatus property indicates that the upload failed."` },
  ],
};

/** A broadcast's `status.lifeCycleStatus`: `created` until a stream is bound (`ready`), then through testing to live
 *  and complete, each through liveBroadcasts.transition, YouTube finishing the moves it starts (`testStarting`,
 *  `liveStarting`). A transition the machine has no move for is invalidTransition; whether the target is already
 *  reached (redundantTransition), the stream is active and the monitor stream allows a testing stage are the handler's
 *  checks before it asks the machine. Not made by the twin: `revoked` (an administrator's action). */
export const lifeCycleStatus: StateField = {
  initial: 'created',
  transitions: [
    { operation: 'youtube.liveBroadcasts.bind', from: ['created', 'ready'], to: 'ready', source: `${BROADCASTS} "The broadcast settings are complete and the broadcast can transition to a live or testing status."` },
    { operation: 'youtube.liveBroadcasts.bind', from: ['ready'], to: 'created', source: `${BIND} "If this parameter is omitted, the API will remove any existing binding between the broadcast and a video stream."` },
    { operation: 'youtube.liveBroadcasts.bind', from: ['testStarting', 'testing', 'liveStarting', 'live', 'complete', 'revoked'], refusal: { status: 403, code: 'liveBroadcastBindingNotAllowed', message: 'The current status of the live broadcast does not allow it to be bound to a stream.' }, source: `${BIND} "The current status of the live broadcast does not allow it to be bound to a stream."` },
    { operation: 'youtube.liveBroadcasts.transition', from: ['ready'], to: 'testStarting', source: `${TRANSITION} "Start testing the broadcast. YouTube transmits video to the broadcast's monitor stream."` },
    { operation: 'youtube.liveBroadcasts.transition', from: ['ready', 'testing'], to: 'liveStarting', source: `${TRANSITION} "The broadcast is visible to its audience. YouTube transmits video to the broadcast's monitor stream and its broadcast stream."` },
    { operation: 'youtube.liveBroadcasts.transition', from: ['testing', 'live'], to: 'complete', source: `${TRANSITION} "The broadcast is over. YouTube stops transmitting video."` },
    { operation: 'youtube.liveBroadcasts.transition', from: ['created', 'ready', 'testStarting', 'testing', 'liveStarting', 'live', 'complete', 'revoked'], refusal: { status: 403, code: 'invalidTransition', message: "The live broadcast can't transition from its current status to the requested status." }, source: `${TRANSITION} "The live broadcast can't transition from its current status to the requested status."` },
    { actor: 'vendor', from: ['testStarting'], to: 'testing', source: `${BROADCASTS} "The broadcast is in the process of transitioning to testing status."` },
    { actor: 'vendor', from: ['liveStarting'], to: 'live', source: `${BROADCASTS} "The broadcast is in the process of transitioning to live status."` },
    // a broadcast set to start and stop with its stream, as the encoder starts and stops publishing
    { actor: 'vendor', from: ['ready', 'testing'], to: 'live', source: `${BROADCASTS} "Indicates whether this broadcast should start automatically when you start streaming video on the bound live stream ."` },
    { actor: 'vendor', from: ['live'], to: 'complete', source: `${BROADCASTS} "Indicates whether this broadcast should stop automatically around one minute after the channel"` },
  ],
};

/** A stream's `status.streamStatus`: `ready` once made (its insert names the CDN settings it requires), `active` while
 *  an encoder publishes to its stream name and `inactive` once it stops. Not made by the twin: `created` (a stream
 *  without valid CDN settings, which the insert refuses) and `error`. */
export const streamStatus: StateField = {
  initial: 'ready',
  transitions: [
    { actor: 'external', from: ['ready', 'inactive'], to: 'active', source: `${STREAMS} "The stream is in active state which means the user is receiving data via the stream."` },
    { actor: 'external', from: ['active'], to: 'inactive', source: `${STREAMS} "The stream is in inactive state which means the user is not receiving data via the stream."` },
  ],
};

/** A comment's `snippet.moderationStatus`, set by the channel's owner through comments.setModerationStatus. */
export const moderationStatus: StateField = {
  initial: 'published',
  transitions: [
    { operation: 'youtube.comments.setModerationStatus', from: ['published', 'heldForReview', 'likelySpam'], to: 'heldForReview', source: `${MODERATION} "Marks a comment as awaiting review by a moderator."` },
    { operation: 'youtube.comments.setModerationStatus', from: ['heldForReview', 'likelySpam'], to: 'published', source: `${MODERATION} "Clears a comment for public display."` },
    { operation: 'youtube.comments.setModerationStatus', from: ['published', 'heldForReview', 'likelySpam'], to: 'rejected', source: `${MODERATION} "Rejects a comment as being unfit for display."` },
    // Where the documentation stops: the page names no error for publishing a rejected comment; the twin answers the
    // page's processingFailure, its error for input the method cannot apply.
    { operation: 'youtube.comments.setModerationStatus', from: ['rejected'], refusal: { status: 400, code: 'processingFailure', message: 'The API server failed to successfully process the request. While this can be a transient error, it usually indicates that the request\'s input is invalid.' }, source: `${MODERATION} "You can't change the moderation status of a rejected comment to published"` },
    // a comment written by an author the channel banned is rejected as it arrives
    { actor: 'vendor', from: ['published'], to: 'rejected', source: `${MODERATION} "The banAuthor parameter lets you indicate that you want to automatically reject any additional comments written by the comment's author."` },
  ],
};

export const Video = { state: { 'status.uploadStatus': uploadStatus }, notState: ['status.privacyStatus', 'status.license', 'status.failureReason', 'status.rejectionReason'] };
export const LiveBroadcast = { state: { 'status.lifeCycleStatus': lifeCycleStatus }, notState: ['status.privacyStatus', 'status.recordingStatus'] };
export const LiveStream = { state: { 'status.streamStatus': streamStatus }, notState: ['status.healthStatus.status'] };
export const Comment = { state: { 'snippet.moderationStatus': moderationStatus }, notState: ['snippet.viewerRating'] };

export const states = { Video, LiveBroadcast, LiveStream, Comment };
