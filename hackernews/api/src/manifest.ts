// The api lane's manifest: Hacker News's public read API, a Firebase Realtime Database at hacker-news.firebaseio.com/v0
// (../spec/openapi.json, written from the API's README; provenance
// in ../spec/SOURCE.md). Every operation is a read, answered by a handler from the store the site lane writes (one
// service, one store): an item as the site made it, a user once they have public activity, and the site's own lists.
// No key, no paging, no write: Firebase answers JSON, null where nothing is, and refuses a write (./semantics/gap.ts).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'hackernews',
  // one service with the site lane, so one store: what a person posts on the site is what the API reads
  service: 'hackernews',
  body: {},
  // an item's id is an integer, one sequence over every kind of item (spec:/components/schemas/Item/properties/id "The item's unique id.")
  ids: { template: '{n}' },
  // source: spec:/components/schemas/Item/properties/time "Creation date of the item, in [Unix Time]"
  time: 'unix',
  // Firebase's error body, `{ "error": "..." }` (https://firebase.google.com/docs/reference/rest/database, "Error Conditions")
  error: { error: '{message}' },
  // not the API's: the kernel's refusal of a write to a World started read-only, in Firebase's error body
  readOnly: { status: 401, message: 'Permission denied' },
  notFound: { status: 404, message: 'Not Found' },
  // required by the type; no list of the API pages (each is a bare array of up to 500 or 200 ids)
  list: { style: 'envelope', envelope: '{data}', limit: { param: 'limitToFirst', default: 500, max: 500 } },
  deleted: null,
  // the host the vendor's router sends here (architecture, "Other wires: lanes")
  hosts: [{ host: 'hacker-news.firebaseio.com' }],
  vendorBacked: { none: "the read API takes no write: Hacker News's items and users are made by people on its site, which it asks never be automated (newsguidelines.html: \"please don't automate posting\"), so no World's write is performed against it" },
  resources: {
    Item: { storedAs: 'item', idPrefix: '', ...states.Item, refresh: { none: 'no write of a World is performed against Hacker News (vendorBacked)' } },
    User: { storedAs: 'user', idPrefix: '', refresh: { none: 'no write of a World is performed against Hacker News (vendorBacked)' } },
  },
  discovery: {
    twinOf: "Hacker News's public read API (hacker-news.firebaseio.com/v0): items, users, the largest id, the top, new, best, Ask HN and Show HN lists, and the changes (jobstories, which no page fills, answers the gap)",
    stores: 'the items and users the site lane writes',
  },
};
