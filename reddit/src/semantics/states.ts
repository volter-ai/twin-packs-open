// Reddit's state machines, each move cited: a post's deletion and removal, an invitation to moderate and an upload lease's file.
import type { StateField } from '@volter/world-core';

const DEL = 'spec:POST_api_del "Delete a Link or Comment."';
const REMOVE = 'spec:POST_api_remove "it will be removed from all subreddit listings"';
const INVITE = 'spec:POST_r_subreddit_api_friend "moderator_invite: modothers"';
const ACCEPT = 'spec:POST_r_subreddit_api_accept_moderator_invite "The authenticated user must have been invited to moderate the subreddit"';
const NO_INVITE = 'https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubredditModeration.test_accept_invite__no_invite.json "there is no pending invite for that subreddit"';
// the refusal's words are r2's for a url it cannot take (BAD_URL); the rule that a lease whose file never arrived is no
// media is where the documentation stops (the comment on assetUploaded)
const BAD_URL = 'https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/errors.py "you should check that url"';
const LEASE = 'https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/praw/models/media.py';

/** A post is live until its author deletes it (POST /api/del: "Delete a Link or Comment."; Reddit's own server marks it
 *  `_deleted` and takes it from its listings, r2's POST_del) or a moderator of its community removes it (POST /api/remove:
 *  "it will be removed from all subreddit listings"). A deleted post stays readable by its id, its author and body shown
 *  as [deleted] and `removed_by_category` "deleted"; a removed one is readable by its id with `removed_by_category`
 *  "moderator". Deleting or removing it again answers as the first did and is no move (r2's POST_del sets `_deleted`
 *  whatever it was; its POST_remove returns at once for a deleted thing): the handlers ask the machine only of a live
 *  post. Not made by the twin: Reddit's own removal (`removed_by_category` "reddit"), which no step of this pack's demand
 *  reaches. */
const linkDeleted: StateField = {
  initial: 'live',
  derive: [{ state: 'live', when: { absent: true } }, { state: 'deleted', when: { equals: 'deleted' } }, { state: 'removed', when: { equals: 'moderator' } }],
  transitions: [
    { operation: 'POST_api_del', from: ['live'], to: 'deleted', effects: { removed_by_category: { value: 'deleted' } }, source: DEL },
    { operation: 'POST_api_remove', from: ['live'], to: 'removed', effects: { removed_by_category: { value: 'moderator' } }, source: REMOVE },
  ],
};

/** An account's invitation to moderate a community: a moderator of it invites them (POST /r/{subreddit}/api/friend,
 *  type moderator_invite; a request for type moderator makes one too, r2's POST_friend), and they accept it (POST
 *  /r/{subreddit}/api/accept_moderator_invite), which takes the invitation and makes them a moderator with the
 *  permissions it named. Inviting again replaces the invitation's permissions. Accepting with no invitation is refused
 *  with NO_INVITE_FOUND (recorded). Not made by the twin: a moderator's removal of an invitation (unfriend,
 *  moderator_invite) and an invitee's decline, which no step of this pack's demand reaches. */
const moderatorInvite: StateField = {
  initial: false,
  transitions: [
    { operation: 'POST_r_subreddit_api_friend', from: ['false', 'true'], to: 'true', source: INVITE },
    { operation: 'POST_r_subreddit_api_accept_moderator_invite', from: ['true'], to: 'false', effects: { moderator: { value: true } }, source: ACCEPT },
    { operation: 'POST_r_subreddit_api_accept_moderator_invite', from: ['false'], refusal: { status: 200, code: 'NO_INVITE_FOUND', message: 'there is no pending invite for that subreddit' }, source: NO_INVITE },
  ],
};

/** An upload lease's file: the lease is answered `incomplete` (its asset's processing_state, as recorded), the file
 *  arrives when the client posts the lease's S3 form (PRAW's _lease_and_post: the lease, then the file to S3 under its
 *  fields), and a submit names the uploaded file's URL. A lease whose file never arrived is no media: a submit naming
 *  it is refused (Where the documentation stops: Reddit documents no answer for a submit naming an upload that never
 *  arrived; the twin answers its documented error for a url, BAD_URL). Posting the form again replaces the file (S3 keeps
 *  the last object under a key). Not made by the twin: Reddit's transcoding of a video after submit, which it reports on
 *  the asset's websocket; the twin serves the file as uploaded. */
const assetUploaded: StateField = {
  initial: false,
  transitions: [
    { actor: 'external', from: ['false', 'true'], to: 'true', source: LEASE },
    // a lease whose file never arrived is refused (a refusal with no `to` refuses where it stands)
    { operation: 'POST_api_submit', from: ['false'], refusal: { status: 200, code: 'BAD_URL', message: 'you should check that url' }, source: BAD_URL },
  ],
};

export const states = {
  link: { state: { removed_by_category: linkDeleted } },
  _membership: { state: { moderator_invite: moderatorInvite } },
  asset: { state: { _uploaded: assetUploaded } },
};
