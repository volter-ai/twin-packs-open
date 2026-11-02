// X's default data, as data (docs/contributing/architecture.md, "Pack layout"): calls to the pack's own doors,
// which `volter-world init` copies into the World beside a runner that makes them. Two Apps (a confidential one, with
// its secret, and a public one), accounts (Ada, public and verified, with the password she signs in to x.com with;
// Grace, protected; and the Model Editor launch's @AaronYEtc and @volterai, each with its password), so every authorize screen has an App and a person who can sign in to consent.
import type { SeedCall } from '@volter/world-core';

export const seed: SeedCall[] = [
  { method: 'POST', path: '/_twin/clients', body: { client_id: 'VHdpbkRlbW9BcHAwMDAwMDAwMDA6MTpjaQ', client_secret: 'twin-confidential-secret-0000000000000000000000000', name: 'Twin Demo App', client_type: 'confidential' } },
  { method: 'POST', path: '/_twin/clients', body: { client_id: 'VHdpblB1YmxpY0FwcDAwMDAwMDA6MTpjaQ', name: 'Twin Public App', client_type: 'public' } },
  {
    method: 'POST', path: '/_twin/accounts',
    body: {
      id: '9000000000000000001', username: 'ada_twin', name: 'Ada Lovelace', created_at: '2013-12-14T04:35:55.000Z',
      description: 'Analyst. Engine programmer. First of her kind.', location: 'London', protected: false, verified: true, verified_type: 'blue',
      url: 'https://ada.example', confirmed_email: 'ada@twin.example', password: 'analytical-engine',
    },
  },
  {
    method: 'POST', path: '/_twin/accounts',
    body: {
      id: '9000000000000000002', username: 'grace_twin', name: 'Grace Hopper', created_at: '2015-06-01T12:00:00.000Z',
      description: 'It is easier to ask forgiveness than permission.', protected: true, verified: false, verified_type: 'none',
    },
  },
  // the Model Editor launch's accounts (volter-ai/social media/gtm/channels.yaml x-aaron; the life, journeys/), each with
  // the password its person signs in to x.com with; after every account seeded with its own id, since a minted id is
  // the highest held plus one, and one minted before Grace's would be hers
  { method: 'POST', path: '/_twin/accounts', body: { username: 'AaronYEtc', name: 'Aaron', description: 'VIDEOGAME.ai || A16Z SR02 || angel investing in vibe coders || new to twitter, no clout', email: 'aaron@world.test', password: 'stoneguard-bridge-1005' } },
  { method: 'POST', path: '/_twin/accounts', body: { username: 'volterai', name: 'Volter', description: 'We make the Model Editor: real Blender, driven by your coding agent.', location: 'New York', url: 'https://volter.ai', email: 'volterai@world.test', password: 'devlog-wednesdays-26' } },
];

export const browserSeed: SeedCall[] = [
  // The copied default runner makes this browser through X's ordinary sign-in request.
  { browser: 'default', method: 'POST', path: 'https://x.com/i/flow/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: { identifier: 'ada_twin', password: 'analytical-engine', redirect_after_login: '/home' } },
];
