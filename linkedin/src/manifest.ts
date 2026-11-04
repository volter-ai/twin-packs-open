// LinkedIn's manifest: the vendor facts its spec does not carry (docs/contributing/architecture.md, "Protocol 3"). The
// surface is generated (./generated/surface.gen.json) from ../spec/openapi.json, which is written from LinkedIn's
// Microsoft Learn reference pages at the Marketing September 2026 version (202609): LinkedIn publishes no OpenAPI
// document (../spec/SOURCE.md lists every page read).
//
// WHAT IT IS. LinkedIn as a company page's people use it: a member signs in at www.linkedin.com, opens the feed, starts
// a post as themselves or as a page they post for, writes its text, attaches a photo or a video from their machine and
// posts; the post is seen on its own page and on the company page's Posts tab (./screens/). The same operations serve
// an application through the versioned REST API at api.linkedin.com/rest: the Posts API (create, read by URN, find by
// author, delete), the Images API and the Videos API (initializeUpload, the PUT of a file or of each 4 MB part to the
// URLs LinkedIn answers on www.linkedin.com, finalizeUpload, read back while LinkedIn processes it), and the account's
// identity calls (who the token is: /v2/userinfo; which pages it holds roles on: organizationAcls; the page itself:
// organizations/{id}).
//
// EVERY SERVED OPERATION IS A HANDLER (./semantics/index.ts): a create answers 201 with its URN in a header and no body,
// reads answer only what the caller's scopes and page roles allow, an upload's state moves on LinkedIn's own clock, and
// a post waits on its media; the derived core owns none. A post the share box makes and one the API makes are the same
// write (./semantics/shared.ts createPostAs).
//
// AUTH. A bearer token on every /rest and /v2 call (./semantics/around.ts), resolved to the member it was issued to and
// the developer application it was issued for, with its scopes; a token is kept by its SHA-256 (`_access_token`),
// lives sixty days, and is invalidated when the member generates another with other scopes. The versioned /rest
// surface also asks for a live Linkedin-Version. The upload URLs carry their own authorization (the image's takes the
// bearer token as well). A person on linkedin.com is who signed in there (the `li_at` cookie).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

const POSTS = 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09';
const HOME = 'The model-editor campaign on LinkedIn: it is posted by a person through linkedin.com (the owner, 2026-10-02: "it\'s primarily going to be UI since posting is not really automated")';

/** What LinkedIn serves on www.linkedin.com that this pack holds: its root, the upload URLs, the sign-in and the
 *  sign-out, the feed and its share box, a post's page, a company page, and the World's doors. The rest of the site (profiles, jobs, messaging, the
 *  OAuth pages) is not claimed, and is refused loudly. */
const WWW_PATHS = '^/$|^/(dms-uploads|dms-mpf-uploads|feed|company|login|uas/login|m/logout|signup/cold-join|signup/api/cors/createAccount|checkpoint/lg/login-submit)(/|$)|^/_twin/';

