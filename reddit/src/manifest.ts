// Reddit's manifest: the vendor facts its spec does not carry (twin-world's architecture, "Protocol 3"). The surface is
// generated (./generated/surface.gen.json) from ../spec/openapi.json, which is written from Reddit's API page
// (https://www.reddit.com/dev/api: Reddit publishes no OpenAPI document), corrected by ../spec/patches.json with the token
// endpoint the OAuth2 wiki documents, the media lease Reddit's own clients call, and the answers Reddit gives (provenance
// in ../spec/SOURCE.md).
//
// EVERY SERVED OPERATION IS A HANDLER (./semantics/index.ts): Reddit answers a thing inside `{kind, data}`, a listing
// inside a Listing, a write with `{json: {errors}}`, and a submit by its kind; nothing is the plain store the core serves.
// An operation no handler serves is the gap: Reddit's 404, `{"message": "Not Found", "error": 404}`.
//
// THE CALLER (./semantics/around.ts) is a bearer token on oauth.reddit.com (the token endpoint's, or the World
// application's from the credential door), or a person's `reddit_session` cookie and its modhash on www.reddit.com,
// where reddit.com's own pages call the same API; each answer carries the client's rate window (x-ratelimit-*).
//
// THE SCREENS are reddit.com's pages, signed in by the session cookie: the sign-in, a community's listing (Hot, New),
// Create Post (Text, Images & Video, Link), a post's comments page with its comment box, and reddit.com's move to
// www.reddit.com; and the hosts Reddit keeps media on: the S3 buckets a lease's form is posted to, and v.redd.it,
// i.redd.it, preview.redd.it, external-preview.redd.it and b.thumbs.redditmedia.com, which serve what was uploaded.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

const DEV_API = 'https://www.reddit.com/dev/api';

