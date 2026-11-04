// The site lane's manifest: news.ycombinator.com as a person uses it. Hacker News has no posting API and asks that
// posting never be automated (newsguidelines.html: "please don't automate posting"), so its forms are the site's own
// operations (../spec/openapi.json, written from its pages and their forms as a person sees them; provenance in
// ../spec/SOURCE.md): login and create account, submit, comment and reply, upvote. Its pages are workspace screens
// (./screens/), authored from @volter/world-ui's pieces under Hacker News's look, each drawing what the forms made.
// One service with the api lane, so one store: a story submitted here is at /v0/item/<id>.json and in newstories.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

const SITE = 'news.ycombinator.com';

export const manifest: DerivedManifest = {
  vendor: 'hackernews',
  service: 'hackernews',
  // the forms post application/x-www-form-urlencoded, as a browser sends them
  body: {},
  // one integer sequence over every item, and a user is their username (../../api/spec, Items and Users)
  ids: { template: '{n}' },
  time: 'unix',
  // the site answers a refusal as text: an unknown path is "Unknown." (news.ycombinator.com/nosuchpagezz, read 2026-10-02)
  error: '{message}',
  readOnly: { status: 403, message: 'This World is read-only.' },
  notFound: { status: 404, message: 'Unknown.' },
  gap: { status: 404, message: 'Unknown.' },
  list: { style: 'envelope', envelope: '{data}', limit: { param: 'n', default: 30, max: 30 } },
  deleted: null,
  hosts: [{ host: SITE }],
  vendorBacked: { none: "Hacker News asks that posting never be automated (newsguidelines.html: \"please don't automate posting\"): a World's posts stay in the World, and a real one is made by a person on the real site" },
  resources: {
    item: { idPrefix: '', ...states.item, refresh: { none: 'no write of a World is performed against Hacker News (vendorBacked)' } },
    user: { idPrefix: '', ...states.user, unique: [{ fields: ['id'], refusal: { status: 200, message: 'That username is taken. Please choose another.' } }, { fields: ['_username_key'], refusal: { status: 200, message: 'That username is taken. Please choose another.' } }], refresh: { none: 'no write of a World is performed against Hacker News (vendorBacked)' } },
  },
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World's own account (Volter's), as the runtime issues it: its username and password" },
  ],
  // The site's pages. Each yields to the forms' operations at its paths (architecture, "Screens": yieldsToApi): the login
  // page draws GET /login and its form posts to POST /login; the front page at / stands over every other path, so the
  // vote links and form posts are the operations'. A screen by its path answers the first that takes it: / is last.
  screens: [
    {
      id: 'login', kind: 'workspace', host: SITE, path: '/login', status: 'done', yieldsToApi: true,
      controls: ['username:', 'password:', 'login', 'create account'],
      demand: "the launcher signs in as the World's Volter account; every page's login link and every form posted signed out lead here",
      source: 'https://news.ycombinator.com/login (its two forms: acct and pw, login; creating, acct and pw, create account)',
    },
    {
      id: 'submit', kind: 'workspace', host: SITE, path: '/submit', status: 'done', yieldsToApi: true,
      controls: ['title', 'url', 'text', 'submit'],
      demand: 'the launcher submits the Show HN: a title beginning Show HN, the home page url and the text explaining it',
      source: 'https://news.ycombinator.com/showhn.html and https://news.ycombinator.com/newsfaq.html (submitting a question: leave url blank)',
    },
    {
      id: 'item', kind: 'workspace', host: SITE, path: '/item', status: 'done', yieldsToApi: true,
      controls: ['upvote', 'add comment', 'reply'],
      demand: 'the launch thread: the story, its text, its comments ranked, a new comment, the reply link and the upvote arrow',
      source: 'https://news.ycombinator.com/item (a story and its thread; the add comment form: parent, goto, hmac, text)',
    },
    {
      id: 'reply', kind: 'workspace', host: SITE, path: '/reply', status: 'done', yieldsToApi: true,
      controls: ['reply'],
      demand: "the launcher answers a reader's comment from its reply link",
      source: 'https://news.ycombinator.com/reply (the comment replied to, and the reply form posting to comment)',
    },
    {
      id: 'newest', kind: 'workspace', host: SITE, path: '/newest', status: 'done', yieldsToApi: true,
      controls: ['upvote'],
      demand: 'where a fresh submission appears first, newest first',
      source: 'https://news.ycombinator.com/newsfaq.html (All Ask HNs appear on newest and asknew, and all Show HNs on newest and shownew)',
    },
    {
      id: 'shownew', kind: 'workspace', host: SITE, path: '/shownew', status: 'done', yieldsToApi: true,
      controls: ['upvote'],
      demand: 'every Show HN, newest first, before it clears the show page threshold',
      source: 'https://news.ycombinator.com/showhn.html (Every Show HN appears on shownew)',
    },
    {
      id: 'show', kind: 'workspace', host: SITE, path: '/show', status: 'done', yieldsToApi: true,
      controls: ['upvote'],
      demand: 'the show page in the top bar, where the launch appears once it clears the points threshold',
      source: 'https://news.ycombinator.com/showhn.html (Once it clears a small points threshold, it will appear on the show page)',
    },
    {
      id: 'news', kind: 'workspace', host: SITE, path: '/news', status: 'done', yieldsToApi: true,
      controls: ['upvote'],
      demand: "the front page, ranked by points and age on the World's clock",
      source: 'https://news.ycombinator.com/newsfaq.html (How are stories ranked?)',
    },
    {
      id: 'user', kind: 'workspace', host: SITE, path: '/user', status: 'done', yieldsToApi: true,
      demand: "an account's page: its username, when it was created and its karma",
      source: 'https://news.ycombinator.com/newsfaq.html (How is a user\'s karma calculated?)',
    },
    {
      id: 'front', kind: 'workspace', host: SITE, path: '/', status: 'done', yieldsToApi: true,
      controls: ['upvote'],
      demand: "the site's address itself: the front page, and Unknown. for a path the site does not have",
      source: 'https://news.ycombinator.com/ (the front page; an unknown path answers Unknown.)',
    },
  ],
  discovery: {
    twinOf: 'Hacker News (news.ycombinator.com) as a person uses it: login and create account, submit (a link, a question, a Show HN), comment and reply, upvote, logout, and the front page, newest, show, shownew, item, reply, and user pages',
    stores: 'items, users, votes, people and their sign-ins',
    identity: "Sign in on the login page as the World's account (the credential door's acct and pw) or an account made on it; the user cookie names you to every page after.",
  },
};