export const manifest: DerivedManifest = {
  vendor: 'linkedin',
  service: 'linkedin',
  body: {},
  ids: { template: '{uuid}' },
  // what every versioned call carries and the vendor reads (the Posts API page: "All APIs require the request header
  // Linkedin-Version: {Version in YYYYMM format}. All APIs require the request header X-Restli-Protocol-Version: 2.0.0"):
  // recorded with a write, so a perform sends them again
  headers: ['linkedin-version', 'x-restli-protocol-version'],
  // createdAt, lastModifiedAt, publishedAt, uploadUrlsExpireAt: "Time at which the resource was created in milliseconds
  // since epoch" (the post-api-schema page)
  time: 'unix-ms',
  // LinkedIn's error body (https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling): message,
  // serviceErrorCode and status, and the error's code where its pages name one; where the documentation stops, the
  // subcode is the status (./semantics/shared.ts refuse)
  error: { message: '{message}', serviceErrorCode: '{status}', status: '{status}', code: '{code}' },
  errorOmitsAbsent: true,
  // not LinkedIn's: the kernel's refusal of a write to a World started read-only, in LinkedIn's error body
  readOnly: { status: 403, code: 'ACCESS_DENIED', message: 'This World is read-only: writes are refused.' },
  malformedBody: { status: 400, message: 'The request body is not valid JSON.' },
  // "404 Resource Not Found: This error occurs when your application tries to call an API or fetch an entity that does
  // not exist" (the error-handling page): the gap, for what LinkedIn has and this pack does not model
  notFound: { status: 404, message: 'Resource Not Found' },
  gap: { status: 404, message: 'Resource Not Found' },
  // required by the type; the finders page themselves (start, count, paging.links)
  list: { style: 'envelope', envelope: { elements: '{data}' }, limit: { param: 'count', default: 10, max: 100 } },
  deleted: null,
  // the vendor-backed half (architecture, "The real-system adapters") is not built: LinkedIn reads a page's posts back only
  // by their author's URN in a finder's query, which the derived refresh cannot name from a page's stored id, and every
  // versioned call carries a Linkedin-Version that a root's sealed credential does not; until the kernel names both, a
  // World's LinkedIn is its own, and binding a root to it is refused with this reason
  vendorBacked: { none: "not built: LinkedIn lists a page's posts only by their author's URN in a finder's query (GET /rest/posts?q=author&author=urn:li:organization:<id>), which the derived refresh cannot name from a page's stored id, and every /rest call needs a live Linkedin-Version the root's credential does not carry; a World's LinkedIn is the World's own" },
  // the operations of the written spec this pack does not model: LinkedIn's 404, the gap
  unmodeled: ['findPostsByAccount', 'findImagesByAssociatedAccount', 'findOrganizationByVanityName'],
  resources: {
    // a post's id is its URN, urn:li:share:<n> or urn:li:ugcPost:<n>, kept by its number; where the documentation stops,
    // the number rises with time as LinkedIn's do (a snowflake from the epoch)
    Post: { storedAs: 'post', idPrefix: '', ids: '{snowflake:0}', ...states.Post, refresh: { get: 'getPost' } },
    // an image's and a video's id, urn:li:image:<id> and urn:li:video:<id> (the Images and Videos API pages: C4E10AQF…,
    // C5505AQH…): a kind-and-region prefix and its letters, kept by the id
    Image: { storedAs: 'image', idPrefix: 'D5622AQ', ids: '{prefix}{letters:12}', ...states.Image, refresh: { get: 'getImage' } },
    Video: { storedAs: 'video', idPrefix: 'D5610AQ', ids: '{prefix}{letters:12}', ...states.Video, refresh: { get: 'getVideo' } },
    // a company page, urn:li:organization:<id>: the World's first is 100000001, the page the campaign's sender posts as
    Organization: { storedAs: 'organization', idPrefix: '10000000', ids: '{prefix}{n}', ...states.Organization, refresh: { get: 'getOrganization' } },
    // a member, urn:li:person:<sub>, in /v2/userinfo's shape
    member: { idPrefix: '', ids: '{letters:10}', unique: [{ fields: ['_email'], refusal: { status: 409, message: 'Someone’s already using that email.' } }], refresh: { get: 'userinfo' } },
    // a member's role on a page (Organization Access Control)
    // where the evidence stops: LinkedIn reads roles back only through its finders (roleAssignee, organization), whose
    // { paging, elements } answer the spec reader classes a retrieve of the collection, not a list of roles
    organization_acl: { idPrefix: '', refresh: { none: "LinkedIn reads a page's roles only through the organizationAcls finders, which the spec reader takes as one collection; a root's roles are its page's, made with it" } },
    // a developer application, its products' scopes and its daily limits: the Developer Portal's, which no API reads
    developer_app: { idPrefix: '', ids: '{letters:14}', refresh: { none: "a developer application is the Developer Portal's; LinkedIn's API reads none back" } },
    _access_token: { idPrefix: '', ...states._access_token },
    _usage: { idPrefix: '' },
    _upload: { idPrefix: '' },
  },
  // the World's doors (./semantics/doors.ts): what LinkedIn's own pages do outside its API
  doors: [
    { id: 'members', method: 'POST', path: '/_twin/members', note: 'a member signs up at linkedin.com/signup: an email, a password and a name' },
    { id: 'organizations', method: 'POST', path: '/_twin/organizations', note: 'a member creates a company page (Create a LinkedIn Page) and is its administrator' },
    { id: 'developerApps', method: 'POST', path: '/_twin/developer-apps', note: "an application created on the Developer Portal, with its products" },
    { id: 'tokens', method: 'POST', path: '/_twin/tokens', note: "the Developer Portal's OAuth Token Generator Tool: a member's token for an application" },
    { id: 'appLimits', method: 'POST', path: '/_twin/developer-apps/{clientId}/limits', note: "the daily limits an application's Analytics tab shows for an endpoint" },
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "{ account?, deployment? } or { email, client_id }: a developer application's retained member OAuth grant" },
  ],
  discovery: {
    twinOf: "LinkedIn: linkedin.com's sign-in, feed and share box (a post with a photo or a video from the person's machine, as a member or a company page), a post's page and a company page's Posts tab; and the versioned REST API at api.linkedin.com/rest (Posts, Images and Videos with their uploads, Organization Access Control, Organization Lookup) with /v2/userinfo",
    stores: "members and their passwords' hashes, company pages and their roles, developer applications and their limits, posts, images and videos and their bytes, every access token issued (by its SHA-256), and the day's call counts",
    identity: 'Send `Authorization: Bearer <token>` (a token the credential door or the token generator door issued) and, on /rest, `Linkedin-Version: 202609`; a person signs in at www.linkedin.com/login.',
  },
  screens: [
    // the more particular path first: a post's page is under /feed
    {
      id: 'post', kind: 'workspace', host: 'www.linkedin.com', hosts: ['linkedin.com'], path: '/feed/update/{urn}', status: 'done',
      controls: ['Like', 'Comment', 'Repost', 'Send', 'Add a comment'],
      demand: `${HOME}: the person sees the post on its own page; Volter Browsers' frontline presses Comment there and refuses Like, Repost and Send (volter-ai/lucarne 83c544c packages/lucarne-sites/src/policy.ts:20-22)`,
      source: POSTS,
    },
    {
      id: 'feed', kind: 'workspace', host: 'www.linkedin.com', hosts: ['linkedin.com'], path: '/feed', status: 'done',
      // a post's own page is named by its URN, which its stored number alone does not give (share or ugcPost): a post
      // asked of the workspace by its id lands on the feed that lists it
      lists: ['post'],
      controls: ['Start a post', 'Video', 'Photo', 'Post as', 'Text editor for creating content', 'Add media', 'Who can see your post?', 'Post', 'Dismiss', 'View post', 'Me', 'Sign out'],
      demand: `${HOME}: the person opens the feed, starts a post as themselves (the campaign's linkedin-aaron) or as the page they administer, writes its text, attaches a video or a photo and posts`,
      source: POSTS,
    },
    {
      id: 'company', kind: 'workspace', host: 'www.linkedin.com', hosts: ['linkedin.com'], path: '/company/{company}', status: 'done',
      // the page is found by its vanity name or its stored id (./screens/company.tsx)
      shows: { type: 'organization', param: 'company' },
      controls: ['Home', 'Posts', 'Start a post', 'Show all posts'],
      demand: `${HOME}: the person sees the post on the company page's Posts tab, and starts a post from the page`,
      source: 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-lookup-api?view=li-lms-2026-09',
    },
    {
      id: 'login', kind: 'flow', host: 'www.linkedin.com', hosts: ['linkedin.com'], path: '/login', status: 'done',
      controls: ['Email or phone', 'Password', 'Sign in'],
      demand: `${HOME}: the person signs in here, and from linkedin.com's root as a visitor`,
      source: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow',
    },
    {
      id: 'uas-login', kind: 'flow', host: 'www.linkedin.com', hosts: ['linkedin.com'], path: '/uas/login', status: 'done',
      controls: ['Email or phone', 'Password', 'Sign in'],
      demand: `${HOME}: a member's page sends a visitor signed out here, as linkedin.com does`,
      source: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow',
    },
    {
      id: 'login-submit', kind: 'flow', host: 'www.linkedin.com', hosts: ['linkedin.com'], path: '/checkpoint/lg/login-submit', status: 'done',
      demand: 'the sign-in form posts here', source: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow',
    },
    {
      id: 'join', kind: 'flow', host: 'www.linkedin.com', hosts: ['linkedin.com'], path: '/signup/cold-join', status: 'done',
      controls: ['Email', 'Password', 'First name', 'Last name', 'Agree & Join', 'Sign in'],
      demand: `${HOME}: a visitor at a post they may not see, or one that is gone, is sent to join LinkedIn here (as linkedin.com answers, read with GET), and joins`,
      source: 'https://www.linkedin.com/signup/cold-join',
    },
    {
      id: 'join-submit', kind: 'flow', host: 'www.linkedin.com', hosts: ['linkedin.com'], path: '/signup/api/cors/createAccount', status: 'done',
      demand: 'the join form posts here', source: 'https://www.linkedin.com/signup/cold-join',
    },
    {
      id: 'logout', kind: 'flow', host: 'www.linkedin.com', hosts: ['linkedin.com'], path: '/m/logout', status: 'done',
      demand: "the Me menu's Sign out: the person signs out, and another can sign in on the same browser",
      source: 'https://www.linkedin.com/help/linkedin/answer/a1335211',
    },
    {
      id: 'media', kind: 'content', host: 'media.licdn.com', hosts: ['dms.licdn.com'], path: '/', status: 'done',
      demand: "every downloadUrl and thumbnail the Images and Videos APIs answer, and every post's page, load the image or the video from these hosts",
      source: 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09',
    },
    // last, as it would match any path: linkedin.com's root, which is the feed for a member and the sign-in for a
    // visitor; under it, a path the pack does not draw is LinkedIn's page-not-found. It draws nothing an operation names.
    {
      id: 'home', kind: 'workspace', host: 'www.linkedin.com', hosts: ['linkedin.com'], path: '/', status: 'done', yieldsToApi: true,
      controls: ['Sign in with email'],
      demand: `${HOME}: the person opens linkedin.com`,
      source: POSTS,
    },
  ],
  // the descriptor, as data (twin-world's architecture, "The descriptor"): the pack registers packOf(manifest)
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-linkedin',
    resources: ['post', 'image', 'video', 'organization', 'member', 'organization_acl', 'developer_app', '_access_token', '_usage', '_upload', '_person', '_web_session'],
    specSource: "LinkedIn's Marketing API reference on Microsoft Learn at version 202609 (Posts, Images, Videos, Organization Access Control, Organization Lookup) and Sign In with LinkedIn using OpenID Connect, written as spec/openapi.json (LinkedIn publishes no OpenAPI document; spec/SOURCE.md lists every page read)",
    description: "LinkedIn twin: linkedin.com's sign-in, feed and share box (post as a member or a company page, with a photo or a video from your machine), a post's page and a company page; the REST API's Posts, Images and Videos with their uploads, and the account's identity calls.",
    adoption: { sdks: ['linkedin-api-client'], pypi: ['linkedin-api-client'], envStems: ['LINKEDIN'] },
    // Routing keeps the served pages and media; demand detection names only API and upload paths.
    hosts: [
      { host: 'api.linkedin.com', pathPattern: '^/(rest|v2)/|^/_twin/', demandPathPattern: '^/(rest|v2)/' },
      { host: 'www.linkedin.com', pathPattern: WWW_PATHS, demandPathPattern: '^/(dms-uploads|dms-mpf-uploads)(/|$)' },
      { host: 'linkedin.com', pathPattern: WWW_PATHS, demandPathPattern: '^/(dms-uploads|dms-mpf-uploads)(/|$)' },
      { host: 'media.licdn.com', pathPattern: '^/dms/image/', demandPathPattern: false },
      { host: 'dms.licdn.com', pathPattern: '^/playlist/', demandPathPattern: false },
    ],
    endpointEnvNone: "LinkedIn's clients (linkedin-api-client, plain fetch) read no base-URL variable; the World claims api.linkedin.com and www.linkedin.com",
    // A member's grant to the deployment's developer application.
    credentialDoor: { path: '/_twin/app-credentials', body: {}, account: { field: 'account', tenancy: 'Developer member whose company roles govern access', source: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow' }, deployment: { field: 'deployment', object: 'Developer application with member OAuth grant', source: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/developer-portal-tools' }, fill: { LINKEDIN_ACCESS_TOKEN: 'access_token' } },
  },
};
