// The open lane's manifest: the vendor facts its spec (../spec, written from developers.tiktok.com) does not carry.
// Served is what the customer life walks (../../journeys/demand.json, ../../journeys/decisions.json): the authorize page, the token,
// user info, creator info, the three inits, the upload host's PUT, the post status, and the video list and query;
// revoking and cancelling are `unmodeled`.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'tiktok',
  // the vendor's one store: the business lane reads the same people and apps
  service: 'tiktok',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'unix',
  // "Any code other than ok indicates the request did not succeed" (every reference page): {data, error: {code,
  // message, log_id}}
  // source: https://developers.tiktok.com/doc/tiktok-api-v2-error-handling "error responses include error codes represented as readable strings with detailed error messages and a log ID."
  error: { data: {}, error: { code: '{code}', message: '{message}', log_id: '{id}' } },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 400, code: 'invalid_params', message: "One or more fields in request is invalid. Please refer to the error message for details." },
  // source: https://developers.tiktok.com/doc/tiktok-api-v2-error-handling "One or more fields in request is invalid. Please refer to the error message for details."
  // Where documentation stops: token errors do not establish an authentication gate before unknown-route resolution.
  gap: { status: 400, code: 'invalid_params', message: "One or more fields in request is invalid. Please refer to the error message for details." },
  deleted: {},
  resources: {
    _developer: { idPrefix: '', ids: '{uuid}' },
    _credential_issue: { idPrefix: '', ids: '{uuid}' },
    // a post: its status answer, with what the twin keeps beside it (its creator, its upload, its media)
    // a post's processing status, read back by its publish_id through status/fetch; the store's posts are both APIs' (the
    // business lane's are read only with a business_id the World does not keep), so a read by id here would answer the
    // business lane's as gone
    publish: { idPrefix: '', ...states.publish, refresh: { none: "a publish is either API's (one store for the open and business lanes): status/fetch reads only the open platform's by publish_id and would answer a business publish as gone, and the business lane's status read needs a business_id the World keeps for none" } },
    // a video as the Video Object answers it
    // the root's own videos, newest first, by the list's cursor until it says no more follow; another person's, or a business
    // account's, are not listed, so the type is not read whole
    // source: https://developers.tiktok.com/doc/tiktok-api-v2-video-list "the cursor value is a"
    // source: https://developers.tiktok.com/doc/tiktok-api-v2-video-list "Default is 10. Maximum is 20."
    video: { idPrefix: '', refresh: { list: 'videoList', items: 'data.videos', next: 'data.cursor', cursor: 'cursor', more: 'data.has_more', complete: false,
      query: { fields: 'id,create_time,cover_image_url,share_url,video_description,duration,height,width,title,embed_html,embed_link,like_count,comment_count,share_count,view_count,is_aigc' } } },
    _app: { idPrefix: 'app_', ids: '{prefix}{n}' },
    _person: { idPrefix: 'person_', ids: '{prefix}{n}' },
    _location: { idPrefix: '', ids: '{hex:24}' },
    _track: { idPrefix: '', ids: '{n}' },
    _code: { idPrefix: 'code_', ids: '{prefix}{n}' },
    _access_token: { idPrefix: 'act_', ids: '{prefix}{n}' },
    _refresh_token: { idPrefix: 'rft_', ids: '{prefix}{n}' },
    _seq_publish: { idPrefix: '', ids: '{n}' },
    _seq_video: { idPrefix: '', ids: '{n}' },
  },
  unmodeled: ['oauthRevoke', 'publishCancel'],
  screens: [{
    id: 'authorize', kind: 'flow', host: 'www.tiktok.com', path: '/v2/auth/authorize/',
    demand: 'an app connects a TikTok account: it sends the person here with its client key, redirect URI, state and scopes', status: 'done',
    controls: ['Log in', 'Authorize', 'Cancel'], source: 'https://developers.tiktok.com/doc/login-kit-web',
  }],
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World application's app on the developer site: its client key and secret" },
    { id: 'apps', method: 'POST', path: '/_twin/apps', note: "{ client_key?, redirect_uris?, url_properties?, business_redirect_uris? }: synthetic dashboard configuration; client_key selects an existing open app, otherwise the World's selected app; redirect URIs and verified URL properties stand in for Login Kit and developer-site settings" },
    { id: 'people', method: 'POST', path: '/_twin/people', note: '{ username, display_name, password, follower_count?, following_count?, likes_count?, max_video_post_duration_sec?, private? }: a TikTok account' },
    { id: 'videoStats', method: 'POST', path: '/_twin/videos/{id}/stats', note: "{ view_count?, like_count?, comment_count?, share_count? }: a video's audience (TikTok's viewers)" },
    { id: 'media', method: 'GET', path: '/_twin/media/{name}', note: 'a placeholder image (an avatar, a cover)' },
    { id: 'locations', method: 'POST', path: '/_twin/locations', note: '{ location_name, location_address? }: a location tag TikTok holds' },
    { id: 'tracks', method: 'POST', path: '/_twin/tracks', note: '{ name, artist, genre?, duration? }: a track of the Commercial Music Library' },
  ],
  discovery: {
    twinOf: "TikTok's open platform: the authorize page and tokens, posting videos and photos with their upload host and status, and a user's profile, stats and videos",
    stores: 'apps, people, codes and tokens (by their SHA-256), posts (their uploads as blobs) and videos',
  },
};
