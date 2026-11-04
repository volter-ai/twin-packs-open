// Hacker News's manifest: a vendor whose every API is a lane (architecture, "Other wires: lanes"). Its public read API,
// a Firebase Realtime Database at hacker-news.firebaseio.com/v0, is the `api` lane; the site itself,
// news.ycombinator.com, is the `site` lane: its forms (login, submit, comment, vote) are operations written from its
// pages, and its pages are workspace screens. Both keep the one store (service `hackernews`), so what a person posts on
// the site is what the API answers. A request at a World's place, where no vendor host names a lane, is the site's.
import type { VendorManifest } from '@volter/world-core';

export const manifest: VendorManifest = {
  vendor: 'hackernews',
  discovery: {
    twinOf: "Hacker News: the site a person posts on (news.ycombinator.com: login and create account, submit a link, a question or a Show HN, comment and reply, upvote, logout; the front page, newest, show, shownew, item, reply and user pages, ranked on the World's clock) and its public read API (hacker-news.firebaseio.com/v0: items, users, the largest id, the top, new, best, Ask HN and Show HN lists, the changes)",
    stores: 'items (stories and comments) and users in the read API\'s shapes, votes, and the people who sign in with their sign-ins',
  },
  // neither lane has a vendor-backed half: the read API takes no write, and the site asks that posting never be automated
  vendorBacked: { none: "Hacker News's read API takes no write, and its site asks that posting never be automated (newsguidelines.html: \"please don't automate posting\"): a World's posts stay in the World, and a real one is made by a person on the real site" },
  lanes: {
    routes: [
      { lane: 'api', host: '^hacker-news\\.firebaseio\\.com$' },
      { lane: 'site', host: '^news\\.ycombinator\\.com$' },
      // at a World's place, where no vendor host names a lane, the read API's own path is the API's (the site has none)
      { lane: 'api', path: '/v0' },
    ],
    default: 'site',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-hackernews',
    resources: ['item', 'user', '_vote', '_person', '_web_session', '_web_session_issue'],
    specSource: "api/spec: Hacker News's API README (github.com/HackerNews/API at 8a0528f), written as OpenAPI from it; site/spec: the site's forms, written from its pages (newsguidelines, newsfaq, showhn, security, formatdoc) and the forms as a person sees them",
    description: "Hacker News twin — the site as a person posts on it (log in, submit a Show HN, comment, reply, upvote; the front page, newest, show and item pages ranked on the World's clock) and the public Firebase read API, over one store, so a post made on a page is at /v0/item/<id>.json and in newstories.",
    adoption: { sdks: [], envStems: ['HN', 'HACKERNEWS'] },
    hosts: [{ host: 'hacker-news.firebaseio.com' }, { host: 'news.ycombinator.com' }],
    endpointEnvNone: 'Hacker News publishes no SDK: clients fetch https://hacker-news.firebaseio.com/v0 directly and people use news.ycombinator.com in a browser, both reached by host',
    // the World's own account, which the launcher signs in with on the login page
    credentialDoor: { path: '/_twin/app-credentials', body: {}, account: { field: 'account', tenancy: 'Hacker News user', source: 'https://news.ycombinator.com/login?goto=news' }, deployment: { field: 'deployment', object: "none (the user's login)", source: 'https://news.ycombinator.com/login', organizationOutputs: ['HN_USERNAME', 'HN_PASSWORD'] }, fill: { HN_USERNAME: 'acct', HN_PASSWORD: 'pw' } },
  },
};