export const manifest: DerivedManifest = {
  vendor: 'reddit',
  service: 'reddit',
  // Reddit's API reads a form: dev/api's parameters are a POST's form fields (every client here sends
  // application/x-www-form-urlencoded); a JSON body is read as JSON where a client sends one
  body: { form: { coerce: false } },
  // source: https://www.reddit.com/dev/api "Fullnames start with the type prefix for the object's type, followed by the thing's unique ID in base 36."
  // Where the documentation stops: Reddit's ids are counters in base 36; the twin mints seven lowercase letters, a
  // base-36 id of Reddit's present length (t3_1kh2top), and an upload's asset id thirteen (ky0147al7eze1, as leased)
  ids: { template: '{letters:7}' },
  // source: https://github.com/reddit-archive/reddit/wiki/JSON "the time of creation in local epoch-second format"
  time: 'unix',
  // Reddit's error body for an HTTP error: the status's words and its number (recorded: {"message": "Unauthorized",
  // "error": 401}, {"message": "Forbidden", "error": 403}, {"message": "Bad Request", "error": 400})
  error: { message: '{message}', error: '{status}' },
  // not Reddit's: the kernel's refusal of a write to a World started read-only, in Reddit's error form
  readOnly: { status: 403, message: 'Forbidden' },
  malformedBody: { status: 400, message: 'Bad Request' },
  notFound: { status: 404, message: 'Not Found' },
  gap: { status: 404, message: 'Not Found' },
  // required by the type; the handlers page every listing themselves (after, before, limit, count)
  // source: https://www.reddit.com/dev/api "limit - the maximum number of items to return in this slice of the listing."
  list: { style: 'envelope', envelope: { kind: 'Listing', data: { after: null, before: null, children: '{data}' } }, limit: { param: 'limit', default: 25, max: 100 } },
  deleted: {},
  // Reddit's documented limits (the API wiki: 60 requests a minute for an OAuth2 client). The answers Reddit gives today
  // count 1,000 requests a ten-minute window per client (x-ratelimit-used plus -remaining, recorded 2025-05-07), which
  // the twin's own window answers (./semantics/around.ts); the live budget keeps the documented, lower figure.
  // source: https://github.com/reddit-archive/reddit/wiki/API "Clients connecting via OAuth2 may make up to 60 requests per minute."
  rateBudget: {
    reason: "Reddit's API wiki allows an OAuth2 client 60 requests a minute and asks it to watch X-Ratelimit-Used, -Remaining and -Reset",
    windowMs: 60_000, ceiling: 60, defaultWeight: 1, maxRetryAfterSeconds: 600,
    // the vendor's documented allowance this budget stays inside (cited above)
    allowance: { perMinute: 60, source: 'https://github.com/reddit-archive/reddit/wiki/API' },
  },
  // the World's doors (./semantics/doors.ts): what Reddit's pages do that its API does not, and the World's own facts
  doors: [
    { id: 'accounts', method: 'POST', path: '/_twin/accounts', note: "a Reddit account, as reddit.com's sign-up page makes it (no API does): its username, email and password" },
    { id: 'apps', method: 'POST', path: '/_twin/apps', note: "an app on reddit.com/prefs/apps (no API makes one): a script, web or installed app, its client id and secret shown once" },
    { id: 'subreddits', method: 'POST', path: '/_twin/subreddits', note: "a community made on reddit.com's Create a community page, for a seed (a seed call carries no token; a life makes its community with POST /api/site_admin)" },
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World application's bearer token for the World's account (the descriptor's credentialDoor): the token its operator mints with the script app's password grant before a send" },
  ],
  // GET /twin: what the twin is of and what it keeps
  discovery: {
    twinOf: "Reddit: the OAuth API on oauth.reddit.com as Volter's launch and its campaign sender use it (the token endpoint's password grant, GET /api/v1/me, the media lease and its S3 upload, /api/submit of every kind, /api/comment, /api/vote, /api/del, /api/subscribe, /api/site_admin, a user's and a community's listings, a post's comments), the same API called by reddit.com's own pages with the session cookie, and reddit.com's pages: sign-in, a community (Hot, New), Create Post and a post's comments page, with the media hosts that serve what was uploaded",
    stores: "accounts and their passwords' hashes, apps, every token issued (by its SHA-256, with its scopes and expiry), communities and who joined them, posts, comments, votes, upload leases and the bytes uploaded under them, the rate windows, and who is signed in at reddit.com",
    identity: 'Send `Authorization: bearer <token>` to oauth.reddit.com for a token from POST https://www.reddit.com/api/v1/access_token (a script app\'s password grant) or from the World\'s credential door; on www.reddit.com, sign in at /login and send the `reddit_session` cookie with the page\'s modhash (`X-Modhash` or `uh`).',
  },
  screens: [
    // the more particular paths first: a screen by its path answers the first that takes it
    {
      id: 'login', kind: 'flow', host: 'www.reddit.com', hosts: ['old.reddit.com'], path: '/login', status: 'done', controls: ['Email or username', 'Password', 'Log In'],
      demand: "every page a person acts on asks them to sign in first; the dry run's reviewers sign in as Volter's account",
      source: DEV_API,
    },
    {
      id: 'post', kind: 'workspace', host: 'www.reddit.com', path: '/r/{subreddit}/comments/{article}', status: 'done', controls: ['Upvote', 'Downvote', 'Share', 'Join the conversation', 'Comment', 'Reply', 'More options', 'Delete'],
      demand: "the launch post's comments page, where its video plays and people comment (owner, 2026-10-02), and where a person deletes a comment of their own from its overflow menu",
      source: 'https://www.reddit.com/dev/api#GET_comments_{article}',
    },
    {
      id: 'submit', kind: 'flow', host: 'www.reddit.com', path: '/submit', status: 'done', controls: ['Text', 'Images & Video', 'Link', 'Title', 'Body', 'Upload', 'URL', 'Choose a community', 'Post'],
      demand: "Create Post: the launch is posted by a person (owner, 2026-10-02), and the videogame.ai site's Share › Reddit sends a person to reddit.com/submit with a url and a title (ShareDialog.tsx:29)",
      source: 'https://www.reddit.com/dev/api#POST_api_submit',
    },
    {
      id: 'all', kind: 'workspace', host: 'www.reddit.com', path: '/r/all', status: 'done', controls: ['Hot', 'New', 'Upvote', 'Downvote', 'Share'],
      demand: "r/all, every public community's posts (r/volter's among them): the way across the World's communities a signed-out reader takes, from which a visitor opens the launch",
      source: 'https://www.reddit.com/dev/api#GET_hot',
    },
    {
      id: 'subreddit', kind: 'workspace', host: 'www.reddit.com', path: '/r/{subreddit}', status: 'done', controls: ['Create Post', 'Join', 'Joined', 'Hot', 'New', 'Upvote', 'Downvote', 'Share'],
      demand: "r/volter's listing (Hot, New), where a person opens the community, joins it and starts a post (owner, 2026-10-02); its Create Post page is /r/{subreddit}/submit",
      source: 'https://www.reddit.com/dev/api#GET_hot',
    },
    {
      id: 'user', kind: 'workspace', host: 'www.reddit.com', path: '/user/{username}', status: 'done', controls: ['Posts', 'Upvote', 'Downvote', 'Share'],
      demand: "the page a media post's submit answers (user_submitted_page), where Create Post takes a person once their video or image is posted, and from which they open it",
      source: 'https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubreddit.test_submit_image__selftext.json',
    },
    {
      id: 'search', kind: 'flow', host: 'www.reddit.com', path: '/subreddits/search', status: 'done',
      demand: "where reddit.com sends a person who names a community it does not have (Pixel looking for a VideoGame AI community): the communities by that name, or none",
      source: 'https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/reddit_base.py',
    },
    {
      id: 'www', kind: 'flow', host: 'reddit.com', path: '/', status: 'done',
      demand: "the videogame.ai site's share link names reddit.com/submit, which Reddit answers by moving the browser to www.reddit.com",
      source: 'https://www.reddit.com/dev/api',
    },
    // reddit.com's front page: its path, `/`, takes every path under it, so it is declared after every other page of
    // www.reddit.com and yields to the API (a POST to /api/submit is the operation's, never the front page's)
    {
      id: 'home', kind: 'workspace', host: 'www.reddit.com', path: '/', status: 'done', yieldsToApi: true, controls: ['Home', 'Create', 'Log In', 'Upvote', 'Downvote', 'Share'],
      demand: "reddit.com's front page, which its logo opens and a sign-in with no dest goes to; the World's console opens Reddit at its root workspace, the reviewers' way in",
      source: 'https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/validator/validator.py',
    },
    // old.reddit.com, Reddit's pages in r2's markup, which Volter Browsers' frontline opens as Reddit's feed
    {
      id: 'old-comments', kind: 'workspace', host: 'old.reddit.com', path: '/r/{subreddit}/comments/{article}', status: 'done', controls: ['upvote', 'downvote', 'reply', 'save'],
      demand: "Volter Browsers' frontline presses a comment's reply toggle on old.reddit.com and refuses the arrows (volter-ai/lucarne 83c544c packages/lucarne-sites/src/policy.ts:24-26)",
      source: 'https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/templates/comment.html',
    },
    {
      id: 'old-home', kind: 'workspace', host: 'old.reddit.com', path: '/', status: 'done', yieldsToApi: true, controls: ['upvote', 'downvote', 'comments', 'Log in'],
      demand: "Volter Browsers' frontline opens old.reddit.com as Reddit's feed (volter-ai/lucarne 83c544c packages/lucarne-sites/src/policy.ts:44)",
      source: 'https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/templates/link.html',
    },
    {
      id: 'uploads', kind: 'content', host: 'reddit-uploaded-media.s3-accelerate.amazonaws.com', hosts: ['reddit-uploaded-video.s3-accelerate.amazonaws.com'], path: '/', status: 'done',
      // it takes a form: the lease's fields and the file, POSTed by the sender and, at a World's place, by the Create Post
      // page through `<base>/@<host>/` (the content route's form, as the integrator's rule names it)
      takes: ['POST'],
      demand: "the media lease's S3 form action: the sender and the Create Post page post the file there (senders/reddit.mjs:26); in a hosted World the person's Create Post posts it at the World's place for the bucket's host",
      source: 'https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubreddit.test_submit_image__selftext.json',
    },
    {
      id: 'media', kind: 'content', host: 'v.redd.it', hosts: ['i.redd.it', 'preview.redd.it', 'external-preview.redd.it', 'b.thumbs.redditmedia.com'], path: '/', status: 'done',
      demand: "a post's video, image, preview and thumbnail, which its comments page, the listings and every API client load",
      source: 'https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubreddit.test_submit_video.json',
    },
  ],
  resources: {
    // an Account (t2), kept by its username as its subject; Reddit's own `id` (base 36) is a field of it
    account: { idPrefix: '', storedAs: 'account', unique: [{ fields: ['_name'], refusal: { status: 409, message: 'that username is already taken' } }], refresh: { get: 'GET_api_v1_me' } },
    // a community (t5), kept by its display name
    subreddit: { idPrefix: '', storedAs: 'subreddit', unique: [{ fields: ['_profile_of'], refusal: { status: 409, message: 'that account already has a profile community' } }], refresh: { none: "Reddit reads a community back by its name (GET /r/{subreddit}/about) and lists the account's own by GET /subreddits/mine/{where}; the refresh fills a path only from a parent it observed, and a community has none in this pack, so the World's communities are not read back from a live account" } },
    // a Link (t3): a post, stored as Reddit answers its data
    link: { idPrefix: '', storedAs: 'link', ...states.link, refresh: { none: "Reddit lists posts as things ({kind, data}) inside a Listing; the refresh reads a list's items as the objects themselves, so a post is not read back from a live account until the kernel reads a listing's things" } },
    // a Comment (t1)
    comment: { idPrefix: '', storedAs: 'comment', refresh: { none: "Reddit answers a post's comments as things inside the second Listing of GET /comments/{article}; the refresh does not read nested things" } },
    // an upload lease (the media asset) and the file posted under it
    asset: { idPrefix: '', ids: '{letters:13}', storedAs: 'asset', ...states.asset, refresh: { none: "Reddit reads no upload lease back: POST /api/media/asset.json answers one once, and nothing lists them" } },
    // an app on reddit.com/prefs/apps
    app: { idPrefix: '', ids: '{letters:14}', storedAs: 'app', refresh: { none: "Reddit's API reads no app back: they are made and shown on reddit.com/prefs/apps alone" } },
    _access_token: { idPrefix: 'token_' },
    _token_issue: { idPrefix: 'issue_' },
    _client_secret: { idPrefix: '' },
    _rate_window: { idPrefix: '' },
    _vote: { idPrefix: '' },
    _membership: { idPrefix: '', ...states._membership },
  },
  // no vendor-backed half (twin-world's architecture, "The real-system adapters"): packOf derives no state system
  vendorBacked: { none: "No root is bound to Reddit. Its writes the demand makes are not one request each: an image or video post is a lease from Reddit, a form posted to the S3 bucket the lease names, then the submit naming the uploaded file, and the lease's key and policy are Reddit's per call, so a recorded request cannot be sent again (architecture, \"Protocols a request cannot express\"), and no perform hook is built for it; its accounts, apps and the World's tokens are made on Reddit's pages, which no API reaches; and Reddit answers every listing's posts as things inside {kind, data}, which the refresh does not read, so a refresh would observe nothing but the identity." },
  // the descriptor, as data (twin-world's architecture, "The descriptor"): the pack registers packOf(manifest)
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-reddit',
    resources: ['account', 'subreddit', 'link', 'comment', 'asset', 'app', '_access_token', '_token_issue', '_client_secret', '_rate_window', '_vote', '_membership', '_person', '_web_session', '_web_session_issue'],
    resourcesUnreachable: {},
    specSource: "Written from Reddit's API page (https://www.reddit.com/dev/api, every endpoint it lists: spec/openapi.json), corrected by spec/patches.json from Reddit's OAuth2 wiki (the token endpoint), its JSON wiki and the answers Reddit gave PRAW's recorded tests (the media lease, every answer's shape); provenance in spec/SOURCE.md.",
    description: "Reddit twin: the OAuth API a launch and its sender call (password-grant tokens with scopes and expiry, the identity, the media lease and its S3 upload with Reddit's policy, submit of link, self, image, video and videogif posts, comments, votes, deletion, communities and their listings), and reddit.com's own pages: sign-in, a community's Hot and New, Create Post with an upload, and a post's comments page with its video playing and its comment box.",
    adoption: { sdks: ['snoowrap'], pypi: ['praw', 'asyncpraw'], envStems: ['REDDIT'] },
    // Routing keeps the served pages and media; demand detection names only API and upload paths.
    hosts: [
      { host: 'oauth.reddit.com' },
      { host: 'www.reddit.com', demandPathPattern: '^/api/' },
      { host: 'reddit.com', demandPathPattern: '^/api/' },
      { host: 'old.reddit.com', demandPathPattern: '^/api/' },
      { host: 'reddit-uploaded-media.s3-accelerate.amazonaws.com' },
      { host: 'reddit-uploaded-video.s3-accelerate.amazonaws.com' },
      { host: 'v.redd.it', demandPathPattern: false },
      { host: 'i.redd.it', demandPathPattern: false },
      { host: 'preview.redd.it', demandPathPattern: false },
      { host: 'external-preview.redd.it', demandPathPattern: false },
      { host: 'b.thumbs.redditmedia.com', demandPathPattern: false },
    ],
    endpointEnvNone: "Reddit's clients name oauth.reddit.com and www.reddit.com themselves (the campaign's sender writes them as constants); the World's injector routes those hosts, and no client of the demand reads a base-URL variable",
    credentialDoor: { account: { field: 'account', tenancy: 'Reddit user', source: 'https://github.com/reddit-archive/reddit/wiki/OAuth2' }, deployment: { field: 'deployment', object: 'Registered OAuth application with user grant', source: 'https://github.com/reddit-archive/reddit/wiki/OAuth2' },  path: '/_twin/app-credentials', body: {}, fill: { REDDIT_ACCESS_TOKEN: 'access_token' } },
  },
};
